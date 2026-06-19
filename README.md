# SendToMyself

> A self-hosted, cross-platform inbox for sending text, links, images, files, and tasks to yourself.

部署在个人 NAS、通过域名访问的**单用户**跨平台「发给自己」统一信息流。用来替代「微信发给自己」，但搜索和后续处理能力更强。

在任意设备上，把文字、链接、图片和文件快速发进去；在其他设备立即获取；需要长期保留的内容可以搜索、标记、设为待办或设置截止时间。

完整需求与边界见 **[docs/SPEC.md](docs/SPEC.md)**（单一事实来源）。

## 状态

🚧 V1 开发前 — 仓库骨架阶段。

## 技术栈

全 TypeScript pnpm monorepo：

| 目录 | 内容 | 里程碑 |
|---|---|---|
| `apps/web` | React + Vite + PWA | V1 |
| `apps/api` | Hono + better-sqlite3 + SQLite FTS5 | V1 |
| `apps/android` | Capacitor 薄壳（系统分享入口） | V1.1 |
| `apps/harmony` | ArkTS 原生薄壳（Share Kit） | V1.1 |
| `apps/desktop` | Tauri 薄壳（Win/Mac） | V1.2 |
| `packages/shared` | Item/Attachment 类型 + zod 校验 + 规则识别 | V1 |

存储：SQLite（数据）+ NAS volume（附件）。部署：Docker Compose + 反向代理 + HTTPS。

## 客户端策略

一套 Web 代码 + 各平台**原生薄壳**。壳只负责：登录、展示 WebView、接收系统分享、上传、再分享。**所有业务逻辑都在服务端**。

## License

MIT
