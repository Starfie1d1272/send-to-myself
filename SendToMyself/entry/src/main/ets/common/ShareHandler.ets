import { common } from '@kit.AbilityKit';
import { systemShare } from '@kit.ShareKit';
import { Want } from '@kit.AbilityKit';
import { fileIo, fileUri } from '@kit.CoreFileKit';
import { postTextItem, postUploadItem, isNetworkError, isAuthError } from './HttpClient';
import { enqueue, processQueue } from './QueueService';
import { loadDeviceToken, loadServerUrl } from './AssetStore';
import { hilog } from '@kit.PerformanceAnalysisKit';
import { DOMAIN, TAG } from './Constants';
import { util } from '@kit.ArkTS';

export interface ShareResultData {
  success: boolean;
  needsLogin: boolean;
  queued: boolean;
  errorMessage?: string;
}

class ShareResult implements ShareResultData {
  success: boolean = false;
  needsLogin: boolean = false;
  queued: boolean = false;
  errorMessage?: string = undefined;

  constructor(success: boolean, needsLogin: boolean, queued: boolean, errorMessage?: string) {
    this.success = success;
    this.needsLogin = needsLogin;
    this.queued = queued;
    this.errorMessage = errorMessage;
  }
}

function generateDedupeKey(): string {
  return util.generateRandomUUID();
}

async function copyUriToSandbox(context: common.Context, uri: string): Promise<string> {
  let srcFile = fileIo.openSync(uri, fileIo.OpenMode.READ_ONLY);
  let fileName = 'share_file_' + Date.now().toString();
  let sandboxPath = context.cacheDir + '/' + fileName;
  let destFile = fileIo.openSync(sandboxPath, fileIo.OpenMode.READ_WRITE | fileIo.OpenMode.CREATE);
  fileIo.copyFileSync(srcFile.fd, destFile.fd);
  fileIo.closeSync(srcFile);
  fileIo.closeSync(destFile);
  return sandboxPath;
}

export async function handleShare(want: Want, context: common.Context): Promise<ShareResultData> {
  let token = await loadDeviceToken();
  if (!token) {
    return new ShareResult(false, true, false, 'Not logged in');
  }
  let serverUrl = await loadServerUrl();
  if (!serverUrl) {
    return new ShareResult(false, true, false, 'Server not configured');
  }

  let dedupeKey = generateDedupeKey();
  let textContent: string | undefined = undefined;
  let fileUris: string[] = [];

  try {
    let sharedData = await systemShare.getSharedData(want);
    let records = sharedData.getRecords();
    for (let i = 0; i < records.length; i++) {
      let record = records[i];
      if (record.content && record.content.length > 0) {
        textContent = record.content;
      }
      if (record.uri && record.uri.length > 0) {
        fileUris.push(record.uri);
      }
    }
  } catch (err) {
    let errMsg = (err as Error).message;
    hilog.error(DOMAIN, TAG, 'Failed to parse share data: %{public}s', errMsg);
    if (want.parameters) {
      let params = want.parameters as Record<string, Object>;
      if (params['content']) {
        textContent = params['content'] as string;
      }
    }
  }

  if (!textContent && fileUris.length === 0) {
    return new ShareResult(false, false, false, 'No share content');
  }

  if (fileUris.length === 0 && textContent) {
    try {
      let success = await postTextItem(textContent, dedupeKey);
      if (success) {
        return new ShareResult(true, false, false);
      }
      return new ShareResult(false, true, false);
    } catch (err) {
      if (isNetworkError(err as Error)) {
        await enqueue(context, dedupeKey, 'text', textContent);
        return new ShareResult(false, false, true);
      }
      return new ShareResult(false, false, false, (err as Error).message);
    }
  }

  let sandboxPaths: string[] = [];
  try {
    for (let i = 0; i < fileUris.length; i++) {
      let sandboxPath = await copyUriToSandbox(context, fileUris[i]);
      sandboxPaths.push(sandboxPath);
    }
  } catch (err) {
    let errMsg = (err as Error).message;
    hilog.error(DOMAIN, TAG, 'Failed to copy share files: %{public}s', errMsg);
    return new ShareResult(false, false, false, 'File access failed');
  }

  try {
    let success = await postUploadItem(textContent, sandboxPaths, dedupeKey);
    for (let i = 0; i < sandboxPaths.length; i++) {
      fileIo.unlinkSync(sandboxPaths[i]);
    }
    if (success) {
      return new ShareResult(true, false, false);
    }
    return new ShareResult(false, true, false);
  } catch (err) {
    if (isNetworkError(err as Error)) {
      await enqueue(context, dedupeKey, 'upload', textContent, sandboxPaths);
      return new ShareResult(false, false, true);
    }
    return new ShareResult(false, false, false, (err as Error).message);
  }
}
