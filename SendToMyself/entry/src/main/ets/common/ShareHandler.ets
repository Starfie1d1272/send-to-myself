import { common, Want } from '@kit.AbilityKit';
import { systemShare } from '@kit.ShareKit';
import { enqueue, retryQueueItem, isQueued, listQueue, QueueRow } from './QueueService';
import { readConnection } from './ConnectionSession';
import { SharedFileData, copySharedFileAsync, cleanSharedFiles } from './ShareFiles';
import { util } from '@kit.ArkTS';

export interface ShareResultData {
  success: boolean;
  needsLogin: boolean;
  queued: boolean;
  errorMessage?: string;
}
class ShareResult implements ShareResultData {
  success: boolean;
  needsLogin: boolean;
  queued: boolean;
  errorMessage?: string;
  constructor(success: boolean, login: boolean, queued: boolean, error?: string) {
    this.success = success; this.needsLogin = login; this.queued = queued; this.errorMessage = error;
  }
}

export async function handleShare(want: Want, context: common.Context): Promise<ShareResultData> {
  const connection = await readConnection(context);
  if (!connection) return new ShareResult(false, true, false, 'Server not configured');
  let content: string[] = [];
  let records: systemShare.SharedRecord[] = [];
  try {
    records = (await systemShare.getSharedData(want)).getRecords();
  } catch (_error) {
    if (want.parameters) {
      let params = want.parameters as Record<string, Object>;
      if (params['content']) content.push(params['content'] as string);
    }
  }
  let files: SharedFileData[] = [];
  try {
    for (let i = 0; i < records.length; i++) {
      let record = records[i];
      if (record.content) content.push(record.content);
      if (record.uri) {
        if (/^https?:\/\//i.test(record.uri)) content.push(record.uri);
        else files.push(await copySharedFileAsync(context, record.uri, record.title, record.utd));
      }
    }
  } catch (_error) {
    cleanSharedFiles(files);
    return new ShareResult(false, false, false, 'File access failed');
  }
  let text = content.join('\n');
  if (!text.trim() && files.length === 0) return new ShareResult(false, false, false, 'No share content');
  let key = util.generateRandomUUID();
  try {
    // Persist before the first request; process termination cannot lose accepted shares.
    await enqueue(context, key, files.length ? 'upload' : 'text', text, files, connection.origin);
  } catch (_error) {
    cleanSharedFiles(files);
    return new ShareResult(false, false, false, '无法保存待发送内容，请重新分享');
  }
  try { await retryQueueItem(context, key); }
  catch (_error) { return new ShareResult(false, false, true, '内容已保留，请打开应用重试'); }
  if (!await isQueued(context, key)) return new ShareResult(true, false, false);
  let row = (await listQueue(context)).find((item: QueueRow) => item.key === key);
  return new ShareResult(false, !(await readConnection(context))?.deviceToken, true, row?.status || '已加入后台传输，可在应用内查看进度');
}
