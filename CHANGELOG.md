# Changelog

版本遵循[语义化版本](https://semver.org/lang/zh-CN/)。
**核心**（Web + API + Docker 镜像）统一版本号；各平台**原生壳独立版本**（壳只做登录 + WebView + 分享，发布节奏与核心解耦，见 [SPEC §14](docs/SPEC.md)）。

## [1.0.1] - 2026-10-07

### 修复与维护
- 时间线改用创建时间 + ID 的复合游标，避免同秒记录跨页遗漏；兼容历史 ISO 游标。
- 附件先准备文件，再事务提交记录及附件；失败清理文件与幂等键，并发重试只创建一次。
- SSE 每次连接（含断线重连）重新查询时间线，补齐断线期间的变化。
- 分页 limit/cursor 与 multipart 内容/幂等键加入输入校验。
- 备份短暂停服以保证数据库与附件一致；导出来自同一快照，新增附件 SHA-256 校验。
- 恢复先完整校验附件与归档，再替换数据目录；保留恢复前的数据，无附件备份也会清理旧附件。
- 补 API 行为、SSE、重连、备份完整性及 Docker 恢复演练测试，加入 CI。
- 更新 Actions 与传递依赖 fast-uri、brace-expansion、shell-quote；覆盖旧 esbuild 修复开发依赖漏洞。
- 校正 PWA 分享、离线发送范围和平台状态；鸿蒙真机验收仍待执行。

## [1.0.0] - 2026-06-20

首个核心版本，已实现 MVP 主要功能（[SPEC §15](docs/SPEC.md)）；当时缺少完整行为测试与恢复演练证据，不能视为全部验收通过。

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
- **HarmonyOS NEXT**（ArkTS 原生壳）：已实现登录 + WebView + Share Kit 系统分享 + 离线队列，真机验收待完成
- **桌面**（Tauri 2，macOS / Windows）：薄壳加载 + 托盘常驻 + 全局快捷键 + 切换服务器

[1.0.0]: https://github.com/Starfie1d1272/send-to-myself/releases/tag/v1.0.0

[1.0.1]: https://github.com/Starfie1d1272/send-to-myself/releases/tag/v1.0.1
