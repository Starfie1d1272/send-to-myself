// SendToMyself 桌面薄壳（SPEC §14 V1.3）。
// 壳只做：记住服务器地址、把窗口导航到部署好的网页、托盘常驻、全局快捷键速唤。
// 业务逻辑全在服务端，这里不写任何业务。
use std::fs;
use std::io::Write;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Duration;
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

use serde::{Deserialize, Serialize};
use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Manager, Url, WindowEvent,
};
use tauri_plugin_clipboard_manager::ClipboardExt;

const DEFAULT_SHORTCUT: &str = "CommandOrControl+Shift+S";
const CLIPBOARD_WARNING: &str = "原生复制暂不可用，可使用页面支持的复制方式";
#[derive(Serialize, Deserialize, Default)]
struct Config {
    server_url: Option<String>,
    #[serde(default)]
    shortcut: Option<String>,
}
struct LauncherUrl(Mutex<Option<Url>>);
// The same lock serializes settings writes and owns connection attempts.
struct SettingsLock(Mutex<u64>);
#[derive(Default)]
struct Runtime {
    active: Option<Shortcut>,
    shortcut_error: Option<String>,
    clipboard_available: bool,
    clipboard_error: Option<String>,
}
struct RuntimeState(Mutex<Runtime>);
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Settings {
    server_url: Option<String>,
    shortcut: String,
    shortcut_active: bool,
    shortcut_error: Option<String>,
    clipboard_available: bool,
    clipboard_error: Option<String>,
}
#[derive(Serialize)]
struct SettingsError {
    code: &'static str,
    message: &'static str,
}
fn failure(code: &'static str, message: &'static str) -> SettingsError {
    SettingsError { code, message }
}
fn config_path(app: &tauri::AppHandle) -> PathBuf {
    app.path()
        .app_config_dir()
        .expect("app config dir")
        .join("config.json")
}
fn read_config(app: &tauri::AppHandle) -> Config {
    fs::read_to_string(config_path(app))
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}
fn read_config_for_write(app: &tauri::AppHandle) -> Result<Config, SettingsError> {
    match fs::read_to_string(config_path(app)) {
        Ok(contents) => {
            serde_json::from_str(&contents).map_err(|_| failure("save_failed", "配置无法读取"))
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Config::default()),
        Err(_) => Err(failure("save_failed", "配置无法读取")),
    }
}
fn write_config(app: &tauri::AppHandle, cfg: &Config) -> Result<(), SettingsError> {
    let result = (|| -> Result<(), Box<dyn std::error::Error>> {
        let path = config_path(app);
        let dir = path.parent().ok_or("missing config directory")?;
        fs::create_dir_all(dir)?;
        let mut tmp = tempfile::NamedTempFile::new_in(dir)?;
        serde_json::to_writer(&mut tmp, cfg)?;
        tmp.flush()?;
        tmp.as_file().sync_all()?;
        tmp.persist(path)?;
        Ok(())
    })();
    result.map_err(|_| failure("save_failed", "保存配置失败"))
}
fn check_launcher(
    app: &tauri::AppHandle,
    window: &tauri::WebviewWindow,
) -> Result<(), SettingsError> {
    let launcher = app.state::<LauncherUrl>();
    let saved = launcher.0.lock().unwrap();
    let page = window
        .url()
        .map_err(|_| failure("forbidden", "无权调用设置"))?;
    let allowed = saved.as_ref().is_some_and(|u| {
        u.scheme() == page.scheme()
            && u.host_str() == page.host_str()
            && u.port_or_known_default() == page.port_or_known_default()
            && u.path() == page.path()
    });
    if window.label() != "main" || !allowed {
        return Err(failure("forbidden", "无权调用设置"));
    }
    Ok(())
}
fn current_settings(app: &tauri::AppHandle) -> Settings {
    let cfg = read_config(app);
    let runtime = app.state::<RuntimeState>();
    let state = runtime.0.lock().unwrap();
    Settings {
        server_url: cfg.server_url,
        shortcut: cfg.shortcut.unwrap_or_else(|| DEFAULT_SHORTCUT.into()),
        shortcut_active: state.active.is_some(),
        shortcut_error: state.shortcut_error.clone(),
        clipboard_available: state.clipboard_available,
        clipboard_error: state.clipboard_error.clone(),
    }
}
#[tauri::command]
fn get_settings(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
) -> Result<Settings, SettingsError> {
    check_launcher(&app, &window)?;
    Ok(current_settings(&app))
}
fn validate_server(raw: &str) -> Result<Url, String> {
    let authority = raw.split_once("://").ok_or("invalid server URL")?.1;
    if let Some((_, path)) = authority.split_once('/') {
        if !path.is_empty() {
            return Err("invalid server URL".into());
        }
    }
    let url = Url::parse(raw).map_err(|_| "invalid server URL")?;
    if !matches!(url.scheme(), "http" | "https")
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
        || url.path() != "/"
    {
        return Err("invalid server URL".into());
    }
    Ok(url)
}
async fn probe_server(url: &Url) -> Result<(), SettingsError> {
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(4))
        .build()
        .map_err(|_| failure("unreachable", "无法连接"))?;
    let mut response = client
        .get(url.join("/api/auth/me").unwrap())
        .send()
        .await
        .map_err(|e| {
            let details = format!("{e:?}").to_lowercase();
            if details.contains("certificate") || details.contains("tls") {
                failure("tls_error", "证书或 TLS 错误")
            } else {
                failure("unreachable", "无法连接")
            }
        })?;
    if response.status().is_redirection() {
        return Err(failure("redirect", "地址发生跳转"));
    }
    if response.status() != reqwest::StatusCode::OK {
        return Err(failure("wrong_service", "服务不可用"));
    }
    let mut body = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| failure("unreachable", "读取服务响应失败"))?
    {
        if body.len() + chunk.len() > 16 * 1024 {
            return Err(failure("wrong_service", "响应过大"));
        }
        body.extend_from_slice(&chunk);
    }
    let value: serde_json::Value =
        serde_json::from_slice(&body).map_err(|_| failure("wrong_service", "响应无效"))?;
    if !value.get("authEnabled").is_some_and(|v| v.is_boolean())
        || !value.get("authenticated").is_some_and(|v| v.is_boolean())
    {
        return Err(failure("wrong_service", "响应无效"));
    }
    Ok(())
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ConnectResult {
    url: String,
    clipboard_available: bool,
    clipboard_error: Option<String>,
}
#[tauri::command]
async fn connect_server(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    url: String,
) -> Result<ConnectResult, SettingsError> {
    let settings_lock = app.state::<SettingsLock>();
    let attempt = {
        let mut generation = settings_lock.0.lock().unwrap();
        check_launcher(&app, &window)?;
        *generation = generation.wrapping_add(1);
        *generation
    };
    let parsed = validate_server(&url).map_err(|_| failure("invalid_url", "请填写应用根地址"))?;
    if app
        .state::<LauncherUrl>()
        .0
        .lock()
        .unwrap()
        .as_ref()
        .is_some_and(|u| u.origin() == parsed.origin())
    {
        return Err(failure("invalid_url", "不能连接启动页"));
    }
    probe_server(&parsed).await?;
    let origin = parsed.origin().ascii_serialization();
    let generation = settings_lock.0.lock().unwrap();
    if *generation != attempt {
        return Err(failure("superseded", "连接已被新的操作取代"));
    }
    check_launcher(&app, &window)?;
    let mut cfg = read_config_for_write(&app)?;
    if cfg.server_url.as_deref() != Some(origin.as_str()) {
        cfg.server_url = Some(origin.clone());
        write_config(&app, &cfg)?;
    }
    let available = grant_clipboard(&app, &origin).is_ok();
    let warning = if available {
        None
    } else {
        Some(CLIPBOARD_WARNING.to_string())
    };
    let runtime = app.state::<RuntimeState>();
    let mut state = runtime.0.lock().unwrap();
    state.clipboard_available = available;
    state.clipboard_error = warning.clone();
    Ok(ConnectResult {
        url: origin,
        clipboard_available: available,
        clipboard_error: warning,
    })
}
fn parse_shortcut(raw: &str) -> Result<Shortcut, SettingsError> {
    let shortcut: Shortcut = raw
        .parse()
        .map_err(|_| failure("invalid_shortcut", "快捷键无效"))?;
    let primary = Modifiers::CONTROL | Modifiers::SUPER | Modifiers::ALT;
    let valid_key = matches!(
        shortcut.key,
        Code::KeyA
            | Code::KeyB
            | Code::KeyC
            | Code::KeyD
            | Code::KeyE
            | Code::KeyF
            | Code::KeyG
            | Code::KeyH
            | Code::KeyI
            | Code::KeyJ
            | Code::KeyK
            | Code::KeyL
            | Code::KeyM
            | Code::KeyN
            | Code::KeyO
            | Code::KeyP
            | Code::KeyQ
            | Code::KeyR
            | Code::KeyS
            | Code::KeyT
            | Code::KeyU
            | Code::KeyV
            | Code::KeyW
            | Code::KeyX
            | Code::KeyY
            | Code::KeyZ
            | Code::Digit0
            | Code::Digit1
            | Code::Digit2
            | Code::Digit3
            | Code::Digit4
            | Code::Digit5
            | Code::Digit6
            | Code::Digit7
            | Code::Digit8
            | Code::Digit9
            | Code::F1
            | Code::F2
            | Code::F3
            | Code::F4
            | Code::F5
            | Code::F6
            | Code::F7
            | Code::F8
            | Code::F9
            | Code::F10
            | Code::F11
            | Code::F12
    );
    if !shortcut.mods.intersects(primary) || !valid_key {
        return Err(failure("invalid_shortcut", "快捷键无效"));
    }
    Ok(shortcut)
}
#[tauri::command]
fn set_shortcut(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    shortcut: String,
) -> Result<Settings, SettingsError> {
    check_launcher(&app, &window)?;
    let new = parse_shortcut(&shortcut)?;
    let settings_lock = app.state::<SettingsLock>();
    let _guard = settings_lock.0.lock().unwrap();
    let runtime = app.state::<RuntimeState>();
    let old = runtime.0.lock().unwrap().active;
    if old == Some(new) {
        return Ok(current_settings(&app));
    }
    app.global_shortcut()
        .register(new)
        .map_err(|_| failure("shortcut_conflict", "快捷键冲突"))?;
    let mut cfg = match read_config_for_write(&app) {
        Ok(cfg) => cfg,
        Err(e) => {
            let _ = app.global_shortcut().unregister(new);
            return Err(e);
        }
    };
    cfg.shortcut = Some(shortcut);
    if let Err(error) = write_config(&app, &cfg) {
        let _ = app.global_shortcut().unregister(new);
        return Err(error);
    }
    {
        let mut state = runtime.0.lock().unwrap();
        state.active = Some(new);
        state.shortcut_error = None;
    }
    if let Some(old) = old {
        if app.global_shortcut().unregister(old).is_err() {
            runtime.0.lock().unwrap().shortcut_error =
                Some("新快捷键已生效，旧键释放失败，重启后恢复".into());
        }
    }
    Ok(current_settings(&app))
}

fn grant_clipboard(app: &tauri::AppHandle, server: &str) -> Result<(), String> {
    let url = validate_server(server)?;
    let capability = serde_json::json!({
        "identifier": format!("clipboard-{}", url.origin().ascii_serialization()),
        "local": false,
        "windows": ["main"],
        "remote": { "urls": [format!("{}/*", url.origin().ascii_serialization())] },
        "permissions": ["allow-copy-text", "allow-copy-image"]
    })
    .to_string();
    app.add_capability(capability.as_str())
        .map_err(|e| e.to_string())
}

fn clipboard_origin_allowed(server: &str, page: &Url) -> bool {
    validate_server(server).is_ok_and(|url| url.origin() == page.origin())
}

fn check_clipboard_origin(
    app: &tauri::AppHandle,
    window: &tauri::WebviewWindow,
) -> Result<(), String> {
    let server = read_config(app).server_url.ok_or("no configured server")?;
    let page = window.url().map_err(|e| e.to_string())?;
    if window.label() != "main" || !clipboard_origin_allowed(&server, &page) {
        return Err("clipboard denied for this origin".into());
    }
    Ok(())
}

#[tauri::command]
fn copy_text(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    text: String,
) -> Result<(), String> {
    check_clipboard_origin(&app, &window)?;
    if text.len() > 10 * 1024 * 1024 {
        return Err("text too large".into());
    }
    app.clipboard().write_text(text).map_err(|e| e.to_string())
}

fn check_png(bytes: &[u8]) -> Result<(), String> {
    if bytes.len() < 24
        || bytes.len() > 50 * 1024 * 1024
        || &bytes[..8] != b"\x89PNG\r\n\x1a\n"
        || &bytes[12..16] != b"IHDR"
    {
        return Err("invalid PNG".into());
    }
    let width = u32::from_be_bytes(bytes[16..20].try_into().unwrap());
    let height = u32::from_be_bytes(bytes[20..24].try_into().unwrap());
    if width == 0 || height == 0 || u64::from(width) * u64::from(height) > 16_000_000 {
        return Err("image too large".into());
    }
    Ok(())
}

#[tauri::command]
fn copy_image(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    png: Vec<u8>,
) -> Result<(), String> {
    check_clipboard_origin(&app, &window)?;
    check_png(&png)?;
    let image = tauri::image::Image::from_bytes(&png).map_err(|e| e.to_string())?;
    app.clipboard()
        .write_image(&image)
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod clipboard_tests {
    use super::*;
    #[test]
    fn configured_origin_only() {
        assert!(clipboard_origin_allowed(
            "http://localhost:8787",
            &Url::parse("http://localhost:8787/api").unwrap()
        ));
        for page in [
            "https://localhost:8787",
            "http://localhost:8788",
            "https://attacker.example",
        ] {
            assert!(!clipboard_origin_allowed(
                "http://localhost:8787",
                &Url::parse(page).unwrap()
            ));
        }
        assert!(validate_server("https://user:pass@example.com").is_err());
        assert!(validate_server("file:///tmp/a").is_err());
    }
    #[test]
    fn bounds_checked_before_decode() {
        assert!(check_png(&[]).is_err());
        let mut png = b"\x89PNG\r\n\x1a\n\x00\x00\x00\x0dIHDR".to_vec();
        png.extend(100u32.to_be_bytes());
        png.extend(100u32.to_be_bytes());
        assert!(check_png(&png).is_ok());
        png[16..20].copy_from_slice(&200_000u32.to_be_bytes());
        assert!(check_png(&png).is_err());
        png[16..20].copy_from_slice(&4000u32.to_be_bytes());
        png[20..24].copy_from_slice(&4000u32.to_be_bytes());
        assert!(check_png(&png).is_ok());
        png[20..24].copy_from_slice(&4001u32.to_be_bytes());
        assert!(check_png(&png).is_err());
        let fixture = include_bytes!("../icons/128x128.png");
        assert!(check_png(fixture).is_ok());
        let decoded = tauri::image::Image::from_bytes(fixture).unwrap();
        assert_eq!(decoded.width(), 128);
        assert_eq!(decoded.height(), 128);
    }
}

/// 切换窗口可见性（全局快捷键与托盘共用）。
fn toggle_window(app: &tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        if w.is_visible().unwrap_or(false) {
            let _ = w.hide();
        } else {
            let _ = w.show();
            let _ = w.set_focus();
            let _ = w.eval("window.dispatchEvent(new Event('send-to-myself:focus-composer'));");
        }
    }
}

/// 打开本地设置，同时使之前页面的连接尝试失效。
/// 托盘菜单与全局快捷键（Cmd/Ctrl+Shift+逗号）共用——不依赖托盘也能逃生。
fn switch_server(app: &tauri::AppHandle) {
    let settings_lock = app.state::<SettingsLock>();
    let mut generation = settings_lock.0.lock().unwrap();
    *generation = generation.wrapping_add(1);
    let target = app.state::<LauncherUrl>().0.lock().unwrap().clone();
    if let (Some(w), Some(mut u)) = (app.get_webview_window("main"), target) {
        u.set_query(Some("view=settings"));
        let _ = w.navigate(u);
        let _ = w.show();
        let _ = w.set_focus();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // single-instance 必须第一个注册：再次启动时聚焦已有窗口而非开新进程。
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.show();
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .invoke_handler(tauri::generate_handler![
            get_settings,
            connect_server,
            set_shortcut,
            copy_text,
            copy_image
        ])
        .setup(|app| {
            let handle = app.handle();

            // 捕获本地启动页 URL，供「切换服务器」导航回来。
            let main = app.get_webview_window("main").expect("main window");
            let launcher_url = main.url().ok();
            app.manage(LauncherUrl(Mutex::new(launcher_url)));

            app.manage(SettingsLock(Mutex::new(0)));
            app.manage(RuntimeState(Mutex::new(Runtime::default())));

            // —— 托盘 ——
            let show = MenuItem::with_id(app, "show", "显示窗口", true, None::<&str>)?;
            let switch = MenuItem::with_id(app, "switch", "设置…", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &switch, &quit])?;
            TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                // macOS 菜单栏按单色 template 渲染，自适应深/浅色，避免彩色图标看不清；
                // 其他平台忽略此项。
                .icon_as_template(true)
                .tooltip("发给自己")
                .menu(&menu)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => {
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.show();
                            let _ = w.set_focus();
                        }
                    }
                    "switch" => switch_server(app),
                    "quit" => app.exit(0),
                    _ => {}
                })
                .build(app)?;

            #[cfg(desktop)]
            {
                #[cfg(target_os = "macos")]
                let primary = Modifiers::SUPER;
                #[cfg(not(target_os = "macos"))]
                let primary = Modifiers::CONTROL;
                let settings_key = Shortcut::new(Some(primary | Modifiers::SHIFT), Code::Comma);
                handle.plugin(
                    tauri_plugin_global_shortcut::Builder::new()
                        .with_handler(move |app, sc, event| {
                            if event.state() != ShortcutState::Pressed {
                                return;
                            }
                            if *sc == settings_key {
                                switch_server(app);
                                return;
                            }
                            if app.state::<RuntimeState>().0.lock().unwrap().active == Some(*sc) {
                                toggle_window(app);
                            }
                        })
                        .build(),
                )?;
                let cfg = read_config(handle);
                let configured = cfg.shortcut.as_deref().unwrap_or(DEFAULT_SHORTCUT);
                let selected =
                    parse_shortcut(configured).or_else(|_| parse_shortcut(DEFAULT_SHORTCUT));
                match selected {
                    Ok(key) => match app.global_shortcut().register(key) {
                        Ok(()) => app.state::<RuntimeState>().0.lock().unwrap().active = Some(key),
                        Err(_) => {
                            app.state::<RuntimeState>().0.lock().unwrap().shortcut_error =
                                Some("快捷键未生效".into())
                        }
                    },
                    Err(_) => {
                        app.state::<RuntimeState>().0.lock().unwrap().shortcut_error =
                            Some("快捷键未生效".into())
                    }
                }
                if let Err(error) = app.global_shortcut().register(settings_key) {
                    eprintln!("Cannot register settings shortcut: {error}");
                }
            }

            Ok(())
        })
        // 点红叉/Cmd+W 隐藏到托盘而非退出（速记壳常驻）。真正退出走托盘「退出」。
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
