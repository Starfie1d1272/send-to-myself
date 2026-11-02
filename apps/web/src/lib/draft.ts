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
const EPOCH = "session-epoch";
const ATTEMPT_POINTER = "send-to-myself-pending-attempt";
const attemptKey = (key: string) => `attempt:${key}`;
function attemptPointer(): string | undefined {
  try { return sessionStorage.getItem(ATTEMPT_POINTER) || undefined; } catch { return undefined; }
}
function setAttemptPointer(key: string): boolean {
  try { sessionStorage.setItem(ATTEMPT_POINTER, key); return true; } catch { return false; }
}
function clearAttemptPointer(key: string): void {
  try { if (sessionStorage.getItem(ATTEMPT_POINTER) === key) sessionStorage.removeItem(ATTEMPT_POINTER); } catch { /* storage may be unavailable */ }
}
export function disownAttempt(): void {
  const key = attemptPointer();
  if (key) clearAttemptPointer(key);
}
let sessionEpoch: number | undefined;
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
  if (sessionEpoch === undefined) await resumeDraftSession();
  return new Promise((resolve, reject) => {
    const store = db.transaction(STORE).objectStore(STORE);
    const pointer = attemptPointer();
    const request = store.get(pointer ? attemptKey(pointer) : KEY);
    request.onsuccess = () => {
      if (pointer && !request.result) {
        clearAttemptPointer(pointer);
        const fallback = store.get(KEY);
        fallback.onsuccess = () => finish(fallback.result as StoredDraft | undefined);
        fallback.onerror = () => reject(fallback.error);
        return;
      }
      finish(request.result as StoredDraft | undefined);
    };
    const finish = (saved: StoredDraft | undefined) => {
      try {
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

function stored(draft: ComposerDraft): StoredDraft {
  return { content: draft.content, detectionContext: draft.detectionContext, dedupeKey: draft.dedupeKey,
    webSendAttempted: draft.webSendAttempted, nativeHandoffPending: draft.nativeHandoffPending,
    files: draft.files.map(file => ({ blob: file, name: file.name, lastModified: file.lastModified })) };
}
function writeDraft(draft: ComposerDraft, expectedGeneration?: number): Promise<void> {
  const snapshot = stored(draft);
  return enqueue(() => transaction<void>((store, done) => {
    if (expectedGeneration !== undefined && (frozen || generation !== expectedGeneration)) throw new Error("草稿写入已暂停");
    if (!snapshot.content && !snapshot.files.length && !snapshot.nativeHandoffPending && !snapshot.detectionContext) store.delete(KEY);
    else store.put(snapshot, KEY);
    done();
  }));
}
/** Persist the attempt only while the composer still belongs to this window. */
export function prepareComposerDraft(draft: ComposerDraft, expectedKey: string | undefined): Promise<boolean> {
  if (frozen) return Promise.reject(new Error("草稿写入已暂停"));
  const expectedGeneration = generation;
  const snapshot = stored(draft);
  const pointed = !!draft.dedupeKey && setAttemptPointer(draft.dedupeKey);
  return enqueue(() => transaction<boolean>((store, done) => {
    const request = store.get(KEY);
    request.onsuccess = () => {
      if (frozen || generation !== expectedGeneration) { done(false); return; }
      const current = request.result as StoredDraft | undefined;
      if (pointed && draft.dedupeKey) store.put(snapshot, attemptKey(draft.dedupeKey));
      const owned = !current || current.dedupeKey === expectedKey;
      if (owned) store.put(snapshot, KEY);
      done(owned || pointed);
    };
  }));
}

export const clearDraft = () => writeDraft({ content: "", files: [] });

export function newDedupeKey(): string {
  // getRandomValues works in LAN HTTP contexts where randomUUID is unavailable.
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export interface EditSnapshot { content: string; savedAt: number; detectionContext?: DetectionContext }
export interface EditDraft extends EditSnapshot { itemId: string }
function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const scheduledGeneration = generation;
  const result = writes.catch(() => {}).then(() => {
    if (frozen || generation !== scheduledGeneration) throw new Error("草稿写入已暂停");
    return fn();
  });
  writes = result.then(() => {}, () => {});
  return result;
}
function transaction<T>(operation: (store: IDBObjectStore, done: (value: T) => void, fail: (error: Error) => void) => void): Promise<T> {
  const localGeneration = generation;
  return database().then(db => new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    let result: T;
    let failure: Error | undefined;
    const request = store.get(EPOCH);
    request.onsuccess = () => {
      const epoch = typeof request.result === "number" ? request.result : 0;
      if (sessionEpoch === undefined) sessionEpoch = epoch;
      if (sessionEpoch !== epoch) {
        freezeDraft(true);
        if (typeof window !== "undefined") window.dispatchEvent(new Event("send-to-myself:session-stale"));
      }
      if (frozen || generation !== localGeneration || sessionEpoch !== epoch) {
        failure = new Error("草稿写入已暂停"); tx.abort(); return;
      }
      try { operation(store, value => { result = value; }, error => { failure = error; }); }
      catch (error) { failure = error instanceof Error ? error : new Error("草稿写入失败"); tx.abort(); }
    };
    tx.oncomplete = () => failure ? reject(failure) : resolve(result);
    tx.onerror = () => reject(failure ?? tx.error);
    tx.onabort = () => reject(failure ?? tx.error ?? new Error("草稿存储失败"));
  }));
}
export async function resumeDraftSession(): Promise<void> {
  sessionEpoch = undefined;
  const db = await database();
  await new Promise<void>((resolve, reject) => {
    const request = db.transaction(STORE).objectStore(STORE).get(EPOCH);
    request.onsuccess = () => { sessionEpoch = typeof request.result === "number" ? request.result : 0; resolve(); };
    request.onerror = () => reject(request.error);
  });
}
/** Advance the epoch and clear drafts in one transaction so old windows cannot write back. */
export async function retireDraftSession(): Promise<void> {
  const db = await database();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite"); const store = tx.objectStore(STORE);
    const request = store.get(EPOCH);
    request.onsuccess = () => { const next = (typeof request.result === "number" ? request.result : 0) + 1; store.put(next, EPOCH); store.delete(KEY); store.delete(IDBKeyRange.bound("edit:", "edit:\uffff")); store.delete(IDBKeyRange.bound("attempt:", "attempt:\uffff")); };
    tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error ?? new Error("草稿清理失败"));
  });
}

export function clearDraftIfKey(key: string, expectedGeneration?: number): Promise<void> {
  return enqueue(() => transaction<boolean>((store, done) => {
    const request = store.get(KEY);
    request.onsuccess = () => { const permitted = expectedGeneration === undefined || (!frozen && generation === expectedGeneration); if (permitted) { if ((request.result as StoredDraft | undefined)?.dedupeKey === key) store.delete(KEY); store.delete(attemptKey(key)); } done(permitted); };
  })).then(permitted => { if (permitted) clearAttemptPointer(key); });
}
export function clearNativeHandoffIfKey(key: string, expectedGeneration: number): Promise<void> {
  return enqueue(() => transaction<void>((store, done) => {
    const attempt = store.get(attemptKey(key));
    attempt.onsuccess = () => {
      const saved = attempt.result as StoredDraft | undefined;
      if (!frozen && generation === expectedGeneration && saved?.nativeHandoffPending) {
        delete saved.nativeHandoffPending;
        store.put(saved, attemptKey(key));
      }
    };
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
/** Attach the attempt context only if this window's saved edit is still current. */
export function prepareEditDraft(id: string, expected: EditSnapshot | undefined, content: string, detectionContext: DetectionContext): Promise<EditSnapshot | undefined> {
  if (frozen) return Promise.reject(new Error("草稿写入已暂停"));
  return enqueue(() => transaction<EditSnapshot | undefined>((store, done, fail) => {
    const key = `edit:${id}`;
    const request = store.get(key);
    request.onsuccess = () => {
      const current = request.result as EditDraft | undefined;
      if (expected ? !sameEditSnapshot(current, expected) : !!current) { done(undefined); return; }
      if (expected?.detectionContext) { done(expected); return; }
      const write = () => {
        const prepared = { content, savedAt: Date.now(), detectionContext };
        store.put({ itemId: id, ...prepared }, key); done(prepared);
      };
      if (current) { write(); return; }
      const count = store.count(IDBKeyRange.bound("edit:", "edit:\uffff"));
      count.onsuccess = () => { if (count.result >= 20) fail(new Error("draft_full")); else write(); };
    };
  }));
}
function sameEditSnapshot(value: EditSnapshot | undefined, expected: EditSnapshot): boolean {
  return value?.content === expected.content && value.savedAt === expected.savedAt && JSON.stringify(value.detectionContext) === JSON.stringify(expected.detectionContext);
}
export function clearEditDraft(id: string, expected?: EditSnapshot): Promise<void> {
  return enqueue(() => transaction<void>((store, done) => {
    const key = `edit:${id}`;
    if (!expected) { store.delete(key); done(); return; }
    const request = store.get(key);
    request.onsuccess = () => {
      const value = request.result as EditDraft | undefined;
      if (sameEditSnapshot(value, expected)) store.delete(key);
      done();
    };
  }));
}
export function clearAllEditDrafts(): Promise<void> {
  return enqueue(() => transaction<void>((store, done) => { store.delete(IDBKeyRange.bound("edit:", "edit:\uffff")); done(); }));
}
