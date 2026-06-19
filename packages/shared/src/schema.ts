import { z } from "zod";

/**
 * 数据契约 —— 单一事实来源。
 * zod schema 为准，TS 类型由其推断（避免双份维护）。
 * 对应 docs/SPEC.md §3。
 */

// —— 枚举 ——

/** 展示类型，系统自动识别，用户不选。 */
export const itemKind = z.enum(["text", "link", "image", "file"]);
export type ItemKind = z.infer<typeof itemKind>;

/**
 * 内容属性（单选）。注意：`todo` 不在此处 —— 它是执行状态，
 * 与内容属性正交，独立成 `isTodo` 字段（见 SPEC §3）。
 */
export const itemCategory = z.enum(["none", "idea", "read_later"]);
export type ItemCategory = z.infer<typeof itemCategory>;

// —— 公共片段 ——

/** 对外不可猜的 uid（nanoid/uuid），非自增主键。 */
const id = z.string().min(1);
const isoDateTime = z.string().datetime({ offset: true });

// —— Attachment ——

export const attachmentSchema = z.object({
  id,
  itemId: id,
  filename: z.string().min(1),
  mimeType: z.string().min(1),
  size: z.number().int().nonnegative(),
  /** 相对存储键，如 "2026/06/abc123.pdf"；实际位置 = STORAGE_ROOT + storageKey。 */
  storageKey: z.string().min(1),
  /** 是否有服务端缩略图（仅图片）。客户端据此决定走 /thumb 还是 /raw。 */
  hasThumb: z.boolean().optional(),
  createdAt: isoDateTime,
});
export type Attachment = z.infer<typeof attachmentSchema>;

// —— 链接预览（存于 meta.preview，抓取成功后填充，SPEC §7）——

export const linkPreviewSchema = z.object({
  url: z.string(),
  domain: z.string().optional(),
  title: z.string().optional(),
  description: z.string().optional(),
  favicon: z.string().optional(),
  image: z.string().optional(),
  /** 抓取状态：未抓 / 成功 / 失败（失败仍保留原始 URL）。 */
  status: z.enum(["pending", "ok", "error"]).optional(),
  fetchedAt: isoDateTime.optional(),
});
export type LinkPreview = z.infer<typeof linkPreviewSchema>;

// —— Item ——

export const itemSchema = z.object({
  id,
  content: z.string(),

  kind: itemKind,

  // 内容属性（单选，与 todo 正交）
  category: itemCategory,

  // 执行状态（与 category 正交）
  isTodo: z.boolean(),
  completed: z.boolean(),
  dueAt: isoDateTime.optional(),
  completedAt: isoDateTime.optional(),

  // 其它状态
  pinned: z.boolean(),
  /** 疑似密钥/手动标记：UI 默认遮罩正文，但仍参与搜索（SPEC §11）。 */
  sensitive: z.boolean(),
  /** 软删除/回收站；为空=正常。 */
  deletedAt: isoDateTime.optional(),

  /** 链接预览、自动识别结果等易变字段（Memos payload 模式）。 */
  meta: z.record(z.unknown()).optional(),

  /** 同条记录的附件（随时间线一并下发，便于直接渲染）。 */
  attachments: z.array(attachmentSchema).optional(),

  createdAt: isoDateTime,
  /** 多设备并发以此做「最后写入胜出」。 */
  updatedAt: isoDateTime,
});
export type Item = z.infer<typeof itemSchema>;

// —— 入参（客户端 → 服务端）——

/**
 * 创建：发送时不分类，仅需正文（附件走 multipart 单独上传）。
 * kind / category / sensitive 等由服务端自动识别填充。
 */
export const createItemInput = z.object({
  content: z.string().max(100_000).default(""),
  /**
   * 幂等键（可选）：原生壳离线队列补发时带上同一值，服务端据此去重，
   * 避免弱网重试造成重复。客户端生成（uuid）；网页直发可不填。
   */
  dedupeKey: z.string().min(1).max(64).optional(),
});
export type CreateItemInput = z.infer<typeof createItemInput>;

/** 更新：仅可改这些可变字段（查看时再分类）。 */
export const updateItemInput = z
  .object({
    content: z.string().max(100_000),
    category: itemCategory,
    isTodo: z.boolean(),
    completed: z.boolean(),
    dueAt: isoDateTime.nullable(),
    pinned: z.boolean(),
    sensitive: z.boolean(),
  })
  .partial();
export type UpdateItemInput = z.infer<typeof updateItemInput>;

// —— 时间线查询 ——

export const timelineFilter = z
  .object({
    kind: itemKind.optional(),
    category: itemCategory.optional(),
    isTodo: z.boolean().optional(),
    completed: z.boolean().optional(),
    pinned: z.boolean().optional(),
    /** 关键词搜索（正文/标题/URL/文件名）。 */
    q: z.string().optional(),
    /** 游标分页：上一页最后一条的 createdAt（SPEC §9）。 */
    cursor: isoDateTime.optional(),
    limit: z.number().int().min(1).max(100).default(30),
  })
  .partial({ limit: true });
export type TimelineFilter = z.infer<typeof timelineFilter>;

/** DDL 到期分桶（仅展示，不做完整日历，SPEC §4）。 */
export const dueBucket = z.enum([
  "overdue",
  "today",
  "tomorrow",
  "this_week",
  "later",
]);
export type DueBucket = z.infer<typeof dueBucket>;
