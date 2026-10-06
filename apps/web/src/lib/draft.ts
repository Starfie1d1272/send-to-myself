export interface ComposerDraft {
  content: string;
  files: File[];
  dedupeKey?: string;
}

const DB = "send-to-myself-drafts";
const STORE = "drafts";
const KEY = "composer";
let connection: Promise<IDBDatabase> | undefined;
let writes: Promise<void> = Promise.resolve();

function database(): Promise<IDBDatabase> {
  if (!connection) {
    connection = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(DB, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(STORE);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error("草稿存储被占用"));
    }).catch((error) => { connection = undefined; throw error; });
  }
  return connection;
}

interface StoredFile { blob: Blob; name: string; lastModified: number }
interface StoredDraft { content: string; files: StoredFile[]; dedupeKey?: string }

export async function loadDraft(): Promise<ComposerDraft> {
  await writes;
  const db = await database();
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE).objectStore(STORE).get(KEY);
    request.onsuccess = () => {
      try {
      const saved = request.result as StoredDraft | undefined;
      resolve(saved ? { content: saved.content, ...(saved.dedupeKey ? { dedupeKey: saved.dedupeKey } : {}), files: saved.files.map((file) =>
        new File([file.blob], file.name, { type: file.blob.type, lastModified: file.lastModified })) }
        : { content: "", files: [] });
      } catch (error) { reject(error); }
    };
    request.onerror = () => reject(request.error);
  });
}

/** Preserve ordering: a slow attachment write must not resurrect a sent draft. */
export function saveDraft(draft: ComposerDraft): Promise<void> {
  const snapshot: StoredDraft = {
    content: draft.content,
    dedupeKey: draft.dedupeKey,
    files: draft.files.map((file) => ({ blob: file, name: file.name, lastModified: file.lastModified })),
  };
  const write = writes.catch(() => {}).then(async () => {
    const db = await database();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      if (!snapshot.content && snapshot.files.length === 0) tx.objectStore(STORE).delete(KEY);
      else tx.objectStore(STORE).put(snapshot, KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error ?? new Error("草稿保存失败"));
    });
  });
  writes = write;
  return write;
}

export const clearDraft = () => saveDraft({ content: "", files: [] });

export function newDedupeKey(): string {
  // getRandomValues works in LAN HTTP contexts where randomUUID is unavailable.
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
