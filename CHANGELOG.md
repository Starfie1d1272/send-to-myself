# Changelog

版本遵循[语义化版本](https://semver.org/lang/zh-CN/)。
**核心**（Web + API + Docker 镜像）统一版本号；各平台**原生壳独立版本**（壳只做登录 + WebView + 分享，发布节奏与核心解耦，见 [SPEC §14](docs/SPEC.md)）。

## [1.0.0] - 2026-06-20

首个正式版本 —— V1 MVP 22 项全部达成（[SPEC §15](docs/SPEC.md)）。

### 核心功能
- **登录**：argon2id 口令哈希 + 登录限速锁定；原生壳用长效 Bearer 设备令牌
- **统一时间线**：文字 / 链接 / 图片 / 文件一条流，游标分页，今天/昨天/更早分组
- **发送**：输入 / 粘贴 / 拖拽 / 上传，Enter 发送，上传失败不丢输入
- **链接预览**：自动抓标题 / 封面 / favicon，防 SSRF；失败不阻塞发送
- **查看时再分类**：待办（`isTodo`）+ DDL + 想法 / 稍后看标签 + 置顶，正交不互斥
- **DDL**：快捷（今天 / 明天 / 本周日）+ 自定义日期时间；chrono-node 中文自动识别（仅建议需确认）
- **编辑正文**（编辑后重抓预览 / 重跑识别）、软删除、回收站恢复
- **全文搜索**：中文子串，覆盖正文 / 链接标题 / 附件文件名；敏感项参与索引但结果隐藏正文
- **敏感内容**：密钥 / Token 自动识别遮罩 + 手动标记 / 取消 + 点开 + 一键复制
- **附件**：服务端缩略图、壳内 lightbox 看大图、下载、移动端系统分享；复制文字 / 复制图片
- **实时同步**：SSE（`/realtime` 独立抽象，预留 WebSocket）
- **响应式移动端 + PWA**
- **部署**：Docker Compose + SQLite / 附件备份与恢复脚本（`scripts/backup.sh` / `scripts/restore.sh`）

### 平台壳
- **Web / PWA**：全平台兜底
- **HarmonyOS NEXT**（ArkTS 原生壳）：登录 + WebView + Share Kit 系统分享 + 离线队列
- **桌面**（Tauri 2，macOS / Windows）：薄壳加载 + 托盘常驻 + 全局快捷键 + 切换服务器

[1.0.0]: https://github.com/Starfie1d1272/send-to-myself/releases/tag/v1.0.0
