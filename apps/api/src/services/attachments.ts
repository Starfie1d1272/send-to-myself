import { eq, inArray } from "drizzle-orm";
import { db } from "../db/client.js";
import { type AttachmentInsert, type AttachmentRow, attachments } from "../db/schema.js";
import { newId } from "../lib/id.js";
import { makeKey, putBuffer, remove } from "../lib/storage.js";
import { isImageMime, makeThumbnail, thumbKey as thumbnailKey } from "../lib/thumbnail.js";

const nowSec = () => Math.floor(Date.now() / 1000);

export interface IncomingFile {
  filename: string;
  mimeType: string;
  data: Buffer;
}

/** 先准备文件；数据库行由调用方在同步事务中统一提交。 */
export async function prepareAttachment(
  itemId: string,
  file: IncomingFile,
): Promise<AttachmentInsert> {
  const storageKey = makeKey(file.filename);
  const candidateThumbKey = thumbnailKey(storageKey);
  try {
    await putBuffer(storageKey, file.data);
    const thumbKey = isImageMime(file.mimeType)
      ? await makeThumbnail(storageKey, file.data)
      : null;
    // best-effort 缩略图失败时也可能留下部分写入的文件。
    if (!thumbKey) await remove(candidateThumbKey);
    return {
      id: newId(), itemId, filename: file.filename, mimeType: file.mimeType,
      size: file.data.length, storageKey, thumbKey, createdAt: nowSec(),
    };
  } catch (error) {
    await Promise.all([remove(storageKey), remove(candidateThumbKey)]);
    throw error;
  }
}

/** 清理由未提交上传产生的文件（包括缩略图）。 */
export async function discardPrepared(rows: AttachmentInsert[]): Promise<void> {
  await Promise.all(rows.flatMap((row) => [
    remove(row.storageKey),
    ...(row.thumbKey ? [remove(row.thumbKey)] : []),
  ]));
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
