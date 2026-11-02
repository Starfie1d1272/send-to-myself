import { preferences } from '@kit.ArkData';
import { common } from '@kit.AbilityKit';
import { postTextItem, isAuthError, isNetworkError } from './HttpClient';
import { readConnection, requireConnection, normalizeOrigin, beginAuthorizedDispatch } from './ConnectionSession';
import { SharedFileData, legacyFile, cleanSharedFiles } from './ShareFiles';
import { PREFS_NAME_QUEUE, PREFS_KEY_QUEUE } from './Constants';
import { withTransferLock, TransferBusyError } from './TransferLock';
import { createUpload, taskInfo, removeTask, progressText, request } from './TransferAgent';

export interface QueueItemData {
  dedupeKey: string;
  kind: 'text' | 'upload';
  content?: string;
  files?: SharedFileData[];
  fileSandboxPaths?: string[];
  serverUrl?: string;
  lastError?: string;
  agentId?: string;
  agentSessionRevision?: string;
  cancelRequested?: boolean;
  createdAt: number;
}
export interface QueueRow {
  key: string;
  content: string;
  files: string;
  serverUrl: string;
  createdAt: number;
  status: string;
  active: boolean;
  paused: boolean;
}
export interface QueueStatus { count: number; error: string }
let processing: Promise<void> | undefined = undefined;

async function loadQueue(context: common.Context): Promise<QueueItemData[]> {
  await preferences.removePreferencesFromCache(context, PREFS_NAME_QUEUE);
  const prefs = await preferences.getPreferences(context, PREFS_NAME_QUEUE);
  return JSON.parse(await prefs.get(PREFS_KEY_QUEUE, '[]') as string) as QueueItemData[];
}
async function saveQueue(context: common.Context, items: QueueItemData[]): Promise<void> {
  const prefs = await preferences.getPreferences(context, PREFS_NAME_QUEUE);
  await prefs.put(PREFS_KEY_QUEUE, JSON.stringify(items));
  await prefs.flush();
}
async function readQueue(context: common.Context): Promise<QueueItemData[]> {
  return withTransferLock(context, 'queue', () => loadQueue(context));
}
async function updateItem(context: common.Context, item: QueueItemData): Promise<void> {
  await withTransferLock(context, 'queue', async () => {
    const items = await loadQueue(context);
    const index = items.findIndex((entry: QueueItemData) => entry.dedupeKey === item.dedupeKey);
    if (index < 0) throw new Error('待发送内容已移除');
    items[index] = item;
    await saveQueue(context, items);
  });
}
function filesOf(item: QueueItemData): SharedFileData[] {
  return item.files ?? (item.fileSandboxPaths ?? []).map(legacyFile);
}
async function finishItem(context: common.Context, item: QueueItemData): Promise<void> {
  await withTransferLock(context, 'queue', async () => {
    const items = await loadQueue(context);
    await saveQueue(context, items.filter((entry: QueueItemData) => entry.dedupeKey !== item.dedupeKey));
  });
  cleanSharedFiles(filesOf(item));
  if (item.agentId) { try { await removeTask(item.agentId); } catch (_error) {} }
}
export async function enqueue(context: common.Context, key: string, kind: 'text' | 'upload',
  content?: string, files?: SharedFileData[], targetOrigin?: string): Promise<void> {
  const current = await readConnection(context);
  if (!current || (targetOrigin && current.origin !== targetOrigin)) throw new Error('连接已改变，内容未加入队列');
  const server = current.origin;
  await withTransferLock(context, 'queue', async () => {
    const items = await loadQueue(context);
    if (!items.some((item: QueueItemData) => item.dedupeKey === key)) {
      items.push({ dedupeKey: key, kind: kind, content: content, files: files,
        serverUrl: server, createdAt: Date.now() });
      await saveQueue(context, items);
    }
  });
}
export async function isQueued(context: common.Context, key: string): Promise<boolean> {
  return (await readQueue(context)).some((item: QueueItemData) => item.dedupeKey === key);
}
export async function queueStatus(context: common.Context): Promise<QueueStatus> {
  const items = await readQueue(context);
  return { count: items.length, error: items.find((item: QueueItemData) => !!item.lastError)?.lastError ?? '' };
}

// The item lock spans dispatch, acknowledgment and cancellation, including across processes.
async function processItem(context: common.Context, key: string, retry: boolean): Promise<void> {
  await withTransferLock(context, 'item-' + key, async () => {
    const item = (await readQueue(context)).find((entry: QueueItemData) => entry.dedupeKey === key);
    if (!item) return;
    if (item.cancelRequested) {
      if (item.agentId) await removeTask(item.agentId);
      await finishItem(context, item);
      return;
    }
    try {
      if (item.agentId) {
        const info = await taskInfo(item.agentId);
        if (info?.progress.state === request.agent.State.COMPLETED) {
          // Agent completion persists across process death; /upload returns 201 after commit.
          await finishItem(context, item);
          return;
        }
        const state = info?.progress.state;
        const running = state === request.agent.State.RUNNING || state === request.agent.State.WAITING ||
          state === request.agent.State.RETRYING;
        if (running) {
          const current = await readConnection(context);
          if (!current?.deviceToken) await (await request.agent.getTask(context, item.agentId)).pause();
          return;
        }
        if (!retry && state !== request.agent.State.INITIALIZED) {
          const error = info ? progressText(info) : '系统任务已不存在，请重试；内容仍保留';
          if (item.lastError !== error) { item.lastError = error; await updateItem(context, item); }
          return;
        }
        const connection = await requireConnection(context);
        if (!item.serverUrl || normalizeOrigin(item.serverUrl) !== connection.origin) throw new Error('待发送内容属于另一服务器，请切回原服务器');
        if (item.agentSessionRevision !== connection.revision) {
          await removeTask(item.agentId);
          item.agentId = undefined;
          item.agentSessionRevision = undefined;
          await updateItem(context, item);
        } else if (state === request.agent.State.INITIALIZED) {
          const task = await request.agent.getTask(context, item.agentId);
          await beginAuthorizedDispatch(context, connection, () => task.start());
          return;
        } else if (state === request.agent.State.PAUSED) {
          const task = await request.agent.getTask(context, item.agentId!);
          await beginAuthorizedDispatch(context, connection, () => task.resume());
          item.lastError = '';
          await updateItem(context, item);
          return;
        } else {
        // Failed upload tasks cannot be restarted. Recreate with the same dedupe key.
        await removeTask(item.agentId);
        item.agentId = undefined;
        await updateItem(context, item);
        }
      }
      const connection = await requireConnection(context);
      if (!item.serverUrl || normalizeOrigin(item.serverUrl) !== connection.origin) {
        throw new Error('待发送内容目标无法确认或属于另一服务器，请切回原服务器');
      }
      if (item.kind === 'text') {
        await postTextItem(context, connection, item.content ?? '', item.dedupeKey);
        await finishItem(context, item);
      } else {
        const files = filesOf(item);
        if (files.length === 0) throw new Error('没有可发送的附件');
        const task = await createUpload(context, connection, item.dedupeKey, item.content ?? '', files);
        item.agentId = task.tid;
        item.agentSessionRevision = connection.revision;
        item.lastError = '';
        try { await updateItem(context, item); }
        catch (error) { await removeTask(task.tid); throw error as Error; }
        // Persist the ID before starting; an interrupted start is resumed on next launch.
        await beginAuthorizedDispatch(context, connection, () => task.start());
      }
    } catch (error) {
      item.lastError = (error as Error).message;
      await updateItem(context, item);
      if (isAuthError(error as Error) || isNetworkError(error as Error)) throw error as Error;
    }
  }, false);
}
async function drain(context: common.Context): Promise<void> {
  const snapshot = await readQueue(context);
  for (let i = 0; i < snapshot.length; i++) {
    try { await processItem(context, snapshot[i].dedupeKey, false); }
    catch (error) {
      if (error instanceof TransferBusyError) continue;
      if (isAuthError(error as Error) || isNetworkError(error as Error)) break;
      throw error as Error;
    }
  }
}
export async function processQueue(context: common.Context): Promise<void> {
  if (!processing) processing = drain(context).finally(() => { processing = undefined; });
  await processing;
}
export async function reconcileQueue(context: common.Context): Promise<void> {
  const items = await readQueue(context);
  for (let i = 0; i < items.length; i++) {
    if (!items[i].agentId && !items[i].cancelRequested) continue;
    try { await processItem(context, items[i].dedupeKey, false); }
    catch (error) { if (!(error instanceof TransferBusyError)) throw error as Error; }
  }
}
export async function retryQueueItem(context: common.Context, key: string): Promise<void> {
  await processItem(context, key, true);
}
export async function removeQueueItem(context: common.Context, key: string): Promise<void> {
  await withTransferLock(context, 'item-' + key, async () => {
    const item = (await readQueue(context)).find((entry: QueueItemData) => entry.dedupeKey === key);
    if (!item) return;
    item.cancelRequested = true;
    await updateItem(context, item);
    // Stop the OS task before freeing any file it might still be reading.
    if (item.agentId) await removeTask(item.agentId);
    await finishItem(context, item);
  }, false);
}
export async function pauseQueueItem(context: common.Context, key: string): Promise<void> {
  await withTransferLock(context, 'item-' + key, async () => {
    const item = (await readQueue(context)).find((entry: QueueItemData) => entry.dedupeKey === key);
    if (!item?.agentId || item.cancelRequested) return;
    await (await request.agent.getTask(context, item.agentId)).pause();
  }, false);
}
export async function listQueue(context: common.Context): Promise<QueueRow[]> {
  const items = await readQueue(context);
  const rows: QueueRow[] = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    let status = item.lastError || '等待发送';
    let active = false;
    let paused = false;
    if (item.agentId) {
      try {
        const info = await taskInfo(item.agentId);
        if (info) {
          status = progressText(info);
          const state = info.progress.state;
          active = state === request.agent.State.RUNNING || state === request.agent.State.WAITING ||
            state === request.agent.State.RETRYING || state === request.agent.State.INITIALIZED;
          paused = state === request.agent.State.PAUSED;
        }
      } catch (_error) { status = '暂时无法读取传输状态'; }
    }
    if (item.cancelRequested) { status = '正在取消，内容将从本机移除'; active = false; }
    rows.push({ key: item.dedupeKey, content: item.content ?? '',
      files: filesOf(item).map((file: SharedFileData) => file.filename).join('\n'),
      serverUrl: item.serverUrl ?? '', createdAt: item.createdAt, status: status, active: active, paused: paused });
  }
  return rows;
}

// Stop every registered server's active task without deleting its record or files.
export async function pauseAllQueueTasks(context: common.Context): Promise<boolean> {
  let complete = true;
  const items = await readQueue(context);
  for (let i = 0; i < items.length; i++) {
    if (!items[i].agentId) continue;
    try {
      await withTransferLock(context, 'item-' + items[i].dedupeKey, async () => {
        const item = (await readQueue(context)).find((entry: QueueItemData) => entry.dedupeKey === items[i].dedupeKey);
        if (!item?.agentId) return;
        let info = await taskInfo(item.agentId);
        if (!info) { complete = false; return; }
        if ([request.agent.State.RUNNING, request.agent.State.WAITING, request.agent.State.RETRYING].includes(info.progress.state)) {
          await (await request.agent.getTask(context, item.agentId)).pause();
          info = await taskInfo(item.agentId);
          if (!info || [request.agent.State.RUNNING, request.agent.State.WAITING, request.agent.State.RETRYING].includes(info.progress.state)) complete = false;
        }
      }, false);
    } catch (_error) { complete = false; }
  }
  return complete;
}
