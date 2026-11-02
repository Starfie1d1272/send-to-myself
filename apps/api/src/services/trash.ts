import { and, eq, isNotNull, isNull, lte } from "drizzle-orm";
import { db } from "../db/client.js";
import { attachments, deletedDedupeKeys, items } from "../db/schema.js";
import { env } from "../env.js";
import { remove } from "../lib/storage.js";
import { bus } from "../realtime/bus.js";

const nowSec = () => Math.floor(Date.now() / 1000);
const inFlight = new Map<string, Promise<"ok" | "not_in_trash" | "cleanup_failed">>();

export function initializeRetention() {
  const condition = and(isNotNull(items.deletedAt), isNull(items.purgeStartedAt));
  if (env.trashRetentionDays > 0) {
    db.update(items).set({ trashRetentionStartedAt: nowSec() }).where(and(condition, isNull(items.trashRetentionStartedAt))).run();
  } else db.update(items).set({ trashRetentionStartedAt: null }).where(condition).run();
}

export function permanentlyDeleteItem(id: string, automatic = false): Promise<"ok" | "not_in_trash" | "cleanup_failed"> {
  const current = inFlight.get(id);
  if (current) return current;
  const result = db.transaction(tx => {
    const row = tx.select().from(items).where(eq(items.id, id)).get();
    if (!row) return null;
    if (row.deletedAt === null) return "not_in_trash" as const;
    if (row.purgeStartedAt === null) {
      // A candidate may have been restored and deleted again while an earlier item was cleaned.
      if (automatic && (env.trashRetentionDays <= 0 || row.trashRetentionStartedAt === null ||
          row.trashRetentionStartedAt + env.trashRetentionDays * 86400 > nowSec())) return null;
      tx.update(items).set({ purgeStartedAt: nowSec() }).where(eq(items.id, id)).run();
    }
    return tx.select().from(attachments).where(eq(attachments.itemId, id)).all();
  });
  if (result === null) return Promise.resolve("ok");
  if (result === "not_in_trash") return Promise.resolve(result);
  const task = Promise.resolve().then(() => purgeFiles(id, result)).finally(() => inFlight.delete(id));
  inFlight.set(id, task);
  return task;
}

async function purgeFiles(id: string, result: Array<typeof attachments.$inferSelect>): Promise<"ok" | "cleanup_failed"> {
  bus.publish({ type: "item.updated", payload: { id } });
  for (const attachment of result) {
    try {
      await remove(attachment.storageKey);
      if (attachment.thumbKey) await remove(attachment.thumbKey);
    } catch {
      console.error(`Trash cleanup failed for item ${id}, attachment ${attachment.id}`);
      return "cleanup_failed";
    }
  }
  db.transaction(tx => {
    const row = tx.select().from(items).where(eq(items.id, id)).get();
    if (!row) return;
    if (row.dedupeKey) tx.insert(deletedDedupeKeys).values({ dedupeKey: row.dedupeKey, deletedAt: nowSec() }).onConflictDoNothing().run();
    tx.delete(items).where(eq(items.id, id)).run();
  });
  bus.publish({ type: "item.deleted", payload: { id } });
  return "ok";
}

let scanning = false;
async function scan() {
  if (scanning) return;
  scanning = true;
  try {
    const pending = db.select({ id: items.id }).from(items).where(isNotNull(items.purgeStartedAt)).all();
    const expired = env.trashRetentionDays > 0 ? db.select({ id: items.id }).from(items).where(and(
      isNotNull(items.deletedAt), isNull(items.purgeStartedAt),
      lte(items.trashRetentionStartedAt, nowSec() - env.trashRetentionDays * 86400),
    )).all() : [];
    for (const { id } of [...pending, ...expired]) {
      try { await permanentlyDeleteItem(id, true); } catch { console.error(`Trash cleanup failed for item ${id}`); }
    }
  } finally { scanning = false; }
}
export function startTrashScan() {
  void scan();
  const timer = setInterval(() => void scan(), 3600_000);
  timer.unref();
  return () => clearInterval(timer);
}
