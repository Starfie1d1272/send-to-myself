<p align="center"><img src="apps/desktop/src-tauri/icons/icon.png" alt="SendToMyself logo" width="120" /></p>

<h1 align="center">SendToMyself · 发给自己</h1>

<p align="center">自托管的跨设备信息流：随手发送文字、链接、图片、文件和待办。</p>

<p align="center">
  <a href="https://github.com/Starfie1d1272/send-to-myself/actions/workflows/ci.yml"><img src="https://github.com/Starfie1d1272/send-to-myself/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <a href="https://github.com/Starfie1d1272/send-to-myself/actions/workflows/desktop-build.yml"><img src="https://github.com/Starfie1d1272/send-to-myself/actions/workflows/desktop-build.yml/badge.svg" alt="Desktop Build" /></a>
  <a href="https://github.com/Starfie1d1272/send-to-myself/actions/workflows/docker-image.yml"><img src="https://github.com/Starfie1d1272/send-to-myself/actions/workflows/docker-image.yml/badge.svg" alt="Docker Image" /></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-MIT-green" alt="License" /></a>
</p>

<p align="center"><img src="docs/screenshots/timeline-desktop.png" alt="桌面时间线历史截图" width="70%" /><br />历史版本界面</p>

<details><summary>手机与登录页历史版本界面</summary>
<p align="center"><img src="docs/screenshots/timeline-mobile.png" alt="移动端时间线历史截图" width="260" /> <img src="docs/screenshots/login.png" alt="登录页历史截图" width="260" /></p>
</details>

## 功能

- 发送文字、链接、图片和文件，跨设备实时查看。
- 搜索、收藏、标记待办和设置截止日期；回收站支持恢复。
- 识别并遮罩敏感内容；支持附件预览和下载。
- Web 支持本机草稿；各平台能力和限制见对应文档。

## 下载

- NAS 核心：[1.0.2 正式版](https://github.com/Starfie1d1272/send-to-myself/releases/tag/v1.0.2) · [1.1.0 RC1](https://github.com/Starfie1d1272/send-to-myself/releases/tag/v1.1.0-rc.1) · [GHCR 镜像](https://github.com/Starfie1d1272/send-to-myself/pkgs/container/send-to-myself)
- 桌面：[1.0.0 正式版](https://github.com/Starfie1d1272/send-to-myself/releases/tag/desktop-v1.0.0) · [1.1.0 RC1](https://github.com/Starfie1d1272/send-to-myself/releases/tag/desktop-v1.1.0-rc.1)
- 鸿蒙：[1.1.1 RC1 开发预览](https://github.com/Starfie1d1272/send-to-myself/releases/tag/harmony-v1.1.1-rc.1)（未签名 HAP）；Android / iPhone 可使用浏览器。

版本、验证范围与平台限制见[交付表](docs/RELEASES.md)。

## 在 NAS 安装

在支持 Docker Compose 的 NAS 上创建专用数据目录，在新项目使用[唯一基础模板](deploy/docker-compose.yml)，填写强口令和目录的真实绝对路径。启动后访问 `http://NAS_IP:8787`；改过宿主端口则使用新端口。局域网 HTTP 不加密，远程访问须使用 HTTPS 和实际可达的网络路径。完整步骤见[部署指南](docs/DEPLOY.md)。

## 连接其他设备

第二台设备打开同一可达地址并登录，发送文字、图片和 PDF，再从另一台打开或下载。原生客户端填写实际可达的完整地址。桌面和鸿蒙的安装及验证边界分别见[桌面说明](apps/desktop/README.md)、[鸿蒙说明](docs/HARMONY_SHELL.md)。[Raycast 扩展](apps/raycast/README.md)为本地导入，未上架商店。

## 升级与备份

先记录实际镜像版本和 `/data` 对应目录，按[备份与恢复](docs/DEPLOY.md#备份与恢复)保存完整数据并验证恢复；升级使用实际发布的固定版本。回退须使用升级前完整备份及对应旧版本，不保证单独换回旧镜像能兼容新数据。

## 开发与文档

源码采用 pnpm monorepo：`apps/api`、`apps/web`、`packages/shared`、桌面、Raycast 和鸿蒙壳。开发环境使用 `.node-version` 与根 `packageManager` 指定版本。`pnpm install` 后运行 `pnpm dev`；开发态未设 `AUTH_PASSWORD` 时认证关闭。根 Compose 是源码开发配置，不是普通 NAS 安装入口。

- [部署、备份与恢复](docs/DEPLOY.md) · [版本管理](docs/VERSIONING.md) · [当前交付表](docs/RELEASES.md)
- [架构与所有权](docs/ARCHITECTURE.md) · [产品范围](docs/SPEC.md) · [试用脚本](docs/PILOT.md)
- [鸿蒙设备审计](docs/HARMONY_DEVICE_AUDIT.md) · [可靠性验证范围](docs/RELIABILITY.md)

许可证：[MIT](LICENSE)。
