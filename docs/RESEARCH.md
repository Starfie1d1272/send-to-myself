# 竞品调研与产品审视（落地前 PM 视角）

> 日期：2026-06-19 · 目的：在动工前确认方向、痛点、决策与设计漏洞。结论已回写 [SPEC.md](SPEC.md) V1.1。

---

## 1. 竞品全景：本产品横跨 4 个品类

市面无单一产品与本项目重合，但每一块都有成熟玩家：

| 品类 | 代表产品 | 解决的 | 边界/不足 |
|---|---|---|---|
| 发给自己 / 互传 | 微信文件传输助手、Telegram Saved Messages、[LocalSend](https://localsend.org) / [PairDrop](https://pairdrop.net) | 跨设备快速丢东西 | 微信：无搜索、易丢、限速、隐私；LocalSend：**仅同局域网**、不留存 |
| 快速捕获 / 碎记 | **[Memos](https://usememos.com)**（47k★）、flomo | 统一时间线、发完即走、不分类 | Memos **不抓链接预览**、待办很弱；flomo 闭源云端 |
| 稍后读 / 收藏 | [Karakeep](https://github.com/karakeep-app/karakeep)（原 Hoarder）、[Linkwarden](https://linkwarden.app)、[Wallabag](https://wallabag.org)、Cubox | 存链接、抓正文、全文搜索 | 偏档案库，非「发给自己」的轻量入口；Linkwarden 需 PostgreSQL |
| 轻待办 | 各类 todo app | DDL、勾选 | 与捕获割裂，要二次录入 |

**本质** = Memos 的「统一时间线 + 发完即走」 + Karakeep 的「链接预览」 + 轻量 DDL + 原生分享客户端（尤其鸿蒙）。该组合目前无单一产品覆盖 = 机会；横跨 4 品类 = 最大风险（易做成四不像，靠 §17 红线约束）。

---

## 2. 现状与痛点（在替代什么）

**微信发给自己 / 文件传输助手：**
1. **搜不到** —— 最大痛点，翻历史几乎不可能（→ 本项目的搜索直击要害）
2. **会丢** —— 清理聊天记录即内容丢失；换设备迁移难
3. **不结构化** —— DDL、截图、备注混在一起，无法标记/分桶
4. 限速 / 限大小、依赖在线、隐私（腾讯服务器）

**Telegram Saved Messages**：能搜能 pin，但国内网络不可用，且仍是「聊天流」，无待办/DDL/链接归类。

**自托管同类（Memos 等）的不足**：笔记思维而非收件箱思维、链接不抓预览、几乎无原生鸿蒙端、国内链接（B站/小黑盒/公众号）预览不适配。

→ 细分（中文、自托管、发给自己、带 DDL、原生分享、国内链接兼容）确为真空。

---

## 3. Build vs Buy：为什么不直接用 Memos

[Memos](https://github.com/usememos/memos) 已免费开源实现 MVP 约 70%（统一时间线、发完即走、Markdown、标签、搜索、附件、Docker 部署、轻 todo）。

**自建成立的理由 = 它给不了的 30%：**
1. 链接预览 / 抓取（Memos 明确不做）
2. 一等公民的待办 + DDL + 到期分桶（Memos 仅 markdown checkbox）
3. 原生系统分享客户端（Android `ACTION_SEND` / 鸿蒙 Share Kit，无官方鸿蒙端）
4. 国内链接兼容 + 中文搜索调优
5. 「收件箱」心智而非「笔记」心智

拼 Memos + Karakeep = 两套系统两个数据库，反而更重 → 自建成立。
**决策**：自建，但**先实测并研读 Memos**，复用其 UX 与 schema 经验。

---

## 4. 研读 Memos 源码的直接收获（已 clone 学习）

1. **Memos 的搜索就是 `content LIKE '%关键词%'`，未用 FTS5**。对中文子串匹配有效 → 纠正「中文搜索是命门」的过度担忧：个人规模 `LIKE` 足够，要快再上 FTS5 `trigram`，**禁用默认分词器**即可。
2. **`payload TEXT DEFAULT '{}'` JSON 列**承载易变字段，不频繁改表 → 本项目 `meta` 列照搬，存链接预览与识别结果。
3. **`id`（内部自增）+ `uid`（对外不可猜）双标识** → URL 不暴露顺序 id。
4. **`row_status: NORMAL/ARCHIVED`** 状态枚举做归档；真删为硬删 → 本项目在其上加 `deletedAt` 回收站。
5. **附件 `storage_type + reference`** 支持本地/S3 多后端 → 本项目只用 NAS 路径，更简单。
6. 时间戳用 unix 秒 `BIGINT` 存储，排序省。

---

## 5. PM 视角发现的设计漏洞（已回写 SPEC）

### 🔴 硬伤（落地后改成本最高）
- **中文搜索**：禁用 FTS5 默认分词器，用 `LIKE` 或 `trigram`（SPEC §11）
- **链接预览 SSRF**：禁内网 IP、超时、限大小限跳转（SPEC §7）
- **敏感内容落盘**：明确威胁模型；服务端持钥字段加密可选，零易用性损耗（SPEC §12.4）
- **单密码爆破**：argon2 + 登录限速锁定（SPEC §12.3）

### 🟡 体验
- **实时同步**：核心卖点，从增强项提至 MVP，用 SSE（SPEC §12.5）
- **软删除/回收站**：误删救命，进 MVP（SPEC §4/§9）
- **离线发送队列**：对微信的超越点，V1.1 强烈建议（SPEC §16）
- 服务端生成缩略图；可配置文件大小上限（SPEC §8）

### 🟢 边界澄清
- 编辑链接重抓预览；编辑文字重跑识别（SPEC §7）
- 重复内容不去重（SPEC §10）
- 多设备并发 = `updatedAt` 最后写入胜出（SPEC §3）
- 备份须含恢复演练；加密密钥不进备份；schema 迁移从第一天起（SPEC §13）

---

## 6. 关键决策复核结论

| 决策 | 结论 |
|---|---|
| SQLite + FTS5/LIKE | ✅ 单用户最优；中文搜索按 §11 处理 |
| Hono + better-sqlite3 | ✅ 合理 |
| React + Vite + PWA | ✅ 够用，不为换框架折腾 |
| Capacitor（安卓）/ Tauri（桌面）| ✅ 薄壳最优解 |
| 鸿蒙原生 ArkTS | ⚠️ 必要（作者刚需），成本单独评估，置 V1.1 |
| 单密码认证 | 🟡 最低可用 + 限速，后续 passkey/TOTP |
| 主标记单选、发送不分类 | ✅ 比 Memos 更克制，假设成立 |

---

## 7. 整体判断

1. **方向成立**：细分真空、痛点真实，搜索 + DDL + 原生分享 + 国内链接兼容是别人给不了的组合。
2. **最大风险是范围**，不是技术 → 守住 §17 红线。
3. **落地前**：实测 Memos（已 clone）；硬伤已写进 SPEC。
4. **产品灵魂**：实时同步已提到 MVP——它才是「像发给自己」的关键。

---

## 参考来源

- [Memos 官方](https://usememos.com) · [GitHub usememos/memos](https://github.com/usememos/memos)
- [Karakeep（原 Hoarder）](https://github.com/karakeep-app/karakeep) · [Linkwarden](https://linkwarden.app) · [Wallabag](https://wallabag.org)
- [LocalSend](https://localsend.org) · [PairDrop](https://pairdrop.net)
- [selfh.st: Pocket/Omnivore 替代品（read-later 自托管）](https://selfh.st/alternatives/read-later/)
- [openalternative.co: Apple Notes 开源替代](https://openalternative.co/alternatives/apple-notes) · [Linkwarden 替代](https://openalternative.co/alternatives/linkwarden)
- 微信文件传输助手、Telegram Saved Messages、flomo、Cubox（中文社区讨论与官方说明）
