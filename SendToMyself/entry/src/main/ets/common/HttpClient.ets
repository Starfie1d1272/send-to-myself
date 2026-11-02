import { http } from '@kit.NetworkKit';
import { common } from '@kit.AbilityKit';
import { AuthenticatedConnection, beginAuthorizedDispatch, clearTokenIfCurrent } from './ConnectionSession';

class HttpError extends Error {
  code: number; isAuthError: boolean; isNetworkError: boolean;
  constructor(code: number, message: string, auth: boolean, network: boolean) {
    super(message); this.code = code; this.isAuthError = auth; this.isNetworkError = network;
  }
}
const requests: Set<http.HttpRequest> = new Set<http.HttpRequest>();
export function stopProtectedRequests(): void {
  requests.forEach((client: http.HttpRequest) => { client.destroy(); });
  requests.clear();
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
  try {
    return await beginAuthorizedDispatch(context, connection, () => {
      requests.add(client);
      return client.request(connection.origin + path, options);
    });
  } catch (error) {
    if ((error as Error).message === 'CONNECTION_CHANGED') throw error as Error;
    throw new HttpError(0, 'Network error', false, true);
  } finally { requests.delete(client); client.destroy(); }
}
export async function getJson(context: common.Context, connection: AuthenticatedConnection, path: string): Promise<http.HttpResponse> {
  return protectedRequest(context, connection, path, { method: http.RequestMethod.GET,
    header: { 'Authorization': 'Bearer ' + connection.deviceToken }, connectTimeout: 15000, readTimeout: 15000 });
}
export async function postTextItem(context: common.Context, connection: AuthenticatedConnection,
  content: string, dedupeKey: string): Promise<boolean> {
  const response = await protectedRequest(context, connection, '/api/items', { method: http.RequestMethod.POST,
    header: { 'Authorization': 'Bearer ' + connection.deviceToken, 'Content-Type': 'application/json' },
    extraData: JSON.stringify({ content: content, dedupeKey: dedupeKey }), connectTimeout: 15000, readTimeout: 15000 });
  if (response.responseCode === 201) return true;
  if (response.responseCode === 401) {
    await clearTokenIfCurrent(context, connection.origin, connection.revision);
    throw new HttpError(401, '请先重新登录，待发送内容已保留', true, false);
  }
  throw new HttpError(response.responseCode, '发送失败（HTTP ' + response.responseCode.toString() + '），内容已保留', false, false);
}
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
