import { and, desc, eq, exists, gte, isNotNull, isNull, like, lt, or, sql } from "drizzle-orm";
import { detect, detectSecret, detectUrls } from "@sendtomyself/shared/detect";
import type {
  CreateItemInput,
  DetectionContext,
  Item,
  ItemKind,
  ItemMeta,
  TimelineFilter,
  ItemPage,
  UpdateItemInput,
} from "@sendtomyself/shared";
import { env } from "../env.js";
import { db } from "../db/client.js";
import {
  attachments,
  deletedDedupeKeys,
  type AttachmentInsert,
  type ItemInsert,
  items,
} from "../db/schema.js";
import { decodeCursor, encodeCursor } from "../lib/cursor.js";
import { newId } from "../lib/id.js";
import { isoToSec, rowToItem } from "../lib/mapper.js";
import { bus } from "../realtime/bus.js";
import * as attachmentSvc from "./attachments.js";
import { type IncomingFile } from "./attachments.js";
import { fetchPreviewInto } from "./preview.js";

const nowSec = () => Math.floor(Date.now() / 1000);

export type ListFilter = TimelineFilter;
export type ListResult = ItemPage;

export class ItemError extends Error {}

/** Compute automatic fields only on creation or an actual content change. */
function computeContent(
  content: string,
  files: Array<{ mimeType: string }>,
  currentMeta: ItemMeta,
  override: boolean | null,
  previousContent?: string,
  context?: DetectionContext,
) {
  const det = detect(content, undefined, context);
  const kind: ItemKind = files.some((file) => file.mimeType.startsWith("image/"))
    ? "image"
    : files.length
      ? "file"
      : det.kind;
  const meta: ItemMeta = {
    ...currentMeta,
    suggestions: {
      todo: det.todo,
      urls: det.urls,
      due: det.due,
      secretHint: det.secret.hint ?? null,
    },
  };
  const first = det.urls[0];
  const oldFirst = previousContent === undefined ? undefined : detectUrls(previousContent)[0];
  let fetchUrls: string[] | undefined = det.urls;
  if (!first) {
    delete meta.preview;
  } else if (oldFirst === first && meta.preview?.url === first && meta.preview.status === "ok") {
    fetchUrls = undefined;
  } else {
    // Old in-flight requests cannot commit after the content changes.
    meta.preview = { url: first, status: "pending" };
  }
  return { kind, sensitive: override ?? det.secret.sensitive, meta, fetchUrls };
}

/** 命中幂等键的现有记录（离线队列补发去重，SPEC §16）。无键或未命中返回 null。 */
function findByDedupeKey(dedupeKey: string | undefined): Item | null {
  if (!dedupeKey) return null;
  const row = db.select().from(items).where(eq(items.dedupeKey, dedupeKey)).get();
  if (
    (row && row.purgeStartedAt !== null) ||
    db.select().from(deletedDedupeKeys).where(eq(deletedDedupeKeys.dedupeKey, dedupeKey)).get()
  )
    throw new ItemError("already_deleted");
  return row ? rowToItem(row, attachmentSvc.listByItem(row.id)) : null;
}

/** 组装 item 插入行 + 识别建议（SPEC §1「发送时不分类」+ §6 自动识别）。 */
function buildRow(
  content: string,
  computed: ReturnType<typeof computeContent>,
  dedupeKey?: string,
): ItemInsert {
  const ts = nowSec();
  return {
    id: newId(),
    content,
    kind: computed.kind,
    category: "none",
    isTodo: false,
    completed: false,
    dueAt: null,
    completedAt: null,
    pinned: false,
    sensitive: computed.sensitive,
    deletedAt: null,
    dedupeKey: dedupeKey ?? null,
    meta: JSON.stringify(computed.meta),
    createdAt: ts,
    updatedAt: ts,
  };
}

/**
 * 发送纯文字/链接（无附件）。识别结果仅作建议存入 meta；
 * 只有 `kind` 与 `sensitive` 自动采纳（SPEC §6）。todo/dueAt 需用户后续确认。
 */
export function createItem(input: CreateItemInput): Item {
  const dup = findByDedupeKey(input.dedupeKey);
  if (dup) return dup; // 离线补发重试，已存在则原样返回，不重复创建
  if (!input.content.trim()) throw new ItemError("empty");
  const computed = computeContent(input.content, [], {}, null, undefined, input.detectionContext);
  const row = buildRow(input.content, computed, input.dedupeKey);
  db.insert(items).values(row).run();
  const stored = db.select().from(items).where(eq(items.id, row.id!)).get()!;
  const dto = rowToItem(stored);
  bus.publish({ type: "item.created", payload: { id: dto.id } });
  if (computed.fetchUrls) schedulePreview(dto, computed.fetchUrls);
  return dto;
}

/** 发送带附件的记录（图片/文件，可混合文字+链接，SPEC §2, §8）。 */
export async function createItemWithFiles(
  content: string,
  files: IncomingFile[],
  dedupeKey?: string,
  detectionContext?: DetectionContext,
): Promise<Item> {
  const dup = findByDedupeKey(dedupeKey);
  if (dup) return dup; // 离线补发重试，已存在则原样返回
  if (!content.trim() && !files.length) throw new ItemError("empty");
  const computed = computeContent(content, files, {}, null, undefined, detectionContext);
  const row = buildRow(content, computed, dedupeKey);
  const prepared: AttachmentInsert[] = [];
  let dto: Item;
  let created: boolean;
  try {
    // await 文件 I/O 期间不持有 SQLite 事务，也不暴露半成品记录。
    for (const file of files) {
      prepared.push(await attachmentSvc.prepareAttachment(row.id!, file));
    }
    dto = db.transaction((tx) => {
      // 并发重试可能在文件准备期间完成；在提交前重新检查幂等键。
      const existing = findByDedupeKey(dedupeKey);
      if (existing) return existing;
      tx.insert(items).values(row).run();
      if (prepared.length) tx.insert(attachments).values(prepared).run();
      const stored = tx.select().from(items).where(eq(items.id, row.id!)).get()!;
      return rowToItem(stored, attachmentSvc.listByItem(row.id!));
    });
    created = dto.id === row.id;
  } catch (error) {
    await attachmentSvc.discardPrepared(prepared);
    throw error;
  }
  if (!created) {
    await attachmentSvc.discardPrepared(prepared);
    return dto;
  }
  bus.publish({ type: "item.created", payload: { id: dto.id } });
  if (computed.fetchUrls) schedulePreview(dto, computed.fetchUrls);
  return dto;
}

/** 手动重抓预览（失败/未抓时用户主动触发，SPEC §7）。同步等待结果并广播。 */
export async function refetchPreview(id: string): Promise<Item | null> {
  const row = db.select().from(items).where(eq(items.id, id)).get();
  if (!row) return null;
  const urls = detect(row.content).urls;
  const first = urls[0];
  if (!first) return rowToItem(row, attachmentSvc.listByItem(id));
  const updated = await fetchPreviewInto(id, first, row.content);
  if (updated) bus.publish({ type: "item.updated", payload: { id: updated.id } });
  return updated;
}

/**
 * 非阻塞抓取首个链接预览，成功后更新 meta 并广播 item.updated（SPEC §7）。
 * 失败（跨境超时等）自动重试一次，避免「必须手动点抓取」。
 */
function schedulePreview(item: Item, urls: string[], attempt = 0): void {
  const first = urls[0];
  if (!first) return;
  queueMicrotask(() => {
    void Promise.resolve()
      .then(() => {
        const current = db.select().from(items).where(eq(items.id, item.id)).get();
        if (
          !current ||
          current.deletedAt !== null ||
          current.content !== item.content ||
          detectUrls(current.content)[0] !== first
        )
          return;
        return fetchPreviewInto(item.id, first, item.content).then((updated) => {
          if (!updated) return;
          bus.publish({ type: "item.updated", payload: { id: updated.id } });
          const status = updated.meta?.preview?.status;
          if (status === "error" && attempt < 1) {
            setTimeout(() => schedulePreview(item, urls, attempt + 1), 4000);
          }
        });
      })
      .catch(() => console.error("Preview update failed"));
  });
}

export function listItems(f: ListFilter): ListResult {
  const limit = f.limit ?? 30;
  const cond = [f.deleted ? isNotNull(items.deletedAt) : isNull(items.deletedAt)];
  if (f.kind) cond.push(eq(items.kind, f.kind));
  if (f.category) cond.push(eq(items.category, f.category));
  if (f.isTodo !== undefined) cond.push(eq(items.isTodo, f.isTodo));
  if (f.completed !== undefined) cond.push(eq(items.completed, f.completed));
  if (f.pinned !== undefined) cond.push(eq(items.pinned, f.pinned));
  if (f.sensitive !== undefined) cond.push(eq(items.sensitive, f.sensitive));
  if (f.hasLinks !== undefined) {
    const count = sql<number>`coalesce(json_array_length(${items.meta}, '$.suggestions.urls'), 0)`;
    cond.push(f.hasLinks ? sql`${count} > 0` : sql`${count} = 0`);
  }
  for (const [value, image] of [
    [f.hasImages, true],
    [f.hasFiles, false],
  ] as const) {
    if (value === undefined) continue;
    const present = exists(
      db
        .select({ x: attachments.itemId })
        .from(attachments)
        .where(
          and(
            eq(attachments.itemId, items.id),
            image
              ? like(attachments.mimeType, "image/%")
              : sql`${attachments.mimeType} NOT LIKE 'image/%'`,
          ),
        ),
    );
    cond.push(value ? present : sql`NOT ${present}`);
  }
  if (f.dueFrom) cond.push(gte(items.dueAt, Math.ceil(Date.parse(f.dueFrom) / 1000)));
  if (f.dueBefore) cond.push(lt(items.dueAt, Math.ceil(Date.parse(f.dueBefore) / 1000)));
  if (f.q) {
    const kw = `%${f.q.replace(/[\\%_]/g, "\\$&")}%`;
    const match = (value: ReturnType<typeof sql>) => sql`${value} LIKE ${kw} ESCAPE ${"\\"}`;
    cond.push(
      or(
        match(sql`${items.content}`),
        ...["title", "description", "url", "domain"].map((field) =>
          match(sql`json_extract(${items.meta}, ${`$.preview.${field}`})`),
        ),
        sql`EXISTS (SELECT 1 FROM json_each(${items.meta}, '$.suggestions.urls') WHERE value LIKE ${kw} ESCAPE ${"\\"})`,
        exists(
          db
            .select({ x: attachments.itemId })
            .from(attachments)
            .where(and(eq(attachments.itemId, items.id), match(sql`${attachments.filename}`))),
        ),
      )!,
    );
  }
  if (f.cursor) {
    const cursor = decodeCursor(f.cursor);
    cond.push(
      cursor.id === undefined
        ? lt(items.createdAt, cursor.createdAt)
        : or(
            lt(items.createdAt, cursor.createdAt),
            and(eq(items.createdAt, cursor.createdAt), lt(items.id, cursor.id)),
          )!,
    );
  }

  const rows = db
    .select()
    .from(items)
    .where(and(...cond))
    .orderBy(desc(items.createdAt), desc(items.id))
    .limit(limit + 1)
    .all();

  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);
  const last = page.at(-1);
  const attMap = attachmentSvc.listByItems(page.map((r) => r.id));
  return {
    items: page.map((r) => rowToItem(r, attMap.get(r.id))),
    nextCursor: hasMore && last ? encodeCursor(last.createdAt, last.id) : null,
  };
}

export function getItem(id: string): Item | null {
  const row = db.select().from(items).where(eq(items.id, id)).get();
  return row ? rowToItem(row, attachmentSvc.listByItem(id)) : null;
}

/** 查看时再分类（SPEC §1）：仅更新可变字段。 */
export function updateItem(id: string, patch: UpdateItemInput): Item | null {
  const existing = db.select().from(items).where(eq(items.id, id)).get();
  if (!existing) return null;
  if (existing.purgeStartedAt !== null) throw new ItemError("purge_in_progress");

  const atts = attachmentSvc.listByItem(id);
  const content = patch.content ?? existing.content;
  if (!content.trim() && !atts.length) throw new ItemError("empty");
  if (patch.isTodo === false && (patch.completed === true || patch.dueAt != null))
    throw new ItemError("invalid_todo_state");
  const set: Partial<ItemInsert> = { updatedAt: nowSec() };
  if (patch.content !== undefined) set.content = content;
  if (patch.category !== undefined) set.category = patch.category;
  if (patch.pinned !== undefined) set.pinned = patch.pinned;
  let isTodo = patch.isTodo ?? existing.isTodo;
  let completed = patch.completed ?? existing.completed;
  let completedAt =
    patch.completed === undefined
      ? existing.completedAt
      : patch.completed
        ? existing.completed
          ? existing.completedAt
          : nowSec()
        : null;
  let dueAt =
    patch.dueAt === undefined
      ? existing.dueAt
      : patch.dueAt === null
        ? null
        : isoToSec(patch.dueAt);
  if (patch.isTodo === false) {
    isTodo = false;
    completed = false;
    completedAt = null;
    dueAt = null;
  } else if (patch.completed === true || patch.dueAt != null) isTodo = true;
  if (!isTodo) {
    completed = false;
    completedAt = null;
    dueAt = null;
  }
  set.isTodo = isTodo;
  set.completed = completed;
  set.completedAt = completedAt;
  set.dueAt = dueAt;
  const override = patch.sensitive === undefined ? existing.sensitiveOverride : patch.sensitive;
  set.sensitiveOverride = override;
  let urls: string[] | undefined;
  if (content !== existing.content) {
    const currentMeta: ItemMeta = existing.meta ? JSON.parse(existing.meta) : {};
    const computed = computeContent(
      content,
      atts,
      currentMeta,
      override,
      existing.content,
      patch.detectionContext,
    );
    urls = computed.fetchUrls;
    set.meta = JSON.stringify(computed.meta);
    set.kind = computed.kind;
    set.sensitive = computed.sensitive;
  } else if (patch.sensitive !== undefined)
    set.sensitive = override ?? detectSecret(content).sensitive;
  db.update(items)
    .set(set)
    .where(and(eq(items.id, id), isNull(items.purgeStartedAt)))
    .run();
  const row = db.select().from(items).where(eq(items.id, id)).get()!;
  const dto = rowToItem(row, atts);
  if (urls) schedulePreview(dto, urls);

  bus.publish({ type: "item.updated", payload: { id: dto.id } });
  return dto;
}

/** 软删除 → 回收站（SPEC §4, §9）。 */
export function softDeleteItem(id: string): boolean {
  const existing = db.select().from(items).where(eq(items.id, id)).get();
  if (!existing) return false;
  if (existing.deletedAt !== null) return true;
  const now = nowSec();
  db.update(items)
    .set({
      deletedAt: now,
      trashRetentionStartedAt: env.trashRetentionDays > 0 ? now : null,
      updatedAt: now,
    })
    .where(eq(items.id, id))
    .run();
  bus.publish({ type: "item.deleted", payload: { id } });
  return true;
}

/** 从回收站恢复。 */
export function restoreItem(id: string): Item | null {
  const existing = db.select().from(items).where(eq(items.id, id)).get();
  if (!existing) return null;
  if (existing.purgeStartedAt !== null) throw new ItemError("purge_in_progress");
  db.update(items)
    .set({ deletedAt: null, trashRetentionStartedAt: null, updatedAt: nowSec() })
    .where(and(eq(items.id, id), isNull(items.purgeStartedAt)))
    .run();
  const row = db.select().from(items).where(eq(items.id, id)).get()!;
  const dto = rowToItem(row, attachmentSvc.listByItem(id));
  bus.publish({ type: "item.updated", payload: { id: dto.id } });
  return dto;
}
