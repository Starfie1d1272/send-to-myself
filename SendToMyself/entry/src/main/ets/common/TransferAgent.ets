import { request, BusinessError } from '@kit.BasicServicesKit';
import { common } from '@kit.AbilityKit';
import { loadDeviceToken } from './AssetStore';
import { SharedFileData } from './ShareFiles';

export { request };

export async function transferHeaders(): Promise<Record<string, string>> {
  const token = await loadDeviceToken();
  if (!token) throw new Error('请先重新登录，待发送内容已保留');
  return { 'Authorization': 'Bearer ' + token };
}

export async function createUpload(context: common.Context, server: string, key: string,
  content: string, files: SharedFileData[]): Promise<request.agent.Task> {
  const specs: request.agent.FileSpec[] = files.map((file: SharedFileData): request.agent.FileSpec => {
    return { path: file.path, filename: file.filename, contentType: file.mimeType };
  });
  const data: request.agent.FormItem[] = [
    { name: 'content', value: content }, { name: 'dedupeKey', value: key }, { name: 'files', value: specs }
  ];
  return request.agent.create(context, {
    action: request.agent.Action.UPLOAD, mode: request.agent.Mode.BACKGROUND,
    url: server.replace(/\/$/, '') + '/api/items/upload', method: 'POST',
    headers: await transferHeaders(), data: data, multipart: true,
    network: request.agent.Network.ANY, metered: true, roaming: false,
    retry: true, redirect: false, gauge: true,
    title: '发给自己 · 发送附件', description: files.length.toString() + ' 个文件',
    extras: { queueKey: key }
  });
}

export async function taskInfo(id: string): Promise<request.agent.TaskInfo | undefined> {
  try { return await request.agent.show(id); }
  catch (error) {
    if ((error as BusinessError).code === 21900006) return undefined;
    throw error as Error;
  }
}

export async function removeTask(id: string): Promise<void> {
  try { await request.agent.remove(id); }
  catch (error) { if ((error as BusinessError).code !== 21900006) throw error as Error; }
}

export function taskLabel(info: request.agent.TaskInfo): string {
  switch (info.progress.state) {
    case request.agent.State.INITIALIZED: return '准备传输';
    case request.agent.State.WAITING: return '等待网络或系统调度';
    case request.agent.State.RUNNING: return '传输中';
    case request.agent.State.RETRYING: return '正在重试';
    case request.agent.State.PAUSED: return '已暂停';
    case request.agent.State.STOPPED: return '已停止';
    case request.agent.State.COMPLETED: return '已完成';
    case request.agent.State.FAILED: return '传输失败，可重试';
    default: return '任务已移除，可重试';
  }
}

export function progressText(info: request.agent.TaskInfo): string {
  const sizes = info.progress.sizes;
  const total = sizes.reduce((sum: number, size: number) => sum + Math.max(0, size), 0);
  if (total <= 0 || sizes.some((size: number) => size < 0)) return taskLabel(info);
  let processed = info.progress.processed;
  for (let i = 0; i < info.progress.index; i++) processed += Math.max(0, sizes[i]);
  return taskLabel(info) + ' · ' + Math.min(100, Math.floor(processed * 100 / total)).toString() + '%';
}
