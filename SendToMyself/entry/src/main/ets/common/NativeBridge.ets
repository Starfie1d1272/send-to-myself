import { common } from '@kit.AbilityKit';
import { webview } from '@kit.ArkWeb';
import { url } from '@kit.ArkTS';
import { prepareDownload } from './NativeDownloads';
import { loadServerUrl } from './AssetStore';

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
  private open: (id: string, action: string) => Promise<void>;
  private showTools: () => void;
  private busy: boolean = false;
  constructor(context: common.UIAbilityContext, controller: webview.WebviewController,
    open: (id: string, action: string) => Promise<void>, showTools: () => void = () => {}) {
    this.context = context; this.controller = controller; this.open = open; this.showTools = showTools;
  }
  async openTools(): Promise<string> {
    const server = await loadServerUrl();
    if (!server || new url.URL(this.controller.getUrl()).origin !== new url.URL(server).origin ||
      AppStorage.get<boolean>('appForeground') === false) throw new Error('请回到应用首页操作');
    this.showTools();
    return 'opened';
  }
  private async prepare(id: string, filename: string, mimeType: string, size: number, action: string): Promise<string> {
    if (this.busy) throw new Error('正在准备附件，请稍后');
    this.busy = true;
    try {
      const server = await loadServerUrl();
      if (!server) throw new Error('请先连接服务器');
      const expected = new url.URL(server);
      const current = new url.URL(this.controller.getUrl());
      if (current.origin !== expected.origin || AppStorage.get<boolean>('appForeground') === false) {
        throw new Error('请回到应用首页操作');
      }
      // Only attachment IDs cross the bridge. URLs and credential headers are constructed natively.
      const key = await prepareDownload(this.context, id, filename, mimeType, size);
      await this.open(key, action);
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
