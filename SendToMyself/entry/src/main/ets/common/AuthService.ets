import { webview } from '@kit.ArkWeb';
import { pauseAllQueueTasks } from './QueueService';
import { pauseAllDownloads } from './NativeDownloads';
import { http } from '@kit.NetworkKit';
import { common } from '@kit.AbilityKit';
import { anonymousPost, extractSessionCookie, getJson, stopProtectedRequests, protectedRequestsStopped } from './HttpClient';
import { AuthenticatedConnection, ConnectionSession, commitConnection, clearTokenIfCurrent, normalizeOrigin, readConnection } from './ConnectionSession';

interface DeviceTokenResponse { token: string }
interface LoginResponse { ok: boolean }
interface AuthMeResponse { authenticated: boolean }
interface LoginRequestBody { password: string }
interface CreateDeviceRequestBody { name: string }
export interface LoginResultData { success: boolean; errorMessage?: string; connection?: ConnectionSession; webSetCookie?: string }
export async function loginAndMintToken(context: common.Context, candidate: string, password: string,
  deviceName: string, existing?: AuthenticatedConnection, expected?: string): Promise<LoginResultData> {
  const origin = normalizeOrigin(candidate);
  let expectedRevision: string | undefined = expected ?? existing?.revision;
  if (existing) {
    const valid = await checkTokenValid(context, existing);
    if (valid === undefined) return { success: false, errorMessage: 'Network error' };
    if (!valid) {
      const cleared = await clearTokenIfCurrent(context, existing.origin, existing.revision);
      if (!cleared) throw new Error('CONNECTION_CHANGED');
      expectedRevision = cleared.revision;
      existing = undefined;
    }
  }
  let login: http.HttpResponse;
  try { const body: LoginRequestBody = { password: password }; login = await anonymousPost(origin, '/api/auth/login', body); }
  catch (_error) { return { success: false, errorMessage: 'Network error' }; }
  if (login.responseCode === 401) return { success: false, errorMessage: 'Invalid credentials' };
  if (login.responseCode === 429) return { success: false, errorMessage: 'Too many attempts' };
  if (login.responseCode !== 200) return { success: false, errorMessage: 'Server error' };
  try {
    const body = JSON.parse(login.result as string) as LoginResponse;
    if (body.ok !== true) return { success: false, errorMessage: 'Invalid response' };
  } catch (_error) { return { success: false, errorMessage: 'Invalid response' }; }
  const cookie = extractSessionCookie(login);
  if (!cookie) return { success: false, errorMessage: 'No session cookie received' };
  if (existing) {
    const current = await readConnection(context);
    if (!current || current.origin !== existing.origin || current.revision !== existing.revision) throw new Error('CONNECTION_CHANGED');
    return { success: true, connection: current, webSetCookie: cookie.webSetCookie };
  }
  let device: http.HttpResponse;
  try { const body: CreateDeviceRequestBody = { name: deviceName };
    device = await anonymousPost(origin, '/api/auth/devices', body, cookie.cookieHeader);
  } catch (_error) { return { success: false, errorMessage: 'Network error during token minting' }; }
  if (device.responseCode !== 201) return { success: false, errorMessage: 'Failed to mint device token' };
  let token: string;
  try { token = (JSON.parse(device.result as string) as DeviceTokenResponse).token; }
  catch (_error) { return { success: false, errorMessage: 'Invalid response' }; }
  if (typeof token !== 'string' || !token) return { success: false, errorMessage: 'Invalid response' };
  const connection = await commitConnection(context, origin, token, expectedRevision);
  return { success: true, connection: connection, webSetCookie: cookie.webSetCookie };
}
export async function checkTokenValid(context: common.Context, connection: AuthenticatedConnection): Promise<boolean | undefined> {
  try {
    const response = await getJson(context, connection, '/api/auth/me');
    if (response.responseCode !== 200) return undefined;
    const body = JSON.parse(response.result as string) as AuthMeResponse;
    if (body.authenticated === false) return false;
    return body.authenticated === true ? true : undefined;
  } catch (_error) { return undefined; }
}

export interface NativeLogoutResult {
  status: string; serverOrigin: string; cookieCleared: boolean; transferStop: string; remoteSessionLogout: string;
}
export async function logoutCurrentConnection(context: common.Context, activeOrigin: string,
  onSignedOut: (origin: string) => void): Promise<NativeLogoutResult> {
  try {
      const current = await readConnection(context);
      if (!current || current.origin !== activeOrigin) throw new Error('CONNECTION_CHANGED');
      let cookie = '';
      try {
        const raw = webview.WebCookieManager.fetchCookieSync(current.origin, false);
        const parts = raw.split(';');
        for (let i = 0; i < parts.length; i++) if (parts[i].trim().startsWith('stm_session=')) cookie = parts[i].trim();
      } catch (_error) {}
      const cleared = await clearTokenIfCurrent(context, current.origin, current.revision);
      if (!cleared) throw new Error('CONNECTION_CHANGED');
      try { stopProtectedRequests(); } catch (_error) {}
      try { onSignedOut(current.origin); } catch (_error) {}
      let queueStopped = false;
      let downloadsStopped = false;
      try { queueStopped = await pauseAllQueueTasks(context); } catch (_error) {}
      try { downloadsStopped = await pauseAllDownloads(context); } catch (_error) {}
      const transferStop = queueStopped && downloadsStopped && protectedRequestsStopped(context) ? 'complete' : 'unconfirmed';
      let cookieCleared = false;
      try {
        const after = await readConnection(context);
        if (after && after.origin === cleared.origin && after.revision === cleared.revision) {
          const expired = 'stm_session=; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; SameSite=Lax' + (current.origin.startsWith('https://') ? '; Secure' : '');
          webview.WebCookieManager.configCookieSync(current.origin, expired, false, true);
          await webview.WebCookieManager.saveCookieAsync(); cookieCleared = true;
        }
      } catch (_error) {}
      let remote = 'unconfirmed';
      if (cookie) {
        const client = http.createHttp();
        try {
          let timer: number = -1;
          try {
            const deadline = new Promise<http.HttpResponse>((_resolve, reject) => {
              timer = setTimeout(() => { client.destroy(); reject(new Error('timeout')); }, 4000);
            });
            const response = await Promise.race([client.request(current.origin + '/api/auth/logout', { method: http.RequestMethod.POST,
              header: { 'Cookie': cookie }, connectTimeout: 4000, readTimeout: 4000 }), deadline]);
            if (response.responseCode >= 200 && response.responseCode < 300) remote = 'complete';
          } finally { if (timer >= 0) clearTimeout(timer); }
        } catch (_error) {} finally { client.destroy(); }
      }
      return { status: 'signed_out', serverOrigin: current.origin, cookieCleared: cookieCleared,
        transferStop: transferStop, remoteSessionLogout: remote };
  } catch (error) {
    if ((error as Error).message === 'CONNECTION_CHANGED') throw error as Error;
    throw new Error('LOCAL_STORAGE_FAILED');
  }
}
