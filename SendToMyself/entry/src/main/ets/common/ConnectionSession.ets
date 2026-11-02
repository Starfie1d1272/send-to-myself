import { common } from '@kit.AbilityKit';
import { url, util } from '@kit.ArkTS';
import { readAsset, writeAsset, removeAsset } from './AssetStore';
import { ASSET_ALIAS_SERVER_URL, ASSET_ALIAS_DEVICE_TOKEN } from './Constants';
import { withTransferLock } from './TransferLock';

const ALIAS = 'stm_connection_v1';
export interface ConnectionSession { version: number; origin: string; deviceToken: string | null; revision: string }
export interface AuthenticatedConnection { version: number; origin: string; deviceToken: string; revision: string }
function length(value: string): number { return new util.TextEncoder().encodeInto(value).length; }
export function normalizeOrigin(input: string): string {
  let value = input.trim();
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(value)) value = 'http://' + value;
  if (!/^https?:\/\/[^/?#]+\/?$/i.test(value)) throw new Error('服务器地址无效');
  const parsed = new url.URL(value);
  if ((parsed.protocol !== 'http:' && parsed.protocol !== 'https:') || parsed.username || parsed.password ||
    (parsed.pathname !== '/' && parsed.pathname !== '') || parsed.search || parsed.hash || length(parsed.origin) > 512) {
    throw new Error('服务器地址无效');
  }
  return parsed.origin;
}
function parse(value: string): ConnectionSession {
  const record = JSON.parse(value) as ConnectionSession;
  if (record.version !== 1 || typeof record.origin !== 'string' || normalizeOrigin(record.origin) !== record.origin ||
    typeof record.revision !== 'string' || !record.revision ||
    !(record.deviceToken === null || (typeof record.deviceToken === 'string' && !!record.deviceToken && length(record.deviceToken) <= 256))) {
    throw new Error('LOCAL_STORAGE_FAILED');
  }
  return record;
}
async function write(record: ConnectionSession, exists: boolean): Promise<void> {
  const encoded = JSON.stringify(record);
  try { await writeAsset(ALIAS, encoded, exists); }
  catch (_error) {
    const saved = await readAsset(ALIAS);
    if (!saved || parse(saved).revision !== record.revision) throw new Error('LOCAL_STORAGE_FAILED');
  }
  const saved = await readAsset(ALIAS);
  if (!saved || saved !== encoded) throw new Error('LOCAL_STORAGE_FAILED');
}
async function readLocked(): Promise<ConnectionSession | null> {
  const value = await readAsset(ALIAS);
  if (value !== null) return parse(value);
  const server = await readAsset(ASSET_ALIAS_SERVER_URL);
  const token = await readAsset(ASSET_ALIAS_DEVICE_TOKEN);
  if (server === null && token === null) return null;
  if (!server || (token !== null && (!token || length(token) > 256))) throw new Error('LOCAL_STORAGE_FAILED');
  const record: ConnectionSession = { version: 1, origin: normalizeOrigin(server), deviceToken: token,
    revision: util.generateRandomUUID() };
  await write(record, false);
  try { await removeAsset(ASSET_ALIAS_SERVER_URL); } catch (_error) {}
  try { await removeAsset(ASSET_ALIAS_DEVICE_TOKEN); } catch (_error) {}
  return record;
}
export async function readConnection(context: common.Context): Promise<ConnectionSession | null> {
  return withTransferLock(context, 'connection', () => readLocked());
}
export async function commitConnection(context: common.Context, origin: string, token: string, expectedRevision?: string): Promise<ConnectionSession> {
  const normalized = normalizeOrigin(origin);
  if (!token || length(token) > 256) throw new Error('LOCAL_STORAGE_FAILED');
  return withTransferLock(context, 'connection', async () => {
    const current = await readLocked();
    if (expectedRevision && (!current || current.revision !== expectedRevision || current.origin !== normalized)) throw new Error('CONNECTION_CHANGED');
    const record: ConnectionSession = { version: 1, origin: normalized, deviceToken: token, revision: util.generateRandomUUID() };
    await write(record, current !== null);
    return record;
  });
}
export async function clearTokenIfCurrent(context: common.Context, origin: string, revision: string): Promise<ConnectionSession | null> {
  return withTransferLock(context, 'connection', async () => {
    const current = await readLocked();
    if (!current || current.origin !== origin || current.revision !== revision) return null;
    const record: ConnectionSession = { version: 1, origin: current.origin, deviceToken: null, revision: util.generateRandomUUID() };
    await write(record, true);
    return record;
  });
}
export async function requireConnection(context: common.Context): Promise<AuthenticatedConnection> {
  const current = await readConnection(context);
  if (!current || !current.deviceToken) throw new Error('请先重新登录，待发送内容已保留');
  return { version: 1, origin: current.origin, deviceToken: current.deviceToken, revision: current.revision };
}
export async function beginAuthorizedDispatch<T>(context: common.Context, snapshot: AuthenticatedConnection,
  start: () => Promise<T>): Promise<T> {
  let pending: Promise<T> | undefined;
  await withTransferLock(context, 'connection', async () => {
    const current = await readLocked();
    if (!current || !current.deviceToken || current.origin !== snapshot.origin || current.revision !== snapshot.revision) {
      throw new Error('CONNECTION_CHANGED');
    }
    pending = start();
  });
  return await pending!;
}
