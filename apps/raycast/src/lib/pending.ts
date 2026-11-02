import type { DetectionContext } from "./types";
import { createHash, randomUUID } from "node:crypto";
import { AlreadyDeletedError, InboxClient } from "./client";

export interface PendingStore {
  getItem<T extends string>(key: string): Promise<T | undefined>;
  allItems(): Promise<Record<string, string | number | boolean>>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}
type Attempt = { key: string; createdAt: number; detectionContext?: DetectionContext };
type Attempts = { attempts: Attempt[] };
function parseAttempt(value: unknown): Attempt {
  if (!value || typeof value !== "object") throw new Error("invalid cache");
  const record = value as Partial<Attempt>;
  if (typeof record.key !== "string" || !record.key || typeof record.createdAt !== "number") throw new Error("invalid cache");
  if (record.detectionContext !== undefined) {
    const c = record.detectionContext;
    if (!c || typeof c.capturedAt !== "string" || c.capturedAt.length > 64 || !/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(c.capturedAt) || !Number.isFinite(Date.parse(c.capturedAt)) || !Number.isInteger(c.utcOffsetMinutes) || Math.abs(c.utcOffsetMinutes) > 840) throw new Error("invalid context");
  }
  return record as Attempt;
}
/** Default retries the most recent unresolved attempt; explicit new preserves older attempts. */
export async function sendWithRetryKey(api: InboxClient, content: string, files: File[], store: PendingStore, onConfirmed?: () => Promise<void>, candidate?: DetectionContext, intent: "retry" | "new" = "retry") {
  const hash = createHash("sha256").update(JSON.stringify([api.server, content]));
  for (const file of files) {
    hash.update(JSON.stringify([file.name, file.type, file.size]));
    hash.update(createHash("sha256").update(new Uint8Array(await file.arrayBuffer())).digest());
  }
  const storageKey = `pending-send:${hash.digest("hex")}`;
  const prefix = `${storageKey}:attempt:`;
  const resolvedPrefix = `${storageKey}:resolved:`;
  const all = await store.allItems();
  const legacy = await store.getItem<string>(storageKey);
  const attempts: { attempt: Attempt; legacy: boolean }[] = [];
  try {
    if (legacy) {
      const cached: unknown = JSON.parse(legacy);
      const entries = cached && typeof cached === "object" && "attempts" in cached ? (cached as Attempts).attempts : [cached];
      if (!Array.isArray(entries) || !entries.length) throw new Error("invalid cache");
      for (const value of entries) {
        const attempt = parseAttempt(value);
        if (!(resolvedPrefix + attempt.key in all)) attempts.push({ attempt, legacy: true });
      }
    }
    for (const [key, value] of Object.entries(all)) {
      if (!key.startsWith(prefix)) continue;
      if (typeof value !== "string") throw new Error("invalid cache");
      const attempt = parseAttempt(JSON.parse(value));
      if (key !== prefix + attempt.key) throw new Error("invalid cache");
      attempts.push({ attempt, legacy: false });
    }
  } catch { throw new Error("重试记录损坏，请先检查最近记录是否已收到，再修改内容发送。"); }
  attempts.sort((a, b) => a.attempt.createdAt - b.attempt.createdAt || a.attempt.key.localeCompare(b.attempt.key));
  let selected = intent === "retry" ? attempts.at(-1) : undefined;
  if (!selected) {
    const attempt = { key: randomUUID(), createdAt: Date.now(), detectionContext: candidate };
    await store.setItem(prefix + attempt.key, JSON.stringify(attempt));
    selected = { attempt, legacy: false };
  }
  const { attempt } = selected;
  const removeAttempt = async () => {
    if (selected.legacy) await store.setItem(resolvedPrefix + attempt.key, "1");
    else await store.removeItem(prefix + attempt.key);
  };
  let result;
  try { result = await api.send(content, files, attempt.key, attempt.detectionContext); }
  catch (error) {
    if (error instanceof AlreadyDeletedError) await removeAttempt();
    throw error;
  }
  // Keep retry identity until the caller has also cleared its durable draft.
  await onConfirmed?.();
  await removeAttempt();
  return result;
}
