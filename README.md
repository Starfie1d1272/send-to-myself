# SendToMyself · 发给自己

> 自托管、跨平台的「发给自己」统一信息流。把文字、链接、图片、文件、待办随手发进来，所有设备实时同步——像「微信发给自己」，但能搜、能整理、能设待办。

把任何东西丢进来，**发送时不用分类**；需要时再搜索、标记、设为待办或加截止时间。一台发送，另一台**立即**出现。数据全在你自己的服务器上。

<p align="center">
  <img src="docs/screenshots/timeline-desktop.png" alt="时间线（桌面）" width="46%">
  <img src="docs/screenshots/timeline-mobile.png" alt="时间线（移动端）" width="23%">
  <img src="docs/screenshots/login.png" alt="登录" width="23%">
</p>

界面取向「温纸墨痕」：暖纸背景 + Fraunces 衬线刊头 + 赤陶橙强调色。

---

## 它能为你做什么

**📥 随手发，不打断**
文字 / 链接 / 图片（粘贴·拖拽·选择）/ 文件，可混合一起发。Enter 即发，上传在后台进行、不挡输入。

**⚡ 多设备实时同步**
这台发送，那台开着的页面立刻就有（SSE 推送）。手机随手存、电脑接着用。

**🔗 链接自动变好看**
自动抓取标题、域名、封面、favicon 生成预览卡。封面走服务端代理，连 B 站、公众号这类**有防盗链的图床也能正常显示**。

**🗂 发完再整理**
- 一键转**待办**、设截止日期，自动分桶（已过期 / 今天 / 明天 / 本周）；
- 中文 DDL 自动识别（「下周三前」→ 建议设为待办，需你确认）；
- 想法 / 稍后看、置顶、勾选完成。

**🔍 搜得到才有意义**
中文子串全文搜索。敏感内容参与索引、但结果里**不泄漏正文**。

**🔒 密钥自动遮罩**
疑似 API Key / Token（GitHub、AWS、各类密钥前缀）自动识别并**只遮住密钥本体**，前后文照常显示；点开看、再点一键复制。「密钥」筛选页一键聚合所有含密钥的条目。

**🗑 删了也能找回**
软删除进回收站、保留期内随时恢复。

**📴 离线也能发**
原生端断网时排队，联网自动补发，且**不会重复**（幂等去重）。

---

## 在哪用

一套网页核心 + 各平台**原生薄壳**：功能只写一遍（网页），各端薄壳只负责登录、显示、接收系统分享。

| 平台 | 形态 | 状态 |
|---|---|---|
| 浏览器 / PWA（全平台兜底） | 响应式网页，可安装 | ✅ 已实现 |
| 桌面 Windows / macOS | Tauri 薄壳（托盘常驻 + 全局快捷键速唤） | ✅ 已实现（`apps/desktop`） |
| HarmonyOS NEXT | ArkTS 原生壳（系统分享 + 离线队列） | 🚧 已起草，待真机测试（`SendToMyself/`） |
| Android | Capacitor 薄壳 | 📋 规划中 |

---

## 文档

- **[docs/SPEC.md](docs/SPEC.md)** — 完整需求与边界（单一事实来源）
- **[docs/DEPLOY.md](docs/DEPLOY.md)** — 自部署指南（Docker + 反代 + HTTPS）
- **[docs/HARMONY_SHELL.md](docs/HARMONY_SHELL.md)** — 鸿蒙原生壳实现契约
- **[docs/RESEARCH.md](docs/RESEARCH.md)** — 竞品与技术决策调研

---

# 开发者 / 自部署

全 TypeScript 的 pnpm monorepo；数据存 SQLite，附件落本地文件系统。**明确否决** Next.js · PostgreSQL · Redis · 对象存储 · 消息队列 · 微服务（[SPEC §18](docs/SPEC.md)）。

| 目录 | 内容 |
|---|---|
| `apps/web` | React + Vite + TanStack Router/Query + motion + PWA |
| `apps/api` | Hono + better-sqlite3 + Drizzle + SSE + argon2 / sharp |
| `apps/desktop` | Tauri 2 桌面薄壳（Rust） |
| `packages/shared` | Item/Attachment 类型 + zod 校验 + 规则识别 |
| `SendToMyself/` | HarmonyOS ArkTS 原生壳（DevEco 工程） |

数据模型是一种 `Item` + `Attachment`，多种视图——发送即入库、查看时再分类。

## 本地开发

需要 Node ≥ 20、pnpm 11。原生模块（better-sqlite3 / argon2 / sharp）按本机架构编译。

```bash
pnpm install
# 若原生模块二进制缺失：npm_config_build_from_source=true pnpm rebuild better-sqlite3
pnpm dev          # 同时启动 api(:8787) 与 web(:5173)
```

打开 http://localhost:5173 。开发态默认不设 `AUTH_PASSWORD` → 认证关闭（控制台会告警）。

```bash
pnpm -r run typecheck                       # 全量类型检查
pnpm --filter @sendtomyself/api db:generate # 改表后生成 Drizzle 迁移
pnpm --filter @sendtomyself/web build       # 前端生产构建
```

桌面壳（需 [Rust 工具链](https://tauri.app/start/prerequisites/)）：

```bash
cd apps/desktop && pnpm tauri dev           # 详见 apps/desktop/README.md
```

## 部署（Docker Compose）

单容器：API 同时托管前端静态资源；数据库与附件落盘到 `./data` 卷。前面接反向代理终止 HTTPS。

```bash
cp .env.example .env       # 务必设置一个强 AUTH_PASSWORD
docker compose up -d --build
```

服务监听 `127.0.0.1:8787`，将反代（Caddy/Nginx）指向它即可。**完整步骤（域名、反代、自动 HTTPS、验证）见 [docs/DEPLOY.md](docs/DEPLOY.md)**；环境变量见 [.env.example](.env.example)。

## 备份与恢复（SPEC §13）

> 未恢复过的备份等于无备份。

```bash
scripts/backup.sh                              # 在线一致性快照 + 附件 + JSON 导出 → ./backups/stm-<时间戳>/
scripts/restore.sh backups/stm-xxx --dry-run   # 恢复演练（校验完整性，不动现网）
scripts/restore.sh backups/stm-xxx             # 真正恢复（停服→覆盖→重启）
```

字段加密密钥（若启用）与服务端口令均不在备份内。

## 认证与威胁模型

单用户 argon2id 口令 + session cookie + 登录限速锁定；原生壳用长效 **Bearer 设备令牌**（网页登录后铸造）。传输全程 HTTPS，落盘默认依赖 NAS 卷加密。**不防御服务器被完全攻破**（那需要端到端加密，V1 不做）——本工具定位「快速发给自己」，非密码保险箱。详见 [SPEC §12.4](docs/SPEC.md)。

## License

MIT
