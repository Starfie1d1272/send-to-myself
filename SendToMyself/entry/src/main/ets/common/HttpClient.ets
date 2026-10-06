import { http } from '@kit.NetworkKit';
import { loadDeviceToken, removeDeviceToken, loadServerUrl } from './AssetStore';
import { util } from '@kit.ArkTS';
import { SharedFileData } from './ShareFiles';

class HttpError extends Error {
  code: number;
  isAuthError: boolean;
  isNetworkError: boolean;
  constructor(code: number, message: string, auth: boolean, network: boolean) {
    super(message);
    this.code = code;
    this.isAuthError = auth;
    this.isNetworkError = network;
  }
}
interface CreateItemRequestBody { content: string; dedupeKey: string }

async function request(path: string, options: http.HttpRequestOptions): Promise<http.HttpResponse> {
  let serverUrl = await loadServerUrl();
  if (!serverUrl) throw new HttpError(0, 'Server URL not configured', false, false);
  let client = http.createHttp();
  try {
    return await client.request(serverUrl + path, options);
  } catch (_err) {
    throw new HttpError(0, 'Network error', false, true);
  } finally {
    client.destroy();
  }
}

export async function postJson(path: string, body: object, cookie?: string): Promise<http.HttpResponse> {
  let header: Record<string, string> = { 'Content-Type': 'application/json' };
  if (cookie) header['Cookie'] = cookie;
  // Login/session token minting must not send an old server's device token.
  if (!cookie && path !== '/api/auth/login') {
    let token = await loadDeviceToken();
    if (token) header['Authorization'] = 'Bearer ' + token;
  }
  return request(path, { method: http.RequestMethod.POST, header: header,
    extraData: JSON.stringify(body), connectTimeout: 15000, readTimeout: 15000 });
}

export async function getJson(path: string): Promise<http.HttpResponse> {
  let header: Record<string, string> = {};
  let token = await loadDeviceToken();
  if (token) header['Authorization'] = 'Bearer ' + token;
  return request(path, { method: http.RequestMethod.GET, header: header,
    connectTimeout: 15000, readTimeout: 15000 });
}

export function isNetworkError(err: Error): boolean { return err instanceof HttpError && err.isNetworkError; }
export function isAuthError(err: Error): boolean { return err instanceof HttpError && err.isAuthError; }

async function requireToken(): Promise<string> {
  let token = await loadDeviceToken();
  if (!token) throw new HttpError(401, '请先重新登录，待发送内容已保留', true, false);
  return token;
}
async function accepted(response: http.HttpResponse): Promise<boolean> {
  if (response.responseCode === 201) return true;
  if (response.responseCode === 401) {
    await removeDeviceToken();
    throw new HttpError(401, '请先重新登录，待发送内容已保留', true, false);
  }
  throw new HttpError(response.responseCode,
    '发送失败（HTTP ' + response.responseCode.toString() + '），内容已保留', false, false);
}
export async function postTextItem(content: string, dedupeKey: string): Promise<boolean> {
  await requireToken();
  let body: CreateItemRequestBody = { content: content, dedupeKey: dedupeKey };
  return accepted(await postJson('/api/items', body));
}
export async function postUploadItem(content: string | undefined, files: SharedFileData[], dedupeKey: string): Promise<boolean> {
  let token = await requireToken();
  let parts: http.MultiFormData[] = [];
  if (content && content.length > 0) parts.push({ name: 'content', contentType: 'text/plain', data: stringToArray(content) });
  for (let i = 0; i < files.length; i++) {
    parts.push({ name: 'files', contentType: files[i].mimeType, filePath: files[i].path, remoteFileName: files[i].filename });
  }
  parts.push({ name: 'dedupeKey', contentType: 'text/plain', data: stringToArray(dedupeKey) });
  return accepted(await request('/api/items/upload', { method: http.RequestMethod.POST,
    header: { 'Authorization': 'Bearer ' + token }, multiFormDataList: parts,
    connectTimeout: 60000, readTimeout: 60000 }));
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
