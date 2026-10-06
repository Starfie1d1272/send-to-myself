import { createHash, randomUUID } from "node:crypto";
import { InboxClient } from "./client";

export interface PendingStore {
  getItem<T extends string>(key: string): Promise<T | undefined>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}
/** Each payload gets its own persistent key, so a failed note and failed clipboard send can coexist. */
export async function sendWithRetryKey(api: InboxClient, content: string, files: File[], store: PendingStore) {
  const hash = createHash("sha256").update(JSON.stringify([api.server, content]));
  for (const file of files) {
    hash.update(JSON.stringify([file.name, file.type, file.size]));
    hash.update(createHash("sha256").update(new Uint8Array(await file.arrayBuffer())).digest());
  }
  const storageKey = `pending-send:${hash.digest("hex")}`;
  let key: string | undefined;
  try {
    const raw = await store.getItem<string>(storageKey);
    const cached = raw ? JSON.parse(raw) : undefined;
    if (typeof cached?.key === "string" && cached.key && Date.now() - cached.createdAt < 7 * 86400_000) key = cached.key;
  } catch { /* replace invalid cache */ }
  key ??= randomUUID();
  await store.setItem(storageKey, JSON.stringify({ key, createdAt: Date.now() }));
  const result = await api.send(content, files, key);
  await store.removeItem(storageKey);
  return result;
}
