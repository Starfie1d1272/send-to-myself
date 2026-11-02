# HarmonyOS 客户端实现与接口契约

截至 2026-11-01，客户端主体为 ArkWeb，原生侧负责登录、系统分享与持久传输。1.1.0 的后台任务、逐条管理与向外分享已实现，待真机验收；详见 [传输实现与验收清单](HARMONY_TRANSFERS.md)。历史设备证据见 [设备审计](HARMONY_DEVICE_AUDIT.md)。

产品边界见 `docs/SPEC.md`，数据契约以 `packages/shared/src/schema.ts` 为准。

## 0. 客户端职责

1. 登录并在关键资产中保存服务器与设备令牌。
2. 用 ArkWeb 展示服务端网页，原生工具栏提供后台发送和传输管理入口。
3. 通过 ShareExtensionAbility 接收系统分享，内容先持久化后发送。
4. 用系统传输代理管理附件后台上传/下载，支持逐条查看、重试和取消。
5. 将下载完成的附件通过文件 URI 交给系统分享，或通过文件选择器保存。

## 1. 整体架构

```text
EntryAbility / MainPage
  ├─ ArkWeb → 时间线、搜索、普通网页输入
  ├─ UploadPage → 文件选择、持久化、后台上传
  ├─ TransfersPage → 逐条队列、进度、下载完成后的分享/保存
  └─ NativeBridge → 受来源限制的网页附件操作

ShareExtAbility.onSessionCreate
  └─ ShareHandler → ShareFiles → QueueService → request.agent / HTTP

关键资产：serverUrl、deviceToken
Preferences + filesDir：发送队列、下载记录、持久文件
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
4. 原子提交规范 origin、token 和新 revision（见 §6），再将原始 Set-Cookie 注入该 origin 并落盘
5. 进入主界面：Web 组件只加载已提交 origin；离线检查结果为 unknown 时保留连接
```

> 之后 token 长期有效（服务端默认不设过期）。除非用户在「设置」里吊销，或服务端被重置。

---

## 5. 系统分享接入（ShareExtAbility）

`module.json5` 中的 `ShareExtensionAbility` 声明 `ohos.want.action.sendData`，通过 `utd` 匹配文本、图片、文件及 PDF 所属的组合文档类型。

`onSessionCreate` 加载 SharePage，并通过 `systemShare.getSharedData(want)` 读取记录。链接归入文本，文件 URI 通过异步复制转成持久副本；先保存队列，再派发对应的上传或文字请求。成功完成的文字请求显示“已发送”；后台任务显示当前状态，之后可在传输页查看。

---

## 6. 令牌安全存储

- `ConnectionSession` 是连接的唯一所有者：origin、设备令牌与 revision 编码为同一条 Asset Store SECRET，使用 DEVICE_FIRST_UNLOCKED。连接锁跨主应用与分享扩展；旧的两个 alias 只在迁移时读取。
- 每次原生请求使用同一连接快照；401 仅在 origin 与 revision 仍匹配时使该代令牌失效。网络不可达不清除凭据。
- 宿主重登保留网页与草稿；有效设备令牌复用，明确失效或缺失时才签发新令牌。退出先清本机令牌并停止新派发，再尽力暂停任务和清理当前网页 Cookie。设备令牌不会自动在服务端撤销。
- 退出可能无法确认其他进程的在途请求已停止；用户仍可在传输记录查看待发送内容。Cookie 按 host 而非端口隔离。

---

## 7. 持久队列与后台附件传输

文本分享先入队再发送短 HTTP 请求；附件分享或原生文件选择通过 `request.agent` 的后台任务上传。`QueueService.ets` 保存内容、文件元数据、服务器、去重键和系统任务 ID，并兼容旧 `fileSandboxPaths`。

存储更新与逐条派发/删除均有跨进程文件锁。任务 ID 落盘后才开始传输；应用重启重新查询系统状态。成功确认后清理发送副本，失败保留；取消意图先持久化，系统任务移除成功后才删除文件。相同连接 revision 的暂停任务可继续；revision 变化后先移除旧任务，再以同一去重键和当前凭据重建。

应用启动、网络恢复和明确重试触发队列处理。传输页轮询状态，失败文字项不会随进度轮询反复发送。终止的上传任务可逐条重试；当前没有服务端分片续传协议。

系统后台执行、目标应用 URI 接收和完整恢复场景仍待真机验收；实现和限制见 [HARMONY_TRANSFERS.md](HARMONY_TRANSFERS.md)。

---

## 8. WebView（EntryAbility）注意点

- 全屏 `Web({ src: serverUrl, controller })`，启用 `domStorageAccess`、`onlineImageAccess`。
- TLS 证书错误取消加载，修正证书或服务器地址后重试，不允许无条件放行。
- 登录保留服务端 Set-Cookie 属性并等待持久化；宿主重登与退出使用 `stmNative` 的对应方法。Web 联动由 #44 接入。
- 处理返回键：WebView 能后退则后退，否则退出。
- 普通网页上传保留 WebView 路径；原生后台发送入口与附件分享/保存使用系统传输代理。新桥接限定当前服务器来源，原生构造附件请求地址。
- 深色、大字体与键盘适配需覆盖网页及原生页面，真机状态以设备审计记录为准。

---

## 9. 开发验证

Web 构建检查桥接调用与页面类型；官方 SDK 的 `assembleHap` 检查 ArkTS 与平台接口。`apps/web/test/harmony.test.mjs` 对非 UI 模块做恢复、并发与权限范围的定向模拟验证。系统分享面板、真实文件 URI 和后台调度必须另做真机验收。

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

### STM-08 版本边界

新 Web 与新壳共同提供首页原生附件确认和本机接受回执；新 Web 在旧壳或普通浏览器中使用网页文件选择；旧 Web 配合新壳时旧工具入口进入传输任务，附件仍走网页选择；旧 Web 配合旧壳保留旧行为。回执缺失不能证明没有入队，pending 草稿在桥不可用时仍保留。新下载使用核心的受保护附件 metadata；已完成的本机副本可在传输任务中离线保存或分享。异常退出或交接未知可能留下孤立 staging 副本，不自动扫描删除。此环境无 Harmony SDK 和真机，新增能力尚未完成 assembleHap 或设备验收，不代表稳定发布。
