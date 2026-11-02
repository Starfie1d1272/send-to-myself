import { common } from '@kit.AbilityKit';
import { preferences, uniformTypeDescriptor } from '@kit.ArkData';
import { fileIo, fileUri, picker } from '@kit.CoreFileKit';
import { util } from '@kit.ArkTS';
import { systemShare } from '@kit.ShareKit';
import { AuthenticatedConnection, ConnectionSession, readConnection, requireConnection, beginAuthorizedDispatch, normalizeOrigin, assertCurrentConnection, authenticatedSnapshot } from './ConnectionSession';
import { withTransferLock, TransferBusyError } from './TransferLock';
import { getJson } from './HttpClient';
import { request, taskInfo, transferHeaders, removeTask, progressText } from './TransferAgent';

const STORE = 'attachment_transfers';
export interface DownloadRecord {
  id: string;
  attachmentId: string;
  filename: string;
  mimeType: string;
  expectedSize: number;
  serverUrl: string;
  path: string;
  createdAt: number;
  taskId?: string;
  taskSessionRevision?: string;
  ready: boolean;
  error: string;
  cancelRequested?: boolean;
}
export interface DownloadRow {
  id: string;
  filename: string;
  status: string;
  ready: boolean;
  active: boolean;
  statusKnown: boolean;
}
const presenting: Set<string> = new Set<string>();
const controllers: Map<string, systemShare.ShareController> = new Map<string, systemShare.ShareController>();

export function safeFilename(name: string): string {
  const cleaned = name.replace(/[\\/\u0000-\u001f\u007f]/g, '_').trim();
  if (!cleaned || cleaned === '.' || cleaned === '..') return 'attachment';
  if (cleaned.length <= 80) return cleaned;
  const dot = cleaned.lastIndexOf('.');
  const suffix = dot >= 0 && cleaned.length - dot <= 16 ? cleaned.substring(dot) : '';
  return cleaned.substring(0, 80 - suffix.length).replace(/[\uD800-\uDBFF]$/, '') + suffix;
}
export function validAttachmentId(id: string): boolean { return /^[a-zA-Z0-9_-]{1,128}$/.test(id); }
async function read(context: common.Context): Promise<DownloadRecord[]> {
  await preferences.removePreferencesFromCache(context, STORE);
  const prefs = await preferences.getPreferences(context, STORE);
  return JSON.parse(await prefs.get('items', '[]') as string) as DownloadRecord[];
}
async function write(context: common.Context, items: DownloadRecord[]): Promise<void> {
  const prefs = await preferences.getPreferences(context, STORE);
  await prefs.put('items', JSON.stringify(items));
  await prefs.flush();
}
async function all(context: common.Context): Promise<DownloadRecord[]> {
  return withTransferLock(context, 'downloads', () => read(context));
}
async function update(context: common.Context, record: DownloadRecord): Promise<void> {
  await withTransferLock(context, 'downloads', async () => {
    const items = await read(context);
    const index = items.findIndex((item: DownloadRecord) => item.id === record.id);
    if (index < 0) throw new Error('下载记录已移除');
    items[index] = record;
    await write(context, items);
  });
}
async function start(context: common.Context, item: DownloadRecord, snapshot?: AuthenticatedConnection): Promise<void> {
  const connection = snapshot ?? await requireConnection(context);
  if (normalizeOrigin(item.serverUrl) !== connection.origin) throw new Error('请切回下载时使用的服务器');
  const task = await request.agent.create(context, {
    action: request.agent.Action.DOWNLOAD, mode: request.agent.Mode.BACKGROUND,
    url: item.serverUrl.replace(/\/$/, '') + '/api/attachments/' + item.attachmentId + '/raw',
    method: 'GET', headers: transferHeaders(connection), saveas: item.path, overwrite: true,
    retry: true, redirect: false, gauge: true, network: request.agent.Network.ANY,
    metered: true, roaming: false, title: '发给自己 · 下载附件',
    description: item.filename, extras: { downloadId: item.id }
  });
  item.taskId = task.tid;
  item.taskSessionRevision = connection.revision;
  item.error = '';
  item.ready = false;
  try { await update(context, item); }
  catch (error) { await removeTask(task.tid); throw error as Error; }
  await beginAuthorizedDispatch(context, connection, () => task.start());
}

export async function prepareDownload(context: common.Context, attachmentId: string, filename: string,
  mimeType: string, size: number, connection: AuthenticatedConnection): Promise<string> {
  if (!validAttachmentId(attachmentId) || !Number.isSafeInteger(size) || size < 0) throw new Error('附件信息无效');
  const server = connection.origin;
  // A lock covers duplicate taps through creation and persistence of the system task.
  return withTransferLock(context, 'prepare-download', async () => {
    const existing = (await all(context)).find((item: DownloadRecord) =>
      item.attachmentId === attachmentId && item.serverUrl === server && !item.cancelRequested);
    if (existing) return existing.id;
    const id = util.generateRandomUUID();
    const directory = context.filesDir + '/received-transfers/' + id;
    fileIo.mkdirSync(directory, true);
    const item: DownloadRecord = {
      id: id, attachmentId: attachmentId, filename: safeFilename(filename),
      mimeType: /^[a-zA-Z0-9.+_-]+\/[a-zA-Z0-9.+_-]+$/.test(mimeType) ? mimeType : 'application/octet-stream',
      expectedSize: size, serverUrl: server, path: directory + '/' + safeFilename(filename),
      createdAt: Date.now(), ready: false, error: ''
    };
    await withTransferLock(context, 'downloads', async () => {
      const items = await read(context);
      items.push(item);
      await write(context, items);
    });
    await withTransferLock(context, 'download-' + id, async () => {
      try { await start(context, item, connection); }
      catch (error) { item.error = (error as Error).message; await update(context, item); }
    });
    return id;
  });
}
interface AttachmentMetadata { id: string; filename: string; mimeType: string; size: number }
export async function requestAttachmentAction(context: common.UIAbilityContext, attachmentId: string, action: string, source: ConnectionSession): Promise<string> {
  if (!validAttachmentId(attachmentId) || (action !== 'save' && action !== 'share')) throw new Error('附件信息无效');
  await assertCurrentConnection(context, source);
  const existing = (await all(context)).find((item: DownloadRecord) => item.attachmentId === attachmentId && item.serverUrl === source.origin && !item.cancelRequested);
  await assertCurrentConnection(context, source);
  if (existing) return existing.id;
  const connection = authenticatedSnapshot(source);
  const response = await getJson(context, connection, '/api/attachments/' + attachmentId);
  if (response.responseCode !== 200) throw new Error(response.responseCode === 404 ? '附件不可用或核心版本过旧，请检查或升级核心' : '无法读取附件信息（HTTP ' + response.responseCode.toString() + '）');
  const metadata = JSON.parse(response.result as string) as AttachmentMetadata;
  if (metadata.id !== attachmentId || typeof metadata.filename !== 'string' || typeof metadata.mimeType !== 'string') throw new Error('附件信息无效，请升级配套核心');
  await assertCurrentConnection(context, source);
  const id = await prepareDownload(context, attachmentId, metadata.filename, metadata.mimeType, metadata.size, connection);
  await assertCurrentConnection(context, source);
  return id;
}
async function cleanup(context: common.Context, item: DownloadRecord): Promise<void> {
  if (item.taskId) await removeTask(item.taskId);
  await withTransferLock(context, 'downloads', async () => {
    await write(context, (await read(context)).filter((entry: DownloadRecord) => entry.id !== item.id));
  });
  try { fileIo.unlinkSync(item.path); } catch (_error) {}
  try { fileIo.rmdirSync(item.path.substring(0, item.path.lastIndexOf('/'))); } catch (_error) {}
}
export async function refreshDownloads(context: common.Context): Promise<void> {
  const items = await all(context);
  for (let i = 0; i < items.length; i++) {
    try {
      await withTransferLock(context, 'download-' + items[i].id, async () => {
        const item = (await all(context)).find((entry: DownloadRecord) => entry.id === items[i].id);
        if (!item) return;
        if (item.cancelRequested) { await cleanup(context, item); return; }
        if (item.ready) {
          if (item.taskId) {
            await removeTask(item.taskId);
            item.taskId = undefined;
            await update(context, item);
          }
          return;
        }
        if (!item.taskId) return;
        const info = await taskInfo(item.taskId);
        let error = '';
        if (!info) error = '系统任务已不存在，请重试';
        else if (info.progress.state === request.agent.State.COMPLETED) {
          if (!fileIo.accessSync(item.path)) error = '本机副本不可用，请重新下载';
          else if (fileIo.statSync(item.path).size !== item.expectedSize) error = '附件大小不一致，请重新下载';
          else {
            item.ready = true; item.error = ''; await update(context, item);
            await removeTask(item.taskId);
            item.taskId = undefined; await update(context, item);
            return;
          }
        } else if ([request.agent.State.RUNNING, request.agent.State.WAITING, request.agent.State.RETRYING].includes(info.progress.state) && !(await readConnection(context))?.deviceToken) {
          await (await request.agent.getTask(context, item.taskId)).pause();
        } else if (info.progress.state === request.agent.State.INITIALIZED) {
          const connection = await requireConnection(context);
          if (normalizeOrigin(item.serverUrl) !== connection.origin) throw new Error('请切回下载时使用的服务器');
          if (item.taskSessionRevision !== connection.revision) {
            await removeTask(item.taskId); item.taskId = undefined; await update(context, item);
            await start(context, item, connection);
          } else {
            const task = await request.agent.getTask(context, item.taskId);
            await beginAuthorizedDispatch(context, connection, () => task.start());
          }
        } else if (info.progress.state === request.agent.State.FAILED || info.progress.state === request.agent.State.REMOVED) {
          error = '下载失败，请检查登录和网络后重试';
        }
        if (item.error !== error) { item.error = error; await update(context, item); }
      }, false);
    } catch (error) { if (!(error instanceof TransferBusyError)) throw error as Error; }
  }
}
export async function listDownloads(context: common.Context, includeSystem: boolean = true): Promise<DownloadRow[]> {
  const items = await all(context);
  const rows: DownloadRow[] = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    let status = item.ready ? '已下载到本机，可分享或保存' : item.error || (item.taskId ? '系统任务状态尚未确认' : '等待下载');
    let statusKnown = item.ready || !item.taskId || !!item.error;
    let active = false;
    if (item.taskId && !item.ready && !item.error && includeSystem) {
      try {
        const info = await taskInfo(item.taskId);
        statusKnown = true;
        if (info) {
          status = progressText(info);
          active = [request.agent.State.RUNNING, request.agent.State.WAITING,
            request.agent.State.RETRYING, request.agent.State.INITIALIZED].includes(info.progress.state);
        }
      } catch (_error) { statusKnown = true; status = '暂时无法读取下载状态'; }
    }
    rows.push({ id: item.id, filename: item.filename, status: status, ready: item.ready, active: active, statusKnown: statusKnown });
  }
  return rows;
}
export async function retryDownload(context: common.Context, id: string): Promise<void> {
  await withTransferLock(context, 'download-' + id, async () => {
    const item = (await all(context)).find((entry: DownloadRecord) => entry.id === id);
    if (!item || item.ready || item.cancelRequested) return;
    const connection = await requireConnection(context);
    if (normalizeOrigin(item.serverUrl) !== connection.origin) throw new Error('请切回下载时使用的服务器');
    if (item.taskId) {
      const info = await taskInfo(item.taskId);
      const state = info?.progress.state;
      if (state === request.agent.State.RUNNING || state === request.agent.State.WAITING || state === request.agent.State.RETRYING || (state === request.agent.State.COMPLETED && !item.error)) return;
      if (item.taskSessionRevision === connection.revision &&
        (state === request.agent.State.PAUSED || state === request.agent.State.INITIALIZED)) {
        const task = await request.agent.getTask(context, item.taskId);
        if (state === request.agent.State.PAUSED) await beginAuthorizedDispatch(context, connection, () => task.resume());
        else await beginAuthorizedDispatch(context, connection, () => task.start());
        item.error = ''; await update(context, item); return;
      }
      await removeTask(item.taskId);
    }
    item.taskId = undefined; item.taskSessionRevision = undefined;
    await update(context, item);
    try { await start(context, item, connection); }
    catch (error) { item.error = (error as Error).message; await update(context, item); throw error as Error; }
  }, false);
}
export async function removeDownload(context: common.Context, id: string): Promise<void> {
  if (presenting.has(id)) throw new Error('请先关闭分享或保存面板');
  await withTransferLock(context, 'download-' + id, async () => {
    if (presenting.has(id)) throw new Error('请先关闭分享或保存面板');
    const item = (await all(context)).find((entry: DownloadRecord) => entry.id === id);
    if (!item) return;
    item.cancelRequested = true;
    await update(context, item);
    await cleanup(context, item);
  }, false);
}
async function readyFile(context: common.Context, id: string): Promise<DownloadRecord> {
  const item = (await all(context)).find((entry: DownloadRecord) => entry.id === id);
  if (!item?.ready || item.cancelRequested) throw new Error('附件尚未下载完成');
  if (!fileIo.accessSync(item.path) || fileIo.statSync(item.path).size !== item.expectedSize) {
    item.ready = false;
    item.error = '本机副本不可用，请重新下载';
    await update(context, item);
    throw new Error(item.error);
  }
  return item;
}
export async function shareDownload(context: common.UIAbilityContext, id: string, expected?: ConnectionSession): Promise<void> {
  if (presenting.has(id)) return;
  presenting.add(id);
  try {
    await withTransferLock(context, 'download-' + id, async () => {
      const item = await readyFile(context, id);
      if (expected) await assertCurrentConnection(context, expected);
      let utd: string = uniformTypeDescriptor.UniformDataType.FILE;
      try { utd = uniformTypeDescriptor.getUniformDataTypeByMIMEType(item.mimeType); } catch (_error) {}
      const data = new systemShare.SharedData({ utd: utd, uri: fileUri.getUriFromPath(item.path), title: item.filename });
      const controller = new systemShare.ShareController(data);
      controllers.set(id, controller);
      controller.on('dismiss', () => { presenting.delete(id); controllers.delete(id); });
      await controller.show(context, { previewMode: systemShare.SharePreviewMode.DEFAULT,
        selectionMode: systemShare.SelectionMode.SINGLE });
      // Keep the file after dismissal; the receiving application may still be reading its URI.
    }, false);
  } catch (error) { presenting.delete(id); controllers.delete(id); throw error as Error; }
}
export async function saveDownload(context: common.UIAbilityContext, id: string, expected?: ConnectionSession): Promise<void> {
  if (presenting.has(id)) return;
  presenting.add(id);
  let destination: fileIo.File | undefined;
  try {
    await withTransferLock(context, 'download-' + id, async () => {
      const item = await readyFile(context, id);
      if (expected) await assertCurrentConnection(context, expected);
      const uris = await new picker.DocumentViewPicker(context).save({ newFileNames: [item.filename] });
      if (uris.length === 0) return;
      if (expected) await assertCurrentConnection(context, expected);
      destination = fileIo.openSync(uris[0], fileIo.OpenMode.WRITE_ONLY | fileIo.OpenMode.TRUNC);
      await fileIo.copyFile(item.path, destination.fd);
    }, false);
  } finally {
    try { if (destination) fileIo.closeSync(destination); }
    finally { presenting.delete(id); }
  }
}

export async function pauseAllDownloads(context: common.Context): Promise<boolean> {
  let complete = true;
  const items = await all(context);
  for (let i = 0; i < items.length; i++) {
    if (!items[i].taskId) continue;
    try {
      await withTransferLock(context, 'download-' + items[i].id, async () => {
        const item = (await all(context)).find((entry: DownloadRecord) => entry.id === items[i].id);
        if (!item?.taskId) return;
        let info = await taskInfo(item.taskId);
        if (!info) { complete = false; return; }
        if ([request.agent.State.RUNNING, request.agent.State.WAITING, request.agent.State.RETRYING].includes(info.progress.state)) {
          await (await request.agent.getTask(context, item.taskId)).pause();
          info = await taskInfo(item.taskId);
          if (!info || [request.agent.State.RUNNING, request.agent.State.WAITING, request.agent.State.RETRYING].includes(info.progress.state)) complete = false;
        }
      }, false);
    } catch (_error) { complete = false; }
  }
  return complete;
}
