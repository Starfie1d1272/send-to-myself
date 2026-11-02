import { env } from "../env.js";
import type { Attachment, Item } from "@sendtomyself/shared";
import type { AttachmentRow, ItemRow } from "../db/schema.js";

/** unix 秒 → ISO 字符串（API 对外格式）。 */
export const secToIso = (s: number | null | undefined): string | undefined =>
  s == null || !Number.isFinite(s) || Math.abs(s * 1000) > 8.64e15 ? undefined : new Date(s * 1000).toISOString();

/** ISO 字符串 → unix 秒。 */
export const isoToSec = (iso: string): number => Math.floor(Date.parse(iso) / 1000);

export function rowToItem(r: ItemRow, attachments?: AttachmentRow[]): Item {
  return {
    id: r.id,
    content: r.content,
    kind: r.kind as Item["kind"],
    category: r.category as Item["category"],
    isTodo: r.isTodo,
    completed: r.completed,
    dueAt: secToIso(r.dueAt),
    completedAt: secToIso(r.completedAt),
    pinned: r.pinned,
    sensitive: r.sensitive,
    sensitiveOverride: r.sensitiveOverride,
    deletedAt: secToIso(r.deletedAt),
    purgeStartedAt: secToIso(r.purgeStartedAt),
    trashExpiresAt: r.deletedAt !== null && r.trashRetentionStartedAt !== null && env.trashRetentionDays > 0 ? secToIso(r.trashRetentionStartedAt + env.trashRetentionDays * 86400) : undefined,
    meta: r.meta ? (JSON.parse(r.meta) as Item["meta"]) : undefined,
    attachments: attachments?.length ? attachments.map(rowToAttachment) : undefined,
    createdAt: new Date(r.createdAt * 1000).toISOString(),
    updatedAt: new Date(r.updatedAt * 1000).toISOString(),
  };
}

export function rowToAttachment(r: AttachmentRow): Attachment {
  return {
    id: r.id,
    itemId: r.itemId,
    filename: r.filename,
    mimeType: r.mimeType,
    size: r.size,
    hasThumb: r.thumbKey != null,
    createdAt: new Date(r.createdAt * 1000).toISOString(),
  };
}
