import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

/**
 * Drizzle 表结构，对应 docs/SPEC.md §3。
 * 时间戳统一用 unix 秒（integer）存储，对外 API 序列化为 ISO（见 lib/mapper.ts）。
 * 布尔用 integer mode:boolean。
 */

export const items = sqliteTable(
  "items",
  {
    id: text("id").primaryKey(), // 对外不可猜的 uid（nanoid）
    content: text("content").notNull().default(""),
    kind: text("kind").notNull(), // text | link | image | file

    // 内容属性（单选，与 todo 正交）
    category: text("category").notNull().default("none"), // none | idea | read_later

    // 执行状态（与 category 正交）
    isTodo: integer("is_todo", { mode: "boolean" }).notNull().default(false),
    completed: integer("completed", { mode: "boolean" }).notNull().default(false),
    dueAt: integer("due_at"), // unix 秒
    completedAt: integer("completed_at"),

    // 其它状态
    pinned: integer("pinned", { mode: "boolean" }).notNull().default(false),
    sensitive: integer("sensitive", { mode: "boolean" }).notNull().default(false),
    deletedAt: integer("deleted_at"), // 软删除；为空=正常

    // 客户端幂等键：原生壳离线队列补发时去重，避免同一条发送多次。
    // 客户端生成（uuid），为空=非队列来源（如网页直发）。
    dedupeKey: text("dedupe_key"),

    meta: text("meta"), // JSON 字符串：链接预览/识别建议等

    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [
    index("idx_items_created_at").on(t.createdAt),
    index("idx_items_deleted_at").on(t.deletedAt),
    uniqueIndex("idx_items_dedupe_key").on(t.dedupeKey),
  ],
);

export const attachments = sqliteTable(
  "attachments",
  {
    id: text("id").primaryKey(),
    itemId: text("item_id")
      .notNull()
      .references(() => items.id, { onDelete: "cascade" }),
    filename: text("filename").notNull(),
    mimeType: text("mime_type").notNull(),
    size: integer("size").notNull(),
    storageKey: text("storage_key").notNull(), // 相对键，如 2026/06/abc.pdf
    thumbKey: text("thumb_key"), // 服务端缩略图键（仅图片，可空）
    createdAt: integer("created_at").notNull(),
  },
  (t) => [index("idx_attachments_item_id").on(t.itemId)],
);

/** 登录会话（SPEC §12.3）。token 为对外不可猜值，存哈希更安全；单用户场景直存。 */
export const sessions = sqliteTable("sessions", {
  token: text("token").primaryKey(),
  createdAt: integer("created_at").notNull(),
  expiresAt: integer("expires_at").notNull(),
});

/**
 * 设备令牌（SPEC §12.3 扩展）：原生壳（鸿蒙/桌面）的分享处理程序无浏览器 cookie，
 * 用长效 Bearer token 认证。网页登录后签发，存入设备安全存储，随每次请求带上。
 */
export const deviceTokens = sqliteTable("device_tokens", {
  token: text("token").primaryKey(), // 对外不可猜值（base64url）
  name: text("name").notNull(), // 设备标签，如「鸿蒙手机」「Mac」
  createdAt: integer("created_at").notNull(),
  lastUsedAt: integer("last_used_at"), // 最近使用；用于「这台还活着吗」
  expiresAt: integer("expires_at"), // null = 长效（常驻壳）
});

export type ItemRow = typeof items.$inferSelect;
export type ItemInsert = typeof items.$inferInsert;
export type AttachmentRow = typeof attachments.$inferSelect;
export type AttachmentInsert = typeof attachments.$inferInsert;
export type SessionRow = typeof sessions.$inferSelect;
export type DeviceTokenRow = typeof deviceTokens.$inferSelect;
