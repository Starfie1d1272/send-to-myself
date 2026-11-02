import { DetectionContext } from './DetectionContext';
import { http } from '@kit.NetworkKit';
import { common } from '@kit.AbilityKit';
import { fileIo } from '@kit.CoreFileKit';
import { AuthenticatedConnection, beginAuthorizedDispatch, clearTokenIfCurrent } from './ConnectionSession';

interface ApiErrorBody { error?: string }
class HttpError extends Error {
  code: number; isAuthError: boolean; isNetworkError: boolean; domainCode?: string;
  constructor(code: number, message: string, auth: boolean, network: boolean, domainCode?: string) {
    super(message); this.code = code; this.isAuthError = auth; this.isNetworkError = network; this.domainCode = domainCode;
  }
}
const requests: Set<http.HttpRequest> = new Set<http.HttpRequest>();
let protectedReservations = 0;
export function stopProtectedRequests(): void {
  requests.forEach((client: http.HttpRequest) => { try { client.destroy(); } catch (_error) {} });
}
// A shared OS lock covers every protected short request in either process. An
// exclusive probe after logout can therefore distinguish quiescence from an
// inaccessible in-flight request without keeping a persistent request ledger.
function requestLock(context: common.Context): fileIo.File {
  return fileIo.openSync(context.filesDir + '/transfer-protected-http.lock', fileIo.OpenMode.READ_WRITE | fileIo.OpenMode.CREATE);
}
export function protectedRequestsStopped(context: common.Context): boolean {
  if (requests.size > 0 || protectedReservations > 0) return false;
  let file: fileIo.File | undefined;
  let locked = false;
  let stopped = false;
  try {
    file = requestLock(context); file.tryLock(true); locked = true;
    stopped = true;
  } catch (_error) { stopped = false; }
  finally {
    if (file) {
      try { if (locked) file.unlock(); } catch (_error) { stopped = false; }
      try { fileIo.closeSync(file); } catch (_error) { stopped = false; }
    }
  }
  return stopped;
}
export async function anonymousPost(origin: string, path: string, body: object, cookie?: string): Promise<http.HttpResponse> {
  const client = http.createHttp();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (cookie) headers['Cookie'] = cookie;
  try { return await client.request(origin + path, { method: http.RequestMethod.POST, header: headers,
    extraData: JSON.stringify(body), connectTimeout: 15000, readTimeout: 15000 }); }
  finally { client.destroy(); }
}
async function protectedRequest(context: common.Context, connection: AuthenticatedConnection,
  path: string, options: http.HttpRequestOptions): Promise<http.HttpResponse> {
  const client = http.createHttp();
  let file: fileIo.File | undefined;
  let locked = false;
  try {
    file = requestLock(context);
    file.tryLock(false); locked = true; protectedReservations++;
    return await beginAuthorizedDispatch(context, connection, () => {
      requests.add(client);
      return client.request(connection.origin + path, options);
    });
  } catch (error) {
    if ((error as Error).message === 'CONNECTION_CHANGED') throw error as Error;
    throw new HttpError(0, 'Network error', false, true);
  } finally {
    requests.delete(client);
    try { client.destroy(); } catch (_error) {}
    if (file) {
      try { if (locked) file.unlock(); }
      finally { if (locked) protectedReservations--; fileIo.closeSync(file); }
    }
  }
}
export async function getJson(context: common.Context, connection: AuthenticatedConnection, path: string): Promise<http.HttpResponse> {
  return protectedRequest(context, connection, path, { method: http.RequestMethod.GET,
    header: { 'Authorization': 'Bearer ' + connection.deviceToken }, connectTimeout: 15000, readTimeout: 15000 });
}
export async function postTextItem(context: common.Context, connection: AuthenticatedConnection,
  content: string, dedupeKey: string, detectionContext?: DetectionContext): Promise<boolean> {
  const response = await protectedRequest(context, connection, '/api/items', { method: http.RequestMethod.POST,
    header: { 'Authorization': 'Bearer ' + connection.deviceToken, 'Content-Type': 'application/json' },
    extraData: JSON.stringify({ content: content, dedupeKey: dedupeKey, detectionContext: detectionContext }), connectTimeout: 15000, readTimeout: 15000 });
  if (response.responseCode === 201) return true;
  if (response.responseCode === 401) {
    await clearTokenIfCurrent(context, connection.origin, connection.revision);
    throw new HttpError(401, '请先重新登录，待发送内容已保留', true, false);
  }
  if (response.responseCode === 409) {
    try {
      const body = (typeof response.result === 'string' ? JSON.parse(response.result) : response.result) as ApiErrorBody;
      if (body.error === 'already_deleted') throw new HttpError(409, '此次发送对应的内容已永久删除', false, false, 'already_deleted');
    } catch (error) { if (error instanceof HttpError) throw error; }
  }
  throw new HttpError(response.responseCode, '发送失败（HTTP ' + response.responseCode.toString() + '），内容已保留', false, false);
}
export function isAlreadyDeleted(err: Error): boolean { return err instanceof HttpError && err.code === 409 && err.domainCode === 'already_deleted'; }
export function isNetworkError(err: Error): boolean { return err instanceof HttpError && err.isNetworkError; }
export function isAuthError(err: Error): boolean { return err instanceof HttpError && err.isAuthError; }
export interface SessionCookie { cookieHeader: string; webSetCookie: string }
export function extractSessionCookie(response: http.HttpResponse): SessionCookie | null {
  const headers = response.header;
  const names = Object.keys(headers);
  for (let i = 0; i < names.length; i++) {
    if (names[i].toLowerCase() !== 'set-cookie') continue;
    const raw = headers[names[i]] as string | string[];
    const values: string[] = typeof raw === 'string' ? [raw] : raw;
    for (let j = 0; j < values.length; j++) {
      const value = values[j].trim();
      if (value.startsWith('stm_session=')) return { cookieHeader: value.split(';')[0], webSetCookie: value };
    }
  }
  return null;
}
