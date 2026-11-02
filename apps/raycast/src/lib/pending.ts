import type { DetectionContext } from "./types";
import { createHash, randomUUID } from "node:crypto";
import { InboxClient } from "./client";

export interface PendingStore {
  getItem<T extends string>(key: string): Promise<T | undefined>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}
/** Each payload gets its own persistent key, so a failed note and failed clipboard send can coexist. */
export async function sendWithRetryKey(api: InboxClient, content: string, files: File[], store: PendingStore, onConfirmed?: () => Promise<void>, candidate?: DetectionContext) {
  const hash = createHash("sha256").update(JSON.stringify([api.server, content]));
  for (const file of files) {
    hash.update(JSON.stringify([file.name, file.type, file.size]));
    hash.update(createHash("sha256").update(new Uint8Array(await file.arrayBuffer())).digest());
  }
  const storageKey = `pending-send:${hash.digest("hex")}`;
  let key: string | undefined;
  let context: DetectionContext | undefined;
  const raw = await store.getItem<string>(storageKey);
  if (raw) {
    try {
      const cached = JSON.parse(raw);
      if (typeof cached?.key !== "string" || !cached.key || typeof cached.createdAt !== "number") throw new Error("invalid cache");
      if (cached.detectionContext !== undefined) {
        const c = cached.detectionContext;
        if (!c || typeof c.capturedAt !== "string" || c.capturedAt.length > 64 || !/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(c.capturedAt) || !Number.isFinite(Date.parse(c.capturedAt)) || !Number.isInteger(c.utcOffsetMinutes) || Math.abs(c.utcOffsetMinutes) > 840) throw new Error("invalid context");
        context = c;
      }
      key = cached.key;
    } catch { throw new Error("重试记录损坏，请先检查最近记录是否已收到，再修改内容发送。"); }
  }
  if (!key) {
    key = randomUUID(); context = candidate;
    await store.setItem(storageKey, JSON.stringify({ key, createdAt: Date.now(), detectionContext: context }));
  }
  const result = await api.send(content, files, key, context);
  // Keep retry identity until the caller has also cleared its durable draft.
  await onConfirmed?.();
  await store.removeItem(storageKey);
  return result;
}
