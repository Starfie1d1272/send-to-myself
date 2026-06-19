# HarmonyOS NEXT 原生薄壳 — 实现交接文档

> 这份文档是给 **DevEco Code / DevEco Studio AI 助手** 的完整契约，用来生成 SendToMyself 的鸿蒙原生壳。
> 把整篇喂给它即可，无需它去猜后端。读者假定熟悉 ArkTS / ArkUI / Stage 模型，但**不了解本项目后端**。
>
> 配套：产品边界见 `docs/SPEC.md`（尤其 §12 认证/部署、§14 客户端策略）；数据契约以 `packages/shared/src/schema.ts` 为最终事实来源。

---

## 0. 这个壳要做什么（一句话）

**它不是一个 App，是一层壳。** 业务逻辑 100% 在服务端，壳只干四件事：

1. **登录**：首次输入服务器地址 + 口令，拿到「设备令牌」并安全保存。
2. **展示**：一个全屏 `Web` 组件（ArkWeb）加载部署好的网页，用户日常就在里面用。
3. **接收系统分享**：从别的 App（浏览器、微信、相册…）分享文字/图片/文件进来 → 直接上传到服务端。
4. **离线补发**：分享时若断网，排队，联网后自动重发。

> **核心原则**：能在 WebView 里做的，绝不在原生侧重写。原生侧只写「分享桥 + 令牌存储 + 离线队列」这三块 WebView 做不到的。

---

## 1. 整体架构

```
┌─────────────────────────── 鸿蒙原生壳 (ArkTS) ───────────────────────────┐
│                                                                          │
│  EntryAbility (UIAbility)                                                 │
│    └─ 全屏 Web 组件  ──────────────►  加载 https://<你的域名>/             │
│                                       (用户日常就在这个 WebView 里)        │
│                                                                          │
│  ShareAbility (UIAbility, 处理系统分享 want)                              │
│    ├─ 解析 want.parameters 里的分享内容（文本 / 图片 / 文件）              │
│    ├─ 读取本地保存的设备令牌                                              │
│    ├─ POST 到服务端 API（带 Authorization: Bearer）                        │
│    └─ 失败 → 写入离线队列，注册网络恢复回调重试                            │
│                                                                          │
│  本地存储                                                                 │
│    ├─ Preferences(加密) / 关键资产：serverUrl + deviceToken               │
│    └─ Preferences / 文件：离线发送队列                                     │
└──────────────────────────────────────────────────────────────────────────┘
                                    │ HTTPS
                                    ▼
                        现有 Hono 后端（无需改动，已支持 Bearer + 幂等）
```

**两个 Ability 共享同一份令牌存储**：WebView 自己持 cookie，但分享路径不经过 WebView，必须用 Bearer 令牌独立认证。这是整个设计的关键。

---

## 2. 服务端 API 契约（壳要调的全部端点）

Base URL = 用户填的服务器地址，例如 `https://stm.example.com`。所有业务接口都在 `/api` 下。
认证方式二选一：网页用 session cookie（WebView 自动带）；**原生壳用 `Authorization: Bearer <deviceToken>`**。

### 2.1 登录与令牌

#### `POST /api/auth/login`
口令登录，拿 session（仅「铸造设备令牌」这一步需要，日常分享不用）。

请求：
```json
{ "password": "用户口令" }
```
成功 `200`：`{ "ok": true }`，并通过 `Set-Cookie: stm_session=...` 下发会话 cookie。
失败 `401`：`{ "error": "invalid_credentials" }`；被锁定 `429`：`{ "error": "locked", "retryAfter": 秒数 }`。

#### `POST /api/auth/devices`  ← **铸造设备令牌（壳登录流程的核心一步）**
需带上一步拿到的 session cookie。

请求：
```json
{ "name": "鸿蒙手机" }
```
成功 `201`：
```json
{ "token": "明文令牌，只在这次返回，必须立刻保存", "name": "鸿蒙手机", "createdAt": 1781874846 }
```
> ⚠️ `token` 明文**仅此一次返回**，拿到后立即写入加密存储。之后服务端只存得到尾 6 位，无法再取全量。

#### `GET /api/auth/devices`（可选，用于「设置-已授权设备」页）
返回 `{ "devices": [{ "name", "createdAt", "lastUsedAt", "tail": "尾6位" }] }`。

#### `DELETE /api/auth/devices/:tail`（可选，吊销）
按尾 6 位吊销，`204` 成功 / `404` 未命中。

#### `GET /api/auth/me`
探测：`{ "authEnabled": bool, "authenticated": bool }`。用于壳启动时判断令牌是否还有效。

### 2.2 发送内容（分享桥实际要调的）

#### `POST /api/items`  — 纯文字 / 链接
头：`Authorization: Bearer <token>`、`Content-Type: application/json`
请求：
```json
{ "content": "要发送的文字或链接", "dedupeKey": "客户端生成的uuid（离线去重用，可选但强烈建议带）" }
```
成功 `201`：返回完整 Item 对象（结构见 §3）。
**幂等**：带同一 `dedupeKey` 重发，服务端返回已存在的那条、**不重复创建**——这正是离线队列安全重试的依据。

#### `POST /api/items/upload`  — 带附件（图片 / 文件）
`multipart/form-data`，头带 `Authorization: Bearer <token>`（**不要手动设 Content-Type，让 HTTP 库自动加 boundary**）。
字段：
- `content`（可选文本，string）
- `files`（一个或多个文件，可重复字段名 `files`）
- `dedupeKey`（可选 string，同上）

成功 `201`：返回 Item（含 `attachments`）。单文件超限 `413`：`{ "error": "file_too_large", "limit": 字节, "filename": "..." }`。

> 鸿蒙侧：文本分享走 `/api/items`；图片/文件分享走 `/api/items/upload`。混合（文字+图）也走 upload，文字放 `content`。

### 2.3 错误约定
- `401 { "error": "unauthorized" }`：令牌无效/被吊销 → 壳应清掉本地令牌，引导用户重新登录。
- `400 { "error": "empty" }`：content 和 files 都为空。
- 网络层失败（超时/无连接）：进离线队列，**不要**当成永久失败。

---

## 3. 数据结构（Item，服务端返回体）

以 `packages/shared/src/schema.ts` 的 `itemSchema` 为准，壳只需「能发送 + 能解析返回的 id」，无需渲染（渲染交给 WebView）。关键字段：

```ts
{
  id: string,            // 服务端生成的不可猜 uid
  content: string,
  kind: "text" | "link" | "image" | "file",   // 服务端自动识别，壳不用管
  createdAt: string,     // ISO8601
  // …其余字段（category/isTodo/sensitive/attachments…）壳无需关心
}
```

分享桥只需：发送成功拿到 `201` 即可，可不解析 body（或仅取 `id` 做日志）。

---

## 4. 登录流程（壳首启）

```
1. 用户输入：服务器地址 + 口令
2. POST /api/auth/login  ─→ 拿到 session cookie（@ohos.net.http 会持 cookie，或手动从 Set-Cookie 取）
3. POST /api/auth/devices {name:"鸿蒙手机"}（带 cookie）─→ 拿 token 明文
4. 把 serverUrl + token 写入加密存储（见 §6）
5. （可选）POST /api/auth/logout 丢弃 session —— 日后只用 Bearer token，不再需要 session
6. 进入主界面：EntryAbility 的 Web 组件加载 serverUrl，用户开始日常使用
```

> 之后 token 长期有效（服务端默认不设过期）。除非用户在「设置」里吊销，或服务端被重置。

---

## 5. 系统分享接入（ShareAbility）

### 5.1 注册分享入口
在 `module.json5` 声明一个 UIAbility，通过 `skills` 注册接收分享意图，声明支持的 `uri` / `mimeType`（`text/plain`、`image/*`、`application/*` 等）。其他 App 的「分享」面板里就会出现本应用。

### 5.2 处理流程
```
ShareAbility.onCreate / onNewWant(want):
  1. 从 want.parameters 解析分享内容：
       - 纯文本 → 取文本字符串
       - 图片/文件 → 取 uri 列表，用文件接口读成可上传的数据
  2. 生成 dedupeKey = 一个 uuid（util.generateRandomUUID()）
  3. 读取本地 serverUrl + deviceToken（§6）
       - 若无令牌 → 提示「请先在应用内登录」，拉起 EntryAbility 登录
  4. 发送：
       - 纯文本 → POST /api/items   {content, dedupeKey}
       - 含文件 → POST /api/items/upload  (multipart: content?, files[], dedupeKey)
       并带 Authorization: Bearer <token>
  5. 成功(201) → toast「已发送」，结束 Ability（terminateSelf）
     网络失败 → 写入离线队列（§7），toast「已加入待发送，联网后自动发送」，结束
     401 → 清令牌，提示重新登录
```

> **体验要点**：分享应「一闪而过」——不弹自己的 UI，发完即关，像微信分享那样无感。只在「未登录」或「需要展示队列」时才显界面。

---

## 6. 令牌安全存储

- 用 **加密 Preferences** 或 **关键资产存储（@ohos.security.asset / AssetStore）** 保存 `serverUrl` 与 `deviceToken`。
- **不要**用明文 Preferences 存令牌。
- EntryAbility（WebView）和 ShareAbility **读同一份**存储。
- 令牌失效（收到 401）时清除，下次分享提示重新登录。

---

## 7. 离线发送队列（§16 第 1 项，超越微信的关键体验）

服务端已用 `dedupeKey` 保证幂等，**客户端可以放心无脑重试**。

```
队列项结构（存本地 Preferences / 文件，JSON 数组）：
  { dedupeKey, kind: "text"|"upload", content?, fileUris?[], createdAt }

入队：分享时网络失败 → push 一项
出队/重试触发：
  - App 启动时
  - 注册网络状态监听（@ohos.net.connection），网络恢复回调里触发
  - （可选）后台任务定时重试
重试逻辑：
  for 每个队列项：
    带原 dedupeKey 重发 →
      201 或 任意非网络错误的明确响应 → 从队列移除（幂等保证不会重复）
      仍是网络错误 → 保留，等下次
```

> 因为带的是**同一个 dedupeKey**，即便上一次其实已发成功只是响应没收到，重发也只会命中已有记录、不会产生重复。这是后端 `dedupeKey` 机制存在的全部理由。

---

## 8. WebView（EntryAbility）注意点

- 全屏 `Web({ src: serverUrl, controller })`，启用 `domStorageAccess`、`onlineImageAccess`。
- 让 WebView 自行处理 cookie（用户在网页里也能登录，cookie 与设备令牌互不干扰）。
- 处理返回键：WebView 能后退则后退，否则退出。
- 上传/下载：网页内的文件选择/下载尽量交给 ArkWeb 原生能力，壳不重写。
- 深色模式：跟随系统，网页自身已响应式（SPEC §15 第 20 项），壳不用管样式。

---

## 9. 给 AI 助手的实现顺序建议

1. **先跑通 WebView 主界面**（EntryAbility + Web 组件 + serverUrl 输入）——立刻能用，等于一个套壳浏览器。
2. **再做登录拿令牌**（§4）+ 加密存储（§6）。
3. **再做分享桥**（§5）——纯文本分享优先，跑通 `POST /api/items`。
4. **加图片/文件分享**（`/api/items/upload`）。
5. **最后加离线队列**（§7）。

每步都可独立验证，不必一次做完。

---

## 10. 验收清单

- [ ] 输入地址+口令能登录，令牌持久化，重启 App 不用再登。
- [ ] WebView 正常加载网页、可滚动可交互。
- [ ] 从浏览器分享一条链接 → 网页时间线里立刻出现（SSE 实时推送）。
- [ ] 从相册分享图片 → 时间线出现该图。
- [ ] 飞行模式下分享 → 提示已入队；恢复网络 → 自动补发且**不重复**。
- [ ] 在「设置-设备」吊销令牌后，分享得到 401 并提示重新登录。

---

## 附：后端已就位的改动（供核对，壳侧无需改后端）

提交 `feat(api): 设备令牌 Bearer 认证 + 离线队列幂等去重`：
- `device_tokens` 表 + 铸造/校验/列出/吊销；校验时刷新 `lastUsedAt`。
- `require-auth` 中间件接受 `Authorization: Bearer` 或 session cookie。
- `/api/auth/devices` 令牌管理（仅 session 可铸造/吊销）。
- `items.dedupeKey` 唯一索引 + 幂等去重；`createItem` / `/upload` 均接受 `dedupeKey`。
