import { http } from '@kit.NetworkKit';
import { loadDeviceToken, removeDeviceToken, loadServerUrl } from './AssetStore';
import { hilog } from '@kit.PerformanceAnalysisKit';
import { DOMAIN, TAG } from './Constants';
import { util } from '@kit.ArkTS';

class HttpError extends Error {
  code: number = 0;
  isAuthError: boolean = false;
  isNetworkError: boolean = false;

  constructor(code: number, message: string, isAuthError: boolean, isNetworkError: boolean) {
    super(message);
    this.code = code;
    this.isAuthError = isAuthError;
    this.isNetworkError = isNetworkError;
  }
}

interface LoginRequestBody {
  password: string;
}

interface CreateItemRequestBody {
  content: string;
  dedupeKey: string;
}

interface CreateDeviceRequestBody {
  name: string;
}

export async function postJson(path: string, body: object, cookie?: string): Promise<http.HttpResponse> {
  let serverUrl = await loadServerUrl();
  if (!serverUrl) {
    throw new Error('Server URL not configured');
  }
  let url = serverUrl + path;
  let header: Record<string, string> = {
    'Content-Type': 'application/json'
  };
  if (cookie) {
    header['Cookie'] = cookie;
  }
  let token = await loadDeviceToken();
  if (token) {
    header['Authorization'] = 'Bearer ' + token;
  }
  let httpRequest = http.createHttp();
  let response = await httpRequest.request(url, {
    method: http.RequestMethod.POST,
    header: header,
    extraData: JSON.stringify(body),
    connectTimeout: 15000,
    readTimeout: 15000
  });
  httpRequest.destroy();
  return response;
}

export async function getJson(path: string): Promise<http.HttpResponse> {
  let serverUrl = await loadServerUrl();
  if (!serverUrl) {
    throw new Error('Server URL not configured');
  }
  let url = serverUrl + path;
  let header: Record<string, string> = {};
  let token = await loadDeviceToken();
  if (token) {
    header['Authorization'] = 'Bearer ' + token;
  }
  let httpRequest = http.createHttp();
  let response = await httpRequest.request(url, {
    method: http.RequestMethod.GET,
    header: header,
    connectTimeout: 15000,
    readTimeout: 15000
  });
  httpRequest.destroy();
  return response;
}

export function isNetworkError(err: Error): boolean {
  return err instanceof HttpError && err.isNetworkError;
}

export function isAuthError(err: Error): boolean {
  return err instanceof HttpError && err.isAuthError;
}

export async function postTextItem(content: string, dedupeKey: string): Promise<boolean> {
  try {
    let reqBody: CreateItemRequestBody = { content: content, dedupeKey: dedupeKey };
    let response = await postJson('/api/items', reqBody);
    if (response.responseCode === 201) {
      return true;
    }
    if (response.responseCode === 401) {
      await removeDeviceToken();
      return false;
    }
    hilog.error(DOMAIN, TAG, 'postTextItem failed: %{public}s', response.responseCode.toString());
    return false;
  } catch (err) {
    let errMsg = (err as Error).message;
    hilog.error(DOMAIN, TAG, 'postTextItem network error: %{public}s', errMsg);
    throw new HttpError(0, 'Network error', false, true);
  }
}

export async function postUploadItem(
  content: string | undefined,
  fileSandboxPaths: string[],
  dedupeKey: string
): Promise<boolean> {
  let serverUrl = await loadServerUrl();
  if (!serverUrl) {
    throw new Error('Server URL not configured');
  }
  let token = await loadDeviceToken();
  if (!token) {
    throw new HttpError(0, 'Device token not found', true, false);
  }
  let url = serverUrl + '/api/items/upload';
  let header: Record<string, string> = {
    'Authorization': 'Bearer ' + token
  };
  let multiFormDataList: http.MultiFormData[] = [];
  if (content && content.length > 0) {
    multiFormDataList.push({
      name: 'content',
      contentType: 'text/plain',
      data: stringToArray(content)
    });
  }
  for (let i = 0; i < fileSandboxPaths.length; i++) {
    multiFormDataList.push({
      name: 'files',
      contentType: 'application/octet-stream',
      filePath: fileSandboxPaths[i],
      remoteFileName: 'file_' + i.toString()
    });
  }
  multiFormDataList.push({
    name: 'dedupeKey',
    contentType: 'text/plain',
    data: stringToArray(dedupeKey)
  });
  let httpRequest = http.createHttp();
  try {
    let response = await httpRequest.request(url, {
      method: http.RequestMethod.POST,
      header: header,
      multiFormDataList: multiFormDataList,
      connectTimeout: 60000,
      readTimeout: 60000
    });
    if (response.responseCode === 201) {
      return true;
    }
    if (response.responseCode === 401) {
      await removeDeviceToken();
      return false;
    }
    hilog.error(DOMAIN, TAG, 'postUploadItem failed: %{public}s', response.responseCode.toString());
    return false;
  } catch (err) {
    let errMsg = (err as Error).message;
    hilog.error(DOMAIN, TAG, 'postUploadItem network error: %{public}s', errMsg);
    throw new HttpError(0, 'Network error', false, true);
  } finally {
    httpRequest.destroy();
  }
}

export function extractCookieFromResponse(response: http.HttpResponse): string {
  let setCookie: string | Object | undefined = response.header['set-cookie'] as string | Object | undefined;
  if (!setCookie) {
    return '';
  }
  if (typeof setCookie === 'string') {
    return (setCookie as string).split(';')[0];
  }
  if (Array.isArray(setCookie)) {
    let cookies: Object[] = setCookie as Object[];
    let result = '';
    for (let i = 0; i < cookies.length; i++) {
      let cookie = (cookies[i] as string).split(';')[0];
      if (i > 0) {
        result += '; ';
      }
      result += cookie;
    }
    return result;
  }
  return '';
}

function stringToArray(str: string): Uint8Array {
  let textEncoder = new util.TextEncoder();
  return textEncoder.encodeInto(str);
}
