# SendToMyself 桌面薄壳（Tauri 2）

Windows / macOS 桌面壳（SPEC §14 V1.3）。**业务逻辑全在服务端**，壳只做：

- 记住服务器地址，把窗口导航到部署好的网页（首启输入一次）；
- 托盘常驻：显示窗口 / 切换服务器 / 退出；
- 全局快捷键 `Cmd/Ctrl+Shift+S` 速唤或隐藏窗口；
- 单实例（再次启动聚焦已有窗口）；点关闭按钮隐藏到托盘而非退出。

## 开发

需要 [Rust 工具链](https://tauri.app/start/prerequisites/) + Node/pnpm。

```bash
pnpm install          # 在仓库根目录
cd apps/desktop
pnpm tauri dev        # 启动开发壳（首次会编译 Rust 依赖，约 2 分钟）
```

首启窗口是「连接」页，填入你的服务器地址（如 `https://stm.example.com`）即进入网页。
要换服务器：托盘菜单 →「切换服务器…」。

## 打包

```bash
pnpm tauri build      # 产物在 src-tauri/target/release/bundle/
```

## 结构

- `index.html` / `src/` — 本地启动页（仅一个连接表单 + 跳转逻辑）。
- `src-tauri/src/lib.rs` — 壳逻辑：地址持久化、托盘、全局快捷键、窗口行为。
- `src-tauri/tauri.conf.json` — 窗口与打包配置。

> 配置存于系统应用配置目录的 `config.json`（仅一个 `server_url` 字段）。
