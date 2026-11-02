# SendToMyself · 发给自己

发给自己：放在 NAS 上的跨设备收件箱。手机随手发，电脑接着用。

- 手机的截图或 PDF 发到收件箱，在电脑打开或下载。
- 电脑上的链接或文字发送后，在手机接着看。
- 临时记一件事，之后搜索、收藏或标记为待办。

面向已有 NAS、经常在自己的设备之间交接内容的人。一个实例供一个人使用；服务是单容器、SQLite 和附件目录，不是公共多租户服务。

## 当前可安装版本

| 平台 | 公开入口 | 范围 |
|---|---|---|
| NAS 核心 | [核心 1.0.2 Release](https://github.com/Starfie1d1272/send-to-myself/releases/tag/v1.0.2)；[GHCR 镜像](https://github.com/Starfie1d1272/send-to-myself/pkgs/container/send-to-myself) | 固定版本镜像，amd64 / arm64；Web 随核心提供 |
| Windows / macOS | [桌面 1.0.0](https://github.com/Starfie1d1272/send-to-myself/releases/tag/desktop-v1.0.0) | Windows x64 EXE/MSI、Apple Silicon DMG；无 Intel Mac 安装包 |
| HarmonyOS | [1.1.1 RC1 开发预览](https://github.com/Starfie1d1272/send-to-myself/releases/tag/harmony-v1.1.1-rc.1) | 未签名 HAP，需自行签名；完整后台传输尚未真机验收，配套 Web 要求见发布说明 |
| Android / iPhone / Intel Mac | 浏览器 | 无对应原生安装包 |

当前主线包含公开版本之后的开发实现，不能把源码合并、CI 构建或作者本地预览当作已发布安装包。[交付表](docs/RELEASES.md)记录来源、验证与限制；核心 [1.1.0-rc.1](https://github.com/Starfie1d1272/send-to-myself/releases/tag/v1.1.0-rc.1) 已提供候选供验收，正式核心仍为 1.0.2；[桌面 1.1.0-rc.1](https://github.com/Starfie1d1272/send-to-myself/releases/tag/desktop-v1.1.0-rc.1) 为配套候选，鸿蒙 1.2.0 仍是源码版本。

## 在 NAS 安装

在支持 Docker Compose 的 NAS 上创建专用数据目录，在新项目使用[唯一基础模板](deploy/docker-compose.yml)，填写强口令和目录的真实绝对路径。启动后访问 `http://NAS_IP:8787`；改过宿主端口则使用新端口。局域网 HTTP 不加密，远程访问须使用 HTTPS 和实际可达的网络路径。完整步骤见[部署指南](docs/DEPLOY.md)。

## 连接其他设备

第二台设备打开同一可达地址并登录，发送文字、图片和 PDF，再从另一台打开或下载。原生客户端填写实际可达的完整地址。桌面和鸿蒙的安装及验证边界分别见[桌面说明](apps/desktop/README.md)、[鸿蒙说明](docs/HARMONY_SHELL.md)。[Raycast 扩展](apps/raycast/README.md)为本地导入，未上架商店。

## 升级与备份

先记录实际镜像版本和 `/data` 对应目录，按[备份与恢复](docs/DEPLOY.md#备份与恢复)保存完整数据并验证恢复；升级使用实际发布的固定版本。回退须使用升级前完整备份及对应旧版本，不保证单独换回旧镜像能兼容新数据。

## 功能边界

- 发送文字、链接、图片和文件；取用时可复制、打开或下载，搜索并用待办、收藏和筛选找回。收藏是标记和筛选，不承诺置顶排序；截止日期用于显示和筛选，不提供系统定时通知。
- 敏感遮罩是页面展示保护，不是加密密码保险箱。局域网 HTTP 不加密，落盘保护依赖 NAS 配置。
- Web 有本机草稿，没有离线发送队列或 Web Share Target；鸿蒙源码有本机队列，入队不等于 NAS 已确认保存。系统分享、图片复制和后台调度因平台及版本而异，见各端说明。
- PWA 安装依赖浏览器与安全上下文；页面升级时草稿和 service worker 行为尚待配套版本实测。Android/iPhone 可使用网页，没有原生客户端。

## 开发与文档

源码采用 pnpm monorepo：`apps/api`、`apps/web`、`packages/shared`、桌面、Raycast 和鸿蒙壳。开发环境使用 `.node-version` 与根 `packageManager` 指定版本。`pnpm install` 后运行 `pnpm dev`；开发态未设 `AUTH_PASSWORD` 时认证关闭。根 Compose 是源码开发配置，不是普通 NAS 安装入口。

- [部署、备份与恢复](docs/DEPLOY.md) · [版本管理](docs/VERSIONING.md) · [当前交付表](docs/RELEASES.md)
- [架构与所有权](docs/ARCHITECTURE.md) · [产品范围](docs/SPEC.md) · [试用脚本](docs/PILOT.md)
- [鸿蒙设备审计](docs/HARMONY_DEVICE_AUDIT.md) · [可靠性验证范围](docs/RELIABILITY.md)

仓库现有截图为历史示意，不能作为当前版本界面或验收证据。许可证：[MIT](LICENSE)。
