import { parseDetectionContext } from './DetectionContext';
import { common } from '@kit.AbilityKit';
import { webview } from '@kit.ArkWeb';
import { url } from '@kit.ArkTS';
import { requestAttachmentAction } from './NativeDownloads';
import { openHandoff } from './UploadHandoff';
import { getUploadReceipt } from './QueueService';
import { readConnection, ConnectionSession, assertCurrentConnection } from './ConnectionSession';

interface UrlPermission { scheme: string; host: string; port: string; path: string }
interface ProxyPermission { urlPermissionList: UrlPermission[] }
interface PermissionConfig { javascriptProxyPermission: ProxyPermission }

export function bridgePermission(server: string): string {
  const parsed = new url.URL(server);
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error('服务器地址无效');
  const permission: PermissionConfig = {
    javascriptProxyPermission: { urlPermissionList: [{ scheme: parsed.protocol.replace(':', ''),
      host: parsed.hostname, port: parsed.port || (parsed.protocol === 'https:' ? '443' : '80'), path: parsed.pathname || '/' }] }
  };
  return JSON.stringify(permission);
}

export class NativeBridge {
  private context: common.UIAbilityContext;
  private controller: webview.WebviewController;
  private open: (id: string, action: string, source: ConnectionSession) => Promise<void>;
  private showTools: () => void;
  private busy: boolean = false;
  private uploadRoute?: () => Promise<void>;
  private reauthAction: (source: ConnectionSession) => Promise<string>;
  private logoutAction: (source: ConnectionSession) => Promise<string>;
  constructor(context: common.UIAbilityContext, controller: webview.WebviewController,
    open: (id: string, action: string, source: ConnectionSession) => Promise<void>, showTools: () => void,
    reauthAction: (source: ConnectionSession) => Promise<string>, logoutAction: (source: ConnectionSession) => Promise<string>, uploadRoute?: () => Promise<void>) {
    this.context = context; this.controller = controller; this.open = open; this.showTools = showTools;
    this.reauthAction = reauthAction; this.logoutAction = logoutAction; this.uploadRoute = uploadRoute;
  }
  private async verifyPage(): Promise<ConnectionSession> {
    const connection = await readConnection(this.context);
    if (!connection || new url.URL(this.controller.getUrl()).origin !== connection.origin ||
      AppStorage.get<boolean>('appForeground') === false) throw new Error('UNTRUSTED_PAGE');
    return connection;
  }
  private async verifyStillCurrent(source: ConnectionSession): Promise<void> {
    await assertCurrentConnection(this.context, source);
    if (new url.URL(this.controller.getUrl()).origin !== source.origin || AppStorage.get<boolean>('appForeground') === false) throw new Error('UNTRUSTED_PAGE');
  }
  async reauthenticate(): Promise<string> { const source = await this.verifyPage(); return this.reauthAction(source); }
  async logout(): Promise<string> { const source = await this.verifyPage(); return this.logoutAction(source); }
  async openTools(): Promise<string> { try { await this.openTransfers(); return 'opened'; } catch (_error) { throw new Error('请回到应用首页操作'); } }
  async openTransfers(): Promise<string> { await this.verifyPage(); this.showTools(); return JSON.stringify({ status: 'opened' }); }
  async openUpload(content: string, key: string, detectionContextJson?: string): Promise<string> {
    const connection = await this.verifyPage();
    if (!this.uploadRoute) throw new Error('BUSY');
    const detectionContext = detectionContextJson === undefined ? undefined : parseDetectionContext(detectionContextJson);
    const route = this.uploadRoute;
    const result = await openHandoff(this.context, content, key, connection, async () => { await this.verifyStillCurrent(connection); await route(); }, detectionContext);
    await this.verifyStillCurrent(connection);
    return result;
  }
  async getUploadReceipt(key: string): Promise<string> {
    const connection = await this.verifyPage();
    if (!key || key.length > 64) throw new Error('INVALID_INPUT');
    const accepted = await getUploadReceipt(this.context, key, connection.origin);
    await this.verifyStillCurrent(connection);
    return JSON.stringify({ status: accepted ? 'accepted' : 'unknown', dedupeKey: key, serverOrigin: connection.origin });
  }
  private async prepare(id: string, filename: string, mimeType: string, size: number, action: string): Promise<string> {
    if (this.busy) throw new Error('正在准备附件，请稍后');
    this.busy = true;
    try {
      let connection: ConnectionSession;
      try { connection = await this.verifyPage(); } catch (_error) { throw new Error('请回到应用首页操作'); }
      const key = await requestAttachmentAction(this.context, id, action, connection);
      await this.verifyStillCurrent(connection);
      await this.open(key, action, connection);
      return 'queued';
    } finally { this.busy = false; }
  }
  async shareAttachment(id: string, filename: string, mimeType: string, size: number): Promise<string> {
    return this.prepare(id, filename, mimeType, size, 'share');
  }
  async saveAttachment(id: string, filename: string, mimeType: string, size: number): Promise<string> {
    return this.prepare(id, filename, mimeType, size, 'save');
  }
}
