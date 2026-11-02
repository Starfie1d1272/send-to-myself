import type { DetectionContext } from "@sendtomyself/shared";

export interface ComposerDraft {
  content: string;
  detectionContext?: DetectionContext;
  files: File[];
  dedupeKey?: string;
  webSendAttempted?: boolean;
  nativeHandoffPending?: true;
}

const DB = "send-to-myself-drafts";
const STORE = "drafts";
const KEY = "composer";
let connection: Promise<IDBDatabase> | undefined;
let writes: Promise<void> = Promise.resolve();
let frozen = false;
let generation = 0;
export function freezeDraft(value: boolean) { if (value && !frozen) generation++; frozen = value; }
export function draftGeneration() { return generation; }
export function draftIsWritable() { return !frozen; }

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
interface StoredDraft { detectionContext?: DetectionContext; content: string; files: StoredFile[]; dedupeKey?: string; webSendAttempted?: boolean; nativeHandoffPending?: true }

export async function loadDraft(): Promise<ComposerDraft> {
  await writes;
  const db = await database();
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE).objectStore(STORE).get(KEY);
    request.onsuccess = () => {
      try {
      const saved = request.result as StoredDraft | undefined;
      resolve(saved ? { content: saved.content, detectionContext: saved.detectionContext, nativeHandoffPending: saved.nativeHandoffPending, webSendAttempted: saved.webSendAttempted ?? !!saved.dedupeKey, ...(saved.dedupeKey ? { dedupeKey: saved.dedupeKey } : {}), files: saved.files.map((file) =>
        new File([file.blob], file.name, { type: file.blob.type, lastModified: file.lastModified })) }
        : { content: "", files: [] });
      } catch (error) { reject(error); }
    };
    request.onerror = () => reject(request.error);
  });
}

/** Preserve ordering: a slow attachment write must not resurrect a sent draft. */
export function saveDraft(draft: ComposerDraft): Promise<void> {
  if (frozen) return Promise.reject(new Error("草稿写入已暂停"));
  return writeDraft(draft, generation);
}

function writeDraft(draft: ComposerDraft, expectedGeneration?: number): Promise<void> {
  const snapshot: StoredDraft = {
    content: draft.content,
    detectionContext: draft.detectionContext,
    dedupeKey: draft.dedupeKey,
    webSendAttempted: draft.webSendAttempted,
    nativeHandoffPending: draft.nativeHandoffPending,
    files: draft.files.map((file) => ({ blob: file, name: file.name, lastModified: file.lastModified })),
  };
  const write = writes.catch(() => {}).then(async () => {
    if (expectedGeneration !== undefined && (frozen || generation !== expectedGeneration)) throw new Error("草稿写入已暂停");
    const db = await database();
    if (expectedGeneration !== undefined && (frozen || generation !== expectedGeneration)) throw new Error("草稿写入已暂停");
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      if (!snapshot.content && snapshot.files.length === 0 && !snapshot.nativeHandoffPending && !snapshot.detectionContext) tx.objectStore(STORE).delete(KEY);
      else tx.objectStore(STORE).put(snapshot, KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error ?? new Error("草稿保存失败"));
    });
  });
  writes = write;
  return write;
}

export const clearDraft = () => writeDraft({ content: "", files: [] });

export function newDedupeKey(): string {
  // getRandomValues works in LAN HTTP contexts where randomUUID is unavailable.
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export interface EditSnapshot { content: string; savedAt: number; detectionContext?: DetectionContext }
export interface EditDraft extends EditSnapshot { itemId: string }
function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const result = writes.catch(() => {}).then(fn);
  writes = result.then(() => {}, () => {});
  return result;
}
function transaction<T>(operation: (store: IDBObjectStore, done: (value: T) => void, fail: (error: Error) => void) => void): Promise<T> {
  return database().then(db => new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    let result: T;
    operation(tx.objectStore(STORE), value => { result = value; }, reject);
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error("草稿存储失败"));
  }));
}
export function clearDraftIfKey(key: string, expectedGeneration?: number): Promise<void> {
  return enqueue(() => transaction<void>((store, done) => {
    const request = store.get(KEY);
    request.onsuccess = () => { if ((expectedGeneration === undefined || (!frozen && generation === expectedGeneration)) && (request.result as StoredDraft | undefined)?.dedupeKey === key) store.delete(KEY); done(); };
  }));
}
export function clearNativeHandoffIfKey(key: string, expectedGeneration: number): Promise<void> {
  return enqueue(() => transaction<void>((store, done) => {
    const request = store.get(KEY);
    request.onsuccess = () => {
      const saved = request.result as StoredDraft | undefined;
      if (!frozen && generation === expectedGeneration && saved?.dedupeKey === key && saved.nativeHandoffPending) {
        delete saved.nativeHandoffPending;
        if (!saved.content && saved.files.length === 0 && !saved.detectionContext) store.delete(KEY); else store.put(saved, KEY);
      }
      done();
    };
  }));
}
export async function loadEditDraft(id: string): Promise<EditDraft | undefined> {
  await writes;
  const db = await database();
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE).objectStore(STORE).get(`edit:${id}`);
    request.onsuccess = () => resolve(request.result as EditDraft | undefined);
    request.onerror = () => reject(request.error);
  });
}
export function saveEditDraft(id: string, content: string, detectionContext?: DetectionContext): Promise<EditSnapshot> {
  if (frozen) return Promise.reject(new Error("草稿写入已暂停"));
  const snapshot = { content, savedAt: Date.now(), detectionContext };
  return enqueue(() => transaction<EditSnapshot>((store, done, fail) => {
    const key = `edit:${id}`;
    const existing = store.get(key);
    existing.onsuccess = () => {
      if (existing.result) { store.put({ itemId: id, ...snapshot }, key); done(snapshot); return; }
      const count = store.count(IDBKeyRange.bound("edit:", "edit:\uffff"));
      count.onsuccess = () => {
        if (count.result >= 20) { fail(new Error("draft_full")); return; }
        store.put({ itemId: id, ...snapshot }, key); done(snapshot);
      };
    };
  }));
}
export function clearEditDraft(id: string, expected?: EditSnapshot): Promise<void> {
  return enqueue(() => transaction<void>((store, done) => {
    const key = `edit:${id}`;
    if (!expected) { store.delete(key); done(); return; }
    const request = store.get(key);
    request.onsuccess = () => {
      const value = request.result as EditDraft | undefined;
      if (value?.content === expected.content && value.savedAt === expected.savedAt && JSON.stringify(value.detectionContext) === JSON.stringify(expected.detectionContext)) store.delete(key);
      done();
    };
  }));
}
export function clearAllEditDrafts(): Promise<void> {
  return enqueue(() => transaction<void>((store, done) => { store.delete(IDBKeyRange.bound("edit:", "edit:\uffff")); done(); }));
}
