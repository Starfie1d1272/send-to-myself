import { and, desc, eq, isNotNull, isNull, like, lt } from "drizzle-orm";
import { detect } from "@sendtomyself/shared/detect";
import type {
  CreateItemInput,
  Item,
  ItemCategory,
  ItemKind,
  LinkPreview,
  UpdateItemInput,
} from "@sendtomyself/shared";
import { db } from "../db/client.js";
import { type ItemInsert, items } from "../db/schema.js";
import { newId } from "../lib/id.js";
import { isoToSec, rowToItem } from "../lib/mapper.js";
import { bus } from "../realtime/bus.js";
import * as attachmentSvc from "./attachments.js";
import { type IncomingFile } from "./attachments.js";
import { fetchPreviewInto } from "./preview.js";

const nowSec = () => Math.floor(Date.now() / 1000);

export interface ListFilter {
  kind?: ItemKind;
  category?: ItemCategory;
  isTodo?: boolean;
  completed?: boolean;
  pinned?: boolean;
  sensitive?: boolean;
  q?: string;
  cursor?: string; // ISO；取严格早于此创建时间的
  limit?: number;
  deleted?: boolean; // true=回收站视图
}

export interface ListResult {
  items: Item[];
  nextCursor: string | null;
}

/** 依内容与附件推断展示类型（SPEC §2）。 */
function inferKind(contentKind: ItemKind, files: IncomingFile[]): ItemKind {
  if (files.some((f) => f.mimeType.startsWith("image/"))) return "image";
  if (files.length > 0) return "file";
  return contentKind;
}

/** 命中幂等键的现有记录（离线队列补发去重，SPEC §16）。无键或未命中返回 null。 */
function findByDedupeKey(dedupeKey: string | undefined): Item | null {
  if (!dedupeKey) return null;
  const row = db.select().from(items).where(eq(items.dedupeKey, dedupeKey)).get();
  return row ? rowToItem(row, attachmentSvc.listByItem(row.id)) : null;
}

/** 组装 item 插入行 + 识别建议（SPEC §1「发送时不分类」+ §6 自动识别）。 */
function buildRow(
  content: string,
  kind: ItemKind,
  det: ReturnType<typeof detect>,
  dedupeKey?: string,
): ItemInsert {
  const ts = nowSec();
  return {
    id: newId(),
    content,
    kind,
    category: "none",
    isTodo: false,
    completed: false,
    dueAt: null,
    completedAt: null,
    pinned: false,
    sensitive: det.secret.sensitive, // 疑似密钥自动遮罩
    deletedAt: null,
    dedupeKey: dedupeKey ?? null,
    meta: JSON.stringify({
      suggestions: {
        todo: det.todo,
        urls: det.urls,
        due: det.due, // { dueAt, matchedText } | null，待用户确认
        secretHint: det.secret.hint ?? null,
      },
    }),
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
  const det = detect(input.content);
  const row = buildRow(input.content, det.kind, det, input.dedupeKey);
  db.insert(items).values(row).run();
  const stored = db.select().from(items).where(eq(items.id, row.id!)).get()!;
  const dto = rowToItem(stored);
  bus.publish({ type: "item.created", payload: dto });
  schedulePreview(dto, det.urls);
  return dto;
}

/** 发送带附件的记录（图片/文件，可混合文字+链接，SPEC §2, §8）。 */
export async function createItemWithFiles(
  content: string,
  files: IncomingFile[],
  dedupeKey?: string,
): Promise<Item> {
  const dup = findByDedupeKey(dedupeKey);
  if (dup) return dup; // 离线补发重试，已存在则原样返回
  const det = detect(content);
  const kind = inferKind(det.kind, files);
  const row = buildRow(content, kind, det, dedupeKey);
  db.insert(items).values(row).run();

  for (const f of files) {
    await attachmentSvc.saveAttachment(row.id!, f);
  }

  const stored = db.select().from(items).where(eq(items.id, row.id!)).get()!;
  const atts = attachmentSvc.listByItem(row.id!);
  const dto = rowToItem(stored, atts);
  bus.publish({ type: "item.created", payload: dto });
  schedulePreview(dto, det.urls);
  return dto;
}

/** 手动重抓预览（失败/未抓时用户主动触发，SPEC §7）。同步等待结果并广播。 */
export async function refetchPreview(id: string): Promise<Item | null> {
  const row = db.select().from(items).where(eq(items.id, id)).get();
  if (!row) return null;
  const urls = detect(row.content).urls;
  const first = urls[0];
  if (!first) return rowToItem(row, attachmentSvc.listByItem(id));
  const updated = await fetchPreviewInto(id, first);
  if (updated) bus.publish({ type: "item.updated", payload: updated });
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
    void fetchPreviewInto(item.id, first).then((updated) => {
      if (!updated) return;
      bus.publish({ type: "item.updated", payload: updated });
      const status = (updated.meta?.preview as LinkPreview | undefined)?.status;
      if (status === "error" && attempt < 1) {
        setTimeout(() => schedulePreview(item, urls, attempt + 1), 4000);
      }
    });
  });
}

export function listItems(f: ListFilter): ListResult {
  const limit = f.limit ?? 30;
  const cond = [
    f.deleted ? isNotNull(items.deletedAt) : isNull(items.deletedAt),
  ];
  if (f.kind) cond.push(eq(items.kind, f.kind));
  if (f.category) cond.push(eq(items.category, f.category));
  if (f.isTodo !== undefined) cond.push(eq(items.isTodo, f.isTodo));
  if (f.completed !== undefined) cond.push(eq(items.completed, f.completed));
  if (f.pinned !== undefined) cond.push(eq(items.pinned, f.pinned));
  if (f.sensitive !== undefined) cond.push(eq(items.sensitive, f.sensitive));
  if (f.q) cond.push(like(items.content, `%${f.q}%`)); // 中文子串，SPEC §11
  if (f.cursor) cond.push(lt(items.createdAt, isoToSec(f.cursor)));

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
    nextCursor: hasMore && last ? new Date(last.createdAt * 1000).toISOString() : null,
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

  const set: Partial<ItemInsert> = { updatedAt: nowSec() };
  if (patch.content !== undefined) set.content = patch.content;
  if (patch.category !== undefined) set.category = patch.category;
  if (patch.isTodo !== undefined) set.isTodo = patch.isTodo;
  if (patch.pinned !== undefined) set.pinned = patch.pinned;
  if (patch.sensitive !== undefined) set.sensitive = patch.sensitive;
  if (patch.dueAt !== undefined) {
    set.dueAt = patch.dueAt === null ? null : isoToSec(patch.dueAt);
  }
  if (patch.completed !== undefined) {
    set.completed = patch.completed;
    set.completedAt = patch.completed ? nowSec() : null;
  }

  db.update(items).set(set).where(eq(items.id, id)).run();
  const row = db.select().from(items).where(eq(items.id, id)).get()!;
  const dto = rowToItem(row, attachmentSvc.listByItem(id));

  // 编辑正文后重跑识别并重抓链接预览（SPEC §7 编辑语义）。
  if (patch.content !== undefined) {
    const det = detect(patch.content);
    schedulePreview(dto, det.urls);
  }
  bus.publish({ type: "item.updated", payload: dto });
  return dto;
}

/** 软删除 → 回收站（SPEC §4, §9）。 */
export function softDeleteItem(id: string): boolean {
  const existing = db.select().from(items).where(eq(items.id, id)).get();
  if (!existing) return false;
  db.update(items).set({ deletedAt: nowSec(), updatedAt: nowSec() }).where(eq(items.id, id)).run();
  bus.publish({ type: "item.deleted", payload: { id } });
  return true;
}

/** 从回收站恢复。 */
export function restoreItem(id: string): Item | null {
  const existing = db.select().from(items).where(eq(items.id, id)).get();
  if (!existing) return null;
  db.update(items).set({ deletedAt: null, updatedAt: nowSec() }).where(eq(items.id, id)).run();
  const row = db.select().from(items).where(eq(items.id, id)).get()!;
  const dto = rowToItem(row, attachmentSvc.listByItem(id));
  bus.publish({ type: "item.updated", payload: dto });
  return dto;
}
