import { preferences } from '@kit.ArkData';
import { common } from '@kit.AbilityKit';
import { postTextItem, postUploadItem, isNetworkError } from './HttpClient';
import { hilog } from '@kit.PerformanceAnalysisKit';
import { DOMAIN, TAG, PREFS_NAME_QUEUE, PREFS_KEY_QUEUE } from './Constants';

interface QueueItemData {
  dedupeKey: string;
  kind: 'text' | 'upload';
  content?: string;
  fileSandboxPaths?: string[];
  createdAt: number;
}

class QueueItem implements QueueItemData {
  dedupeKey: string = '';
  kind: 'text' | 'upload' = 'text';
  content?: string = undefined;
  fileSandboxPaths?: string[] = undefined;
  createdAt: number = 0;

  constructor(dedupeKey: string, kind: 'text' | 'upload', content?: string, fileSandboxPaths?: string[], createdAt?: number) {
    this.dedupeKey = dedupeKey;
    this.kind = kind;
    this.content = content;
    this.fileSandboxPaths = fileSandboxPaths;
    this.createdAt = createdAt ?? Date.now();
  }
}

let queuePrefs: preferences.Preferences | undefined = undefined;

async function getQueuePrefs(context: common.Context): Promise<preferences.Preferences> {
  if (!queuePrefs) {
    queuePrefs = await preferences.getPreferences(context, PREFS_NAME_QUEUE);
  }
  return queuePrefs;
}

async function loadQueue(context: common.Context): Promise<QueueItemData[]> {
  let prefs = await getQueuePrefs(context);
  let raw = await prefs.get(PREFS_KEY_QUEUE, '[]');
  let items: QueueItemData[] = JSON.parse(raw as string) as QueueItemData[];
  return items;
}

async function saveQueue(context: common.Context, items: QueueItemData[]): Promise<void> {
  let prefs = await getQueuePrefs(context);
  await prefs.put(PREFS_KEY_QUEUE, JSON.stringify(items));
  await prefs.flush();
}

export async function enqueue(context: common.Context, dedupeKey: string, kind: 'text' | 'upload',
  content?: string, fileSandboxPaths?: string[]): Promise<void> {
  let items = await loadQueue(context);
  let item = new QueueItem(dedupeKey, kind, content, fileSandboxPaths);
  items.push(item);
  await saveQueue(context, items);
  hilog.info(DOMAIN, TAG, 'Enqueued item, dedupeKey=%{public}s, queueLen=%{public}s',
    item.dedupeKey, items.length.toString());
}

export async function processQueue(context: common.Context): Promise<void> {
  let items = await loadQueue(context);
  if (items.length === 0) {
    return;
  }
  hilog.info(DOMAIN, TAG, 'Processing queue, len=%{public}s', items.length.toString());
  let remaining: QueueItemData[] = [];
  for (let i = 0; i < items.length; i++) {
    let item = items[i];
    try {
      let success: boolean;
      if (item.kind === 'text') {
        success = await postTextItem(item.content ?? '', item.dedupeKey);
      } else {
        success = await postUploadItem(item.content, item.fileSandboxPaths ?? [], item.dedupeKey);
      }
      if (success) {
        hilog.info(DOMAIN, TAG, 'Queue item sent, dedupeKey=%{public}s', item.dedupeKey);
      } else {
        remaining.push(item);
      }
    } catch (err) {
      if (isNetworkError(err as Error)) {
        remaining.push(item);
      } else {
        hilog.error(DOMAIN, TAG, 'Queue item permanent failure, dedupeKey=%{public}s', item.dedupeKey);
      }
    }
  }
  if (remaining.length !== items.length) {
    await saveQueue(context, remaining);
    hilog.info(DOMAIN, TAG, 'Queue processed, remaining=%{public}s', remaining.length.toString());
  }
}
