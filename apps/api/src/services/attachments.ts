import { eq, inArray } from "drizzle-orm";
import { db } from "../db/client.js";
import { type AttachmentInsert, type AttachmentRow, attachments } from "../db/schema.js";
import { newId } from "../lib/id.js";
import { makeKey, putBuffer, remove } from "../lib/storage.js";
import { isImageMime, makeThumbnail } from "../lib/thumbnail.js";

const nowSec = () => Math.floor(Date.now() / 1000);

export interface IncomingFile {
  filename: string;
  mimeType: string;
  data: Buffer;
}

/** 保存单个附件：落盘 + 图片生成缩略图 + 入库（SPEC §8）。 */
export async function saveAttachment(
  itemId: string,
  file: IncomingFile,
): Promise<AttachmentRow> {
  const storageKey = makeKey(file.filename);
  await putBuffer(storageKey, file.data);

  let thumbKey: string | null = null;
  if (isImageMime(file.mimeType)) {
    thumbKey = await makeThumbnail(storageKey, file.data);
  }

  const row: AttachmentInsert = {
    id: newId(),
    itemId,
    filename: file.filename,
    mimeType: file.mimeType,
    size: file.data.length,
    storageKey,
    thumbKey,
    createdAt: nowSec(),
  };
  db.insert(attachments).values(row).run();
  return db.select().from(attachments).where(eq(attachments.id, row.id!)).get()!;
}

export function listByItem(itemId: string): AttachmentRow[] {
  return db.select().from(attachments).where(eq(attachments.itemId, itemId)).all();
}

/** 批量取多条 item 的附件，返回 itemId → 附件数组（时间线渲染用）。 */
export function listByItems(itemIds: string[]): Map<string, AttachmentRow[]> {
  const map = new Map<string, AttachmentRow[]>();
  if (itemIds.length === 0) return map;
  const rows = db.select().from(attachments).where(inArray(attachments.itemId, itemIds)).all();
  for (const r of rows) {
    const arr = map.get(r.itemId) ?? [];
    arr.push(r);
    map.set(r.itemId, arr);
  }
  return map;
}

export function getAttachment(id: string): AttachmentRow | null {
  return db.select().from(attachments).where(eq(attachments.id, id)).get() ?? null;
}

/** 删除附件：清文件 + 缩略图 + 行。 */
export async function deleteAttachment(id: string): Promise<boolean> {
  const row = getAttachment(id);
  if (!row) return false;
  await remove(row.storageKey);
  if (row.thumbKey) await remove(row.thumbKey);
  db.delete(attachments).where(eq(attachments.id, id)).run();
  return true;
}
