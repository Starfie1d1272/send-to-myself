// SendToMyself 桌面薄壳（SPEC §14 V1.3）。
// 壳只做：记住服务器地址、把窗口导航到部署好的网页、托盘常驻、全局快捷键速唤。
// 业务逻辑全在服务端，这里不写任何业务。
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Manager, Url, WindowEvent,
};

/// 持久化配置：仅一个服务器地址。
#[derive(Serialize, Deserialize, Default)]
struct Config {
    server_url: Option<String>,
}

/// 启动时捕获的本地启动页 URL（launcher）。「切换服务器」时导航回它。
struct LauncherUrl(Mutex<Option<Url>>);

fn config_path(app: &tauri::AppHandle) -> PathBuf {
    let dir = app.path().app_config_dir().expect("app config dir");
    let _ = fs::create_dir_all(&dir);
    dir.join("config.json")
}

fn read_config(app: &tauri::AppHandle) -> Config {
    fs::read_to_string(config_path(app))
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn write_config(app: &tauri::AppHandle, cfg: &Config) -> Result<(), String> {
    let s = serde_json::to_string(cfg).map_err(|e| e.to_string())?;
    fs::write(config_path(app), s).map_err(|e| e.to_string())
}

/// 启动页读取已保存的服务器地址；空=未配置，显示连接表单。
#[tauri::command]
fn get_server_url(app: tauri::AppHandle) -> Option<String> {
    read_config(&app).server_url
}

/// 连接：保存地址。保存后由前端 location.replace 导航到该站点。
#[tauri::command]
fn set_server_url(app: tauri::AppHandle, url: String) -> Result<(), String> {
    write_config(&app, &Config { server_url: Some(url) })
}

/// 切换窗口可见性（全局快捷键与托盘共用）。
fn toggle_window(app: &tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        if w.is_visible().unwrap_or(false) {
            let _ = w.hide();
        } else {
            let _ = w.show();
            let _ = w.set_focus();
        }
    }
}

/// 切换服务器：清空已存地址并导航回本地启动页，让用户重填。
/// 托盘菜单与全局快捷键（Cmd/Ctrl+Shift+逗号）共用——不依赖托盘也能逃生。
fn switch_server(app: &tauri::AppHandle) {
    let _ = write_config(app, &Config::default());
    let target = app.state::<LauncherUrl>().0.lock().unwrap().clone();
    if let (Some(w), Some(u)) = (app.get_webview_window("main"), target) {
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
        .invoke_handler(tauri::generate_handler![get_server_url, set_server_url])
        .setup(|app| {
            let handle = app.handle();

            // 捕获本地启动页 URL，供「切换服务器」导航回来。
            let main = app.get_webview_window("main").expect("main window");
            let launcher_url = main.url().ok();
            app.manage(LauncherUrl(Mutex::new(launcher_url)));

            // —— 托盘 ——
            let show = MenuItem::with_id(app, "show", "显示窗口", true, None::<&str>)?;
            let switch = MenuItem::with_id(app, "switch", "切换服务器…", true, None::<&str>)?;
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

            // —— 全局快捷键：Cmd/Ctrl+Shift+S 速唤/隐藏 ——
            #[cfg(desktop)]
            {
                use tauri_plugin_global_shortcut::{
                    Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState,
                };
                let toggle = Shortcut::new(Some(Modifiers::SUPER | Modifiers::SHIFT), Code::KeyS);
                // 切换服务器：Cmd/Ctrl+Shift+逗号——不依赖托盘的逃生入口。
                let switch_sc =
                    Shortcut::new(Some(Modifiers::SUPER | Modifiers::SHIFT), Code::Comma);
                let toggle_for_handler = toggle;
                let switch_for_handler = switch_sc;
                handle.plugin(
                    tauri_plugin_global_shortcut::Builder::new()
                        .with_handler(move |app, sc, event| {
                            if event.state() != ShortcutState::Pressed {
                                return;
                            }
                            if *sc == toggle_for_handler {
                                toggle_window(app);
                            } else if *sc == switch_for_handler {
                                switch_server(app);
                            }
                        })
                        .build(),
                )?;
                app.global_shortcut().register(toggle)?;
                app.global_shortcut().register(switch_sc)?;
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
