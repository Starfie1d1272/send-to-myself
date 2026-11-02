fn main() {
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "get_settings",
            "connect_server",
            "set_shortcut",
            "copy_text",
            "copy_image",
        ]),
    ))
    .expect("build Tauri permissions");
}
