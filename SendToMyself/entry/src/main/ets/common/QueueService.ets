import { preferences } from '@kit.ArkData';
import { fileIo } from '@kit.CoreFileKit';
import { common } from '@kit.AbilityKit';
import { postTextItem, postUploadItem, isAuthError, isNetworkError } from './HttpClient';
import { loadServerUrl } from './AssetStore';
import { SharedFileData, legacyFile, cleanSharedFiles } from './ShareFiles';
import { hilog } from '@kit.PerformanceAnalysisKit';
import { DOMAIN, TAG, PREFS_NAME_QUEUE, PREFS_KEY_QUEUE } from './Constants';

interface QueueItemData {
  dedupeKey: string;
  kind: 'text' | 'upload';
  content?: string;
  files?: SharedFileData[];
  fileSandboxPaths?: string[]; // Read older queues without deleting them.
  serverUrl?: string;
  lastError?: string;
  createdAt: number;
}
class QueueItem implements QueueItemData {
  dedupeKey: string;
  kind: 'text' | 'upload';
  content?: string;
  files?: SharedFileData[];
  serverUrl?: string;
  lastError?: string;
  createdAt: number;
  constructor(key: string, kind: 'text' | 'upload', content?: string, files?: SharedFileData[], serverUrl?: string) {
    this.dedupeKey = key;
    this.kind = kind;
    this.content = content;
    this.files = files;
    this.serverUrl = serverUrl;
    this.createdAt = Date.now();
  }
}
export interface QueueStatus { count: number; error: string }
class Status implements QueueStatus {
  count: number;
  error: string;
  constructor(count: number, error: string) { this.count = count; this.error = error; }
}
// Serialize storage mutations, but never hold the lock while awaiting HTTP.
let mutations: Promise<void> = Promise.resolve();
let processing: Promise<void> | undefined = undefined;
function mutate(context: common.Context, action: () => Promise<void>): Promise<void> {
  let next = mutations.catch(() => {}).then(async () => {
    // OS locks are shared by the UIAbility and ShareExtensionAbility processes,
    // and automatically released if either process terminates.
    let lock = fileIo.openSync(context.filesDir + '/queue.lock', fileIo.OpenMode.READ_WRITE | fileIo.OpenMode.CREATE);
    let acquired = false;
    try {
      for (let attempt = 0; attempt < 80; attempt++) {
        try { lock.tryLock(true); acquired = true; break; }
        catch (_error) { await new Promise<void>((resolve) => { setTimeout(resolve, 25); }); }
      }
      if (!acquired) throw new Error('本地队列暂时忙，请重试');
      await action();
    } finally {
      try { if (acquired) lock.unlock(); }
      finally { fileIo.closeSync(lock); }
    }
  });
  mutations = next;
  return next;
}
async function loadQueue(context: common.Context): Promise<QueueItemData[]> {
  await preferences.removePreferencesFromCache(context, PREFS_NAME_QUEUE);
  let prefs = await preferences.getPreferences(context, PREFS_NAME_QUEUE);
  let raw = await prefs.get(PREFS_KEY_QUEUE, '[]');
  return JSON.parse(raw as string) as QueueItemData[];
}
async function saveQueue(context: common.Context, items: QueueItemData[]): Promise<void> {
  let prefs = await preferences.getPreferences(context, PREFS_NAME_QUEUE);
  await prefs.put(PREFS_KEY_QUEUE, JSON.stringify(items));
  await prefs.flush();
}
export async function enqueue(context: common.Context, key: string, kind: 'text' | 'upload', content?: string, files?: SharedFileData[]): Promise<void> {
  let server = await loadServerUrl();
  await mutate(context, async () => {
    let items = await loadQueue(context);
    if (!items.some((item: QueueItemData) => item.dedupeKey === key)) {
      items.push(new QueueItem(key, kind, content, files, server));
      await saveQueue(context, items);
    }
  });
}
async function readQueue(context: common.Context): Promise<QueueItemData[]> {
  let items: QueueItemData[] = [];
  await mutate(context, async () => { items = await loadQueue(context); });
  return items;
}
export async function isQueued(context: common.Context, key: string): Promise<boolean> {
  return (await readQueue(context)).some((item: QueueItemData) => item.dedupeKey === key);
}
export async function queueStatus(context: common.Context): Promise<QueueStatus> {
  let items = await readQueue(context);
  let error = items.find((item: QueueItemData) => !!item.lastError)?.lastError ?? '';
  return new Status(items.length, error);
}
async function drain(context: common.Context): Promise<void> {
  let snapshot = await readQueue(context);
  for (let i = 0; i < snapshot.length; i++) {
    let item = snapshot[i];
    let files = item.files ?? (item.fileSandboxPaths ?? []).map(legacyFile);
    let errorMessage = '';
    let stop = false;
    try {
      let server = await loadServerUrl();
      if (item.serverUrl && item.serverUrl !== server) {
        errorMessage = '待发送内容属于另一服务器，请切回原服务器';
      } else {
        let success = item.kind === 'text' ? await postTextItem(item.content ?? '', item.dedupeKey)
          : await postUploadItem(item.content, files, item.dedupeKey);
        if (success) {
          // Remove ONLY acknowledged IDs from the latest queue. Preserve new arrivals.
          await mutate(context, async () => {
            let current = await loadQueue(context);
            await saveQueue(context, current.filter((entry: QueueItemData) => entry.dedupeKey !== item.dedupeKey));
          });
          cleanSharedFiles(files);
          continue;
        }
        errorMessage = '发送失败，内容已保留';
      }
    } catch (error) {
      errorMessage = (error as Error).message;
      stop = isAuthError(error as Error) || isNetworkError(error as Error);
    }
    await mutate(context, async () => {
      let current = await loadQueue(context);
      for (let j = 0; j < current.length; j++) {
        if (current[j].dedupeKey === item.dedupeKey) current[j].lastError = errorMessage;
      }
      await saveQueue(context, current);
    });
    hilog.warn(DOMAIN, TAG, 'Queued send retained: %{public}s', errorMessage);
    if (stop) break;
  }
}
export async function processQueue(context: common.Context): Promise<void> {
  if (!processing) {
    processing = drain(context).finally(() => { processing = undefined; });
  }
  await processing;
}
