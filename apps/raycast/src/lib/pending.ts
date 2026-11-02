import type { DetectionContext } from "./types";
import { createHash, randomUUID } from "node:crypto";
import { AlreadyDeletedError, InboxClient } from "./client";

export interface PendingStore {
  getItem<T extends string>(key: string): Promise<T | undefined>;
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
  const readAttempts = async (): Promise<Attempt[]> => {
    const raw = await store.getItem<string>(storageKey);
    if (!raw) return [];
    try {
      const cached: unknown = JSON.parse(raw);
      if (cached && typeof cached === "object" && "attempts" in cached) {
        const entries = (cached as Attempts).attempts;
        if (!Array.isArray(entries) || !entries.length) throw new Error("invalid cache");
        return entries.map(parseAttempt);
      }
      return [parseAttempt(cached)];
    } catch { throw new Error("重试记录损坏，请先检查最近记录是否已收到，再修改内容发送。"); }
  };
  const attempts = await readAttempts();
  let attempt = intent === "retry" ? attempts.at(-1) : undefined;
  if (!attempt) {
    attempt = { key: randomUUID(), createdAt: Date.now(), detectionContext: candidate };
    attempts.push(attempt);
    await store.setItem(storageKey, JSON.stringify({ attempts }));
  }
  const removeAttempt = async () => {
    const current = await readAttempts();
    const remaining = current.filter(entry => entry.key !== attempt!.key);
    if (remaining.length === current.length) return;
    if (remaining.length) await store.setItem(storageKey, JSON.stringify({ attempts: remaining }));
    else await store.removeItem(storageKey);
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
