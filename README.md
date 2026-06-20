<p align="center">
  <img src="apps/desktop/src-tauri/icons/icon.png" alt="logo" width="120" />
</p>

<h1 align="center">SendToMyself · 发给自己</h1>

<p align="center">
  自托管、跨平台的「发给自己」统一信息流。
  <br />
  把文字、链接、图片、文件、待办随手发进来，所有设备实时同步。
</p>

<p align="center">
  <a href="https://github.com/Starfie1d1272/send-to-myself/actions/workflows/desktop-build.yml"><img src="https://github.com/Starfie1d1272/send-to-myself/actions/workflows/desktop-build.yml/badge.svg" alt="Desktop Build" /></a>
  <a href="https://github.com/Starfie1d1272/send-to-myself/actions/workflows/docker-image.yml"><img src="https://github.com/Starfie1d1272/send-to-myself/actions/workflows/docker-image.yml/badge.svg" alt="Docker Image" /></a>
  <a href="https://github.com/Starfie1d1272/send-to-myself/pkgs/container/send-to-myself"><img src="https://img.shields.io/badge/image-ghcr.io-blue" alt="Docker" /></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-MIT-green" alt="License" /></a>
</p>

<p align="center">
  <img src="docs/screenshots/timeline-desktop.png" alt="桌面端时间线" width="70%" />
</p>

<details>
<summary>📱 移动端截图</summary>
<p align="center">
  <img src="docs/screenshots/timeline-mobile.png" alt="移动端时间线" width="260" />
  <img src="docs/screenshots/login.png" alt="登录" width="260" />
</p>
</details>

---

## ✨ 能做什么

| | | |
|---|---|---|
| 🔗 **链接随手存** | 自动抓标题/封面/favicon 生成预览卡，B 站公众号图床也能正常显示 | |
| 📝 **文字 + 待办** | 发送即入库，回头再分类；一键转待办、设 DDL、到期自动分桶提醒 | |
| 🖼️ **图片 + 文件** | 粘贴/拖拽/选择上传，服务端缩略图，原图预览下载，移动端系统分享 | |
| ⚡ **实时同步** | SSE 推送——这台发，另一台立刻出现 | |
| 🔍 **全文搜索** | 中文子串搜索，覆盖正文 / 链接标题 / 文件名；敏感内容参与索引但**不泄漏正文** | |
| 🔒 **密钥自动遮罩** | API Key / Token 自动识别，只遮密钥本体，前后文正常显示；一键「密钥」聚合 | |
| 📴 **离线不丢** | 原生端断网排队，联网自动补发，幂等去重不重复 | |
| 🗑️ **回收站** | 软删除保留期内随时恢复 | |

## 📦 在哪用

一套网页核心 + 各平台**原生薄壳**：功能只写一遍，各端只负责登录、显示、接收系统分享。

| 平台 | 形态 | 状态 |
|---|---|---|
| 浏览器 / PWA | 响应式网页，可安装 | ✅ |
| 桌面 Windows / macOS | Tauri 薄壳 · 托盘常驻 · 全局快捷键 `Cmd/Ctrl+Shift+S` | ✅ |
| HarmonyOS NEXT | ArkTS 原生壳 · 系统分享 · 离线队列 | 🚧 待真机 |
| Android | Capacitor 薄壳 | 📋 |

## 🚀 快速开始

**浏览器打开就能用** —— 先部署服务端。

<details>
<summary>🐳 镜像部署（NAS 可视化，点几下就行）</summary>

复制下面内容到群晖 Container Manager / Portainer / QNAP 的「新建 Stack」：

```yaml
services:
  app:
    image: ghcr.io/starfie1d1272/send-to-myself:latest
    restart: unless-stopped
    environment:
      AUTH_PASSWORD: "改成你自己的强口令"
    ports:
      - "8787:8787"
    volumes:
      - ./data:/data
```

部署后访问 `http://你的NAS_IP:8787`。完整说明（域名 + HTTPS）→ **[部署指南](docs/DEPLOY.md)**。

</details>

<details>
<summary>🖥️ 有终端的话</summary>

```bash
git clone https://github.com/Starfie1d1272/send-to-myself.git
cd send-to-myself
cp .env.example .env  # 编辑设 AUTH_PASSWORD
docker compose up -d
```

</details>

部署后浏览器打开，用口令登录即用。原生客户端填同一个地址。

## 📚 文档

- **[docs/SPEC.md](docs/SPEC.md)** — 完整需求与边界
- **[docs/DEPLOY.md](docs/DEPLOY.md)** — 部署指南（镜像 / 源码 / 反代 / 验证）
- **[docs/HARMONY_SHELL.md](docs/HARMONY_SHELL.md)** — 鸿蒙原生壳契约
- **[docs/RESEARCH.md](docs/RESEARCH.md)** — 竞品与技术决策

---

# 开发

全 TypeScript pnpm monorepo；数据 SQLite，附件本地文件系统。**明确否决** Next.js · PostgreSQL · Redis（[SPEC §18](docs/SPEC.md)）。

| 目录 | 内容 |
|---|---|
| `apps/web` | React + Vite + TanStack Router/Query + motion + PWA |
| `apps/api` | Hono + better-sqlite3 + Drizzle + SSE + argon2/sharp |
| `apps/desktop` | Tauri 2 桌面薄壳（Rust） |
| `packages/shared` | 类型 + zod 校验 + 规则识别 |
| `SendToMyself/` | HarmonyOS ArkTS 原生壳 |

```bash
pnpm install
pnpm dev                  # api(:8787) + web(:5173) 同时启动
```

开发态不设 `AUTH_PASSWORD` 则认证关闭。

```bash
pnpm -r run typecheck     # 全量类型检查
```

桌面壳开发需 [Rust](https://tauri.app/start/prerequisites/)：

```bash
cd apps/desktop && pnpm tauri dev
```

## 认证与安全

单用户 argon2id 口令 + session cookie + 登录限速锁定；原生壳用长效 Bearer 设备令牌。全程 HTTPS，落盘默认依赖 NAS 卷加密。**不防服务器被完全攻破**（那需要端到端加密，V1 不做）。详见 [SPEC §12.4](docs/SPEC.md)。

## License

MIT
