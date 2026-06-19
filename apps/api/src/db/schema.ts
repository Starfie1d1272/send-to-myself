import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

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

    meta: text("meta"), // JSON 字符串：链接预览/识别建议等

    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [
    index("idx_items_created_at").on(t.createdAt),
    index("idx_items_deleted_at").on(t.deletedAt),
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
    createdAt: integer("created_at").notNull(),
  },
  (t) => [index("idx_attachments_item_id").on(t.itemId)],
);

export type ItemRow = typeof items.$inferSelect;
export type ItemInsert = typeof items.$inferInsert;
export type AttachmentRow = typeof attachments.$inferSelect;
