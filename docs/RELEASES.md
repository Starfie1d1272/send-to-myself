# 发布入口与使用边界

各平台已构建产物、校验文件（`SHA256SUMS` / `.sha256`）与变更记录均以 GitHub Releases 为准，本文档不再重复抄录静态版本号与哈希：

- **NAS 核心与 Web**：[最新正式版](https://github.com/Starfie1d1272/send-to-myself/releases/latest) · [GHCR 镜像](https://github.com/Starfie1d1272/send-to-myself/pkgs/container/send-to-myself)（`latest` 随核心正式版自动更新）
- **Windows / macOS 桌面端**：[桌面端发布列表](https://github.com/Starfie1d1272/send-to-myself/releases?q=Desktop)（提供 Windows x64 EXE/MSI 与 Apple Silicon DMG；无 Intel Mac 包）
- **HarmonyOS 端**：[鸿蒙端发布列表](https://github.com/Starfie1d1272/send-to-myself/releases?q=HarmonyOS)（公开产物为未签名 HAP，安装前需自行签名）
- **Raycast 扩展**：位于 [apps/raycast](../apps/raycast)，未上架商店；可从源码目录或 `main` CI 的 `sendtomyself-raycast` artifact 本地导入

## 使用边界

- 收藏用于标记与筛选，不改变排序；截止日期用于显示和筛选，不提供系统定时通知。
- 敏感遮罩是页面展示保护，不是加密保险箱。局域网 HTTP 不加密，远程访问需配置 HTTPS。
- Web 有本机草稿，无离线发送队列或 Web Share Target；鸿蒙有本机发送队列，入队不等于 NAS 已确认保存。
- Android / iPhone 与 Intel Mac 可直接使用浏览器（支持时可添加到主屏幕作为 PWA）。
