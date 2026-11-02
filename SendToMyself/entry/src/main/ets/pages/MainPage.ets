import { webview } from '@kit.ArkWeb';
import { url } from '@kit.ArkTS';
import { readConnection, requireConnection, clearTokenIfCurrent, normalizeOrigin, AuthenticatedConnection, ConnectionSession, assertCurrentConnection, authenticatedSnapshot } from '../common/ConnectionSession';
import { checkTokenValid, loginAndMintToken, logoutCurrentConnection, clearSignedOutCookie, installSessionCookie } from '../common/AuthService';
import { startNetMonitor, stopNetMonitor } from '../common/NetMonitor';
import { processQueue, queueStatus } from '../common/QueueService';
import { hilog } from '@kit.PerformanceAnalysisKit';
import { DOMAIN, TAG } from '../common/Constants';
import { common } from '@kit.AbilityKit';
import { requestAttachmentAction } from '../common/NativeDownloads';
import { promptAction } from '@kit.ArkUI';
import { NativeBridge, bridgePermission } from '../common/NativeBridge';
import { registerHostReauthentication, unregisterHostReauthentication, registerHostConnectionSettings, unregisterHostConnectionSettings } from '../common/HostReauthentication';

// 与 Web 端 (apps/web/src/styles/global.css) 共用的设计语言
import { PAPER as C_PAPER, CARD as C_CARD, CARD_HI, INK as C_INK, INK_SOFT as C_INK_SOFT, INK_FAINT as C_INK_FAINT, LINE_STRONG as C_LINE, ACCENT as C_ACCENT, ERROR as C_RED } from '../common/Theme';

type Phase = 'loading' | 'login' | 'web';

@Entry
@Component
struct MainPage {
  controller: webview.WebviewController = new webview.WebviewController();
  @StorageLink('appForeground') @Watch('onForegroundChange') appForeground: boolean = true;
  @State serverUrl: string = '';
  @State activeOrigin: string = '';
  @State hasToken: boolean = false;
  @State phase: Phase = 'loading';
  @State password: string = '';
  @State busy: boolean = false;
  @State errorMsg: string = '';
  @State pendingCount: number = 0;
  @State queueError: string = '';
  @State queueBusy: boolean = false;
  @State refreshing: boolean = false;
  @State authOverlay: boolean = false;
  @State authSubmitting: boolean = false;
  @State signedOut: boolean = false;
  @State logoutNotice: string = '';
  @State webCookieBlocked: boolean = false;
  @State connectionSettings: boolean = false;
  @State cookieCleanupNeeded: boolean = false;
  private settingsOrigin: string = '';
  private settingsRevision: string = '';
  private cleanupOrigin: string = '';
  private cleanupRevision: string = '';
  private hostConnectionSettings: () => Promise<void> = () => this.openConnectionSettings();
  private hostReauthentication: () => Promise<string> = () => this.beginReauthenticate();
  private authResolve?: (value: string) => void;
  private authReject?: (reason: Error) => void;
  private authOrigin: string = '';
  private authRevision: string = '';
  private pageRevision: number = Date.now();
  private useFreshEntry: boolean = false;
  private context: common.UIAbilityContext = getContext(this) as common.UIAbilityContext;
  private nativeBridge: NativeBridge = new NativeBridge(this.context, this.controller, async (id: string, action: string, source: ConnectionSession) => {
    await this.getUIContext().getRouter().pushUrl({ url: 'pages/TransfersPage', params: { downloadId: id, action: action, sourceOrigin: source.origin, sourceRevision: source.revision } });
  }, () => {
    this.getUIContext().showActionSheet({ title: '文件与连接', message: '', sheets: [
      { title: '传输任务', action: () => { this.getUIContext().getRouter().pushUrl({ url: 'pages/TransfersPage' }); } },
      { title: '连接设置', action: () => { this.openConnectionSettings().catch(() => { promptAction.showToast({ message: '无法打开连接设置，请重试' }); }); } }
    ] });
  }, (source: ConnectionSession) => this.beginReauthenticate(source), (source: ConnectionSession) => this.logoutConnection(source), async () => {
    await this.getUIContext().getRouter().pushUrl({ url: 'pages/UploadPage' });
  });

  private async openConnectionSettings(): Promise<void> {
    if (this.busy) throw new Error('AUTH_BUSY');
    this.busy = true;
    try {
      const current = await readConnection(this.context);
      this.settingsOrigin = current?.origin ?? '';
      this.settingsRevision = current?.revision ?? '';
      this.serverUrl = current?.origin ?? this.activeOrigin;
      this.password = ''; this.errorMsg = ''; this.connectionSettings = true;
    } finally { this.busy = false; }
  }
  private cancelConnectionSettings(): void {
    if (this.busy) return;
    this.connectionSettings = false; this.serverUrl = this.activeOrigin; this.password = ''; this.errorMsg = '';
  }
  private async retryCookieCleanup(): Promise<void> {
    if (this.busy || !this.cookieCleanupNeeded) return;
    this.busy = true;
    try {
      await clearSignedOutCookie(this.context, this.cleanupOrigin, this.cleanupRevision);
      this.cookieCleanupNeeded = false;
      this.logoutNotice += ' 网页会话已清理。';
      this.errorMsg = '';
    } catch (_error) { this.errorMsg = '网页会话清理未完成，请确认连接未改变后重试'; }
    finally { this.busy = false; }
  }

  private async beginReauthenticate(source?: ConnectionSession): Promise<string> {
    if (this.busy) throw new Error('AUTH_BUSY');
    this.busy = true;
    try {
      const current = await readConnection(this.context);
      if (!current || current.origin !== this.activeOrigin || (source && (source.origin !== current.origin || source.revision !== current.revision))) throw new Error('CONNECTION_CHANGED');
      this.authOrigin = current.origin; this.authRevision = current.revision;
      this.password = ''; this.errorMsg = ''; this.authOverlay = true;
      return await new Promise<string>((resolve, reject) => { this.authResolve = resolve; this.authReject = reject; });
    } catch (error) {
      this.busy = false;
      throw error as Error;
    }
  }
  private cancelReauthenticate(): void {
    const resolve = this.authResolve;
    this.authResolve = undefined; this.authReject = undefined;
    this.authOverlay = false; this.busy = false; this.password = '';
    if (resolve) resolve(JSON.stringify({ status: 'cancelled', serverOrigin: this.authOrigin }));
  }
  private async submitReauthenticate(): Promise<void> {
    if (!this.authOverlay || !this.password || this.authSubmitting) return;
    this.authSubmitting = true;
    const origin = this.authOrigin; const revision = this.authRevision; const password = this.password;
    try {
      const current = await readConnection(this.context);
      if (!current || current.origin !== origin || current.revision !== revision) throw new Error('CONNECTION_CHANGED');
      let snapshot: AuthenticatedConnection | undefined;
      if (current.deviceToken) snapshot = authenticatedSnapshot(current);
      const result = await loginAndMintToken(this.context, origin, password, '鸿蒙手机', snapshot, revision);
      if (!result.success) {
        this.errorMsg = this.mapError(result.errorMessage);
        throw new Error(result.errorMessage === 'Network error' || result.errorMessage === 'Network error during token minting' ? 'NETWORK_UNAVAILABLE' : 'AUTH_FAILED');
      }
      if (!result.connection || !result.webSetCookie) throw new Error('AUTH_FAILED');
      const after = await readConnection(this.context);
      if (!after || after.origin !== origin || after.revision !== result.connection.revision) throw new Error('CONNECTION_CHANGED');
      this.authRevision = after.revision;
      await installSessionCookie(this.context, origin, after.revision, result.webSetCookie);
      await assertCurrentConnection(this.context, after);
      this.activeOrigin = origin; this.serverUrl = origin; this.hasToken = true;
      this.signedOut = false; this.webCookieBlocked = false; this.cookieCleanupNeeded = false;
      this.phase = 'web';
      const resolve = this.authResolve;
      this.authResolve = undefined; this.authReject = undefined; this.password = ''; this.busy = false; this.authOverlay = false; this.authSubmitting = false;
      if (resolve) resolve(JSON.stringify({ status: 'authenticated', serverOrigin: origin, revision: after.revision }));
    } catch (error) {
      const code = (error as Error).message;
      if (!this.errorMsg) this.errorMsg = code === 'CONNECTION_CHANGED' ? '连接已改变，请重试' : '重新登录失败，请检查口令和服务器后重试';
      const reject = this.authReject;
      this.authResolve = undefined; this.authReject = undefined; this.password = ''; this.busy = false; this.authOverlay = false; this.authSubmitting = false;
      if (reject) reject(new Error(['CONNECTION_CHANGED', 'NETWORK_UNAVAILABLE', 'LOCAL_STORAGE_FAILED'].includes(code) ? code : 'AUTH_FAILED'));
    }
  }

  private async logoutConnection(source?: ConnectionSession): Promise<string> {
    if (this.busy) throw new Error('AUTH_BUSY');
    this.busy = true;
    try {
      const result = await logoutCurrentConnection(this.context, this.activeOrigin, (origin: string, revision: string) => {
        this.cleanupOrigin = origin; this.cleanupRevision = revision;
        this.hasToken = false; this.signedOut = true;
        this.controller.runJavaScript('window.dispatchEvent(new CustomEvent("send-to-myself:host-logout",{detail:' + JSON.stringify({ serverOrigin: origin }) + '}))').catch(() => {});
      }, source?.revision);
      this.logoutNotice = '已退出当前连接，待发送内容和本机文件已保留。服务端设备令牌未自动撤销。';
      if (result.transferStop === 'unconfirmed') this.logoutNotice += ' 部分在途传输尚未确认停止，请在传输任务中查看。';
      this.cookieCleanupNeeded = !result.cookieCleared;

      if (result.remoteSessionLogout === 'unconfirmed') this.logoutNotice += ' 未能确认NAS上的网页会话已注销。';
      return JSON.stringify(result);
    } finally { this.busy = false; }
  }

  async aboutToAppear(): Promise<void> {
    registerHostReauthentication(this.hostReauthentication);
    registerHostConnectionSettings(this.hostConnectionSettings);
    try {
      const connection = await readConnection(this.context);
      if (connection) { this.serverUrl = connection.origin; this.activeOrigin = connection.origin; }
      this.hasToken = !!connection?.deviceToken;
      if (connection?.deviceToken) {
        const snapshot = await requireConnection(this.context);
        const valid = await checkTokenValid(this.context, snapshot);
        if (valid === false) await clearTokenIfCurrent(this.context, snapshot.origin, snapshot.revision);
        const current = await readConnection(this.context);
        if (current?.revision === snapshot.revision && valid !== false) {
          this.useFreshEntry = valid === true; this.phase = 'web';
        } else if (current && current.revision !== snapshot.revision && current.deviceToken) {
          this.activeOrigin = current.origin; this.serverUrl = current.origin; this.hasToken = true;
          this.useFreshEntry = false; this.phase = 'web';
        } else { this.hasToken = !!current?.deviceToken; this.phase = 'login'; }
      } else {
        if (connection) {
          try {
            this.cleanupOrigin = connection.origin; this.cleanupRevision = connection.revision;
            await clearSignedOutCookie(this.context, connection.origin, connection.revision);
            this.cookieCleanupNeeded = false;
          } catch (_error) { this.cookieCleanupNeeded = true; this.errorMsg = '网页会话清理未完成，请重试'; }
        }
        this.phase = 'login';
      }
    } catch (_error) { this.errorMsg = '暂时无法读取本机连接，请重试'; this.phase = 'login'; }
    startNetMonitor(this.context, () => { this.loadQueueStatus(); });
    this.retryQueue();
  }

  onForegroundChange(): void {
    if (this.appForeground && this.phase === 'web') this.notifyTransferUpdate();
  }
  onPageShow(): void {
    this.retryQueue();
    this.notifyTransferUpdate();
  }
  private notifyTransferUpdate(): void {
    try { this.controller.runJavaScript('window.dispatchEvent(new Event("send-to-myself:transfer-updated"))').catch(() => {}); }
    catch (_error) { /* Web may not be attached when the page becomes visible. */ }
  }

  async loadQueueStatus(): Promise<void> {
    try {
      let status = await queueStatus(this.context);
      this.pendingCount = status.count;
      this.queueError = status.error;
    } catch (_error) { this.queueError = '无法读取本地队列，请勿清理应用数据'; }
  }
  async retryQueue(): Promise<void> {
    if (this.queueBusy) return;
    this.queueBusy = true;
    try { await processQueue(this.context); }
    catch (_error) { this.queueError = '补发失败，内容已保留'; }
    finally { this.queueBusy = false; await this.loadQueueStatus(); }
    if (this.pendingCount > 0 && !(await readConnection(this.context))?.deviceToken) {
      this.errorMsg = '请重新登录，待发送内容已保留';
    }
  }

  aboutToDisappear(): void {
    unregisterHostReauthentication(this.hostReauthentication);
    unregisterHostConnectionSettings(this.hostConnectionSettings);
    stopNetMonitor();
  }

  onBackPress(): boolean {
    if (this.authOverlay) { if (!this.authSubmitting) this.cancelReauthenticate(); return true; }
    if (this.connectionSettings) { if (!this.busy) this.cancelConnectionSettings(); return true; }
    if (this.signedOut || this.busy) return true;
    if (this.phase === 'web' && this.controller.accessBackward()) {
      this.controller.backward();
      return true;
    }
    return false;
  }

  private mapError(code: string | undefined): string {
    switch (code) {
      case 'Invalid credentials':
        return '口令不正确';
      case 'Too many attempts':
        return '尝试过多，已临时锁定，请稍后再试';
      case 'Network error':
      case 'Network error during token minting':
        return '连接不上服务器，请检查地址与网络';
      case 'Server error':
      case 'Failed to mint device token':
        return '服务器暂时无法完成登录，请检查服务后重试';
      case 'Invalid response':
        return '服务器返回的数据无效，请检查地址和服务版本后重试';
      case 'No session cookie received':
        return '服务器未下发会话（HTTP 直连请关闭 SECURE_COOKIE）';
      default:
        return '登录失败，请检查服务器后重试';
    }
  }

  async doLogin(): Promise<void> {
    if (this.busy) {
      return;
    }
    if (!this.serverUrl) {
      this.errorMsg = '请先填写服务器地址';
      return;
    }
    if (!this.password) {
      this.errorMsg = '请输入登录口令';
      return;
    }
    this.busy = true;
    this.errorMsg = '';
    try {
      let candidate: string;
      try { candidate = normalizeOrigin(this.serverUrl); this.serverUrl = candidate; }
      catch (_error) { this.errorMsg = '服务器地址无效'; return; }
      const result = await loginAndMintToken(this.context, candidate, this.password, '鸿蒙手机', undefined, this.connectionSettings ? this.settingsRevision : undefined, this.connectionSettings ? this.settingsOrigin : undefined);
      if (!result.success) { this.errorMsg = this.mapError(result.errorMessage); return; }
      if (!result.connection || !result.webSetCookie) { this.errorMsg = '网页会话未建立'; return; }
      // A successful commit replaces the previous connection, so keep its old WebView covered.
      const switching = this.connectionSettings && this.phase === 'web';
      if (switching) { this.phase = 'login'; await new Promise<void>((resolve) => { setTimeout(resolve, 0); }); }
      this.connectionSettings = false; this.signedOut = false;
      this.activeOrigin = result.connection.origin; this.serverUrl = result.connection.origin;
      this.hasToken = !!result.connection.deviceToken; this.webCookieBlocked = true;
      let current: ConnectionSession | null;
      try { current = await readConnection(this.context); }
      catch (_error) { this.errorMsg = '连接已保存，暂时无法读取本机连接，请重试恢复网页会话'; return; }
      if (!current || current.origin !== result.connection.origin || current.revision !== result.connection.revision || !current.deviceToken) {
        this.hasToken = false; this.errorMsg = '连接已改变，请重试'; return;
      }
      this.activeOrigin = current.origin;
      this.serverUrl = current.origin;
      this.hasToken = true;
      this.connectionSettings = false; this.signedOut = false; this.cookieCleanupNeeded = false;
      try { await installSessionCookie(this.context, current.origin, current.revision, result.webSetCookie); this.webCookieBlocked = false; }
      catch (_error) { this.phase = 'login'; this.webCookieBlocked = true; this.errorMsg = '网页会话未建立，请检查Cookie配置并重试'; return; }
      const afterCookie = await readConnection(this.context);
      if (!afterCookie || afterCookie.origin !== current.origin || afterCookie.revision !== current.revision || !afterCookie.deviceToken) {
        this.hasToken = false; this.errorMsg = '连接已改变，请重试'; return;
      }
      this.useFreshEntry = true;
      this.password = '';
      this.phase = 'web';
      startNetMonitor(this.context, () => { this.loadQueueStatus(); });
      this.retryQueue();
    } catch (_error) {
      if (this.connectionSettings) {
        try {
          const current = await readConnection(this.context);
          const unchanged = this.settingsRevision === '' ? current === null :
            !!current && current.origin === this.settingsOrigin && current.revision === this.settingsRevision;
          if (unchanged) {
            this.errorMsg = '连接未更改，请检查服务器后重试或取消';
            return;
          }
          // A different generation may already be committed; never reveal the old WebView.
          this.phase = 'login'; this.connectionSettings = false; this.signedOut = false;
          if (current) {
            this.activeOrigin = current.origin; this.serverUrl = current.origin;
            this.hasToken = !!current.deviceToken; this.webCookieBlocked = !!current.deviceToken;
            this.errorMsg = '连接已改变，请恢复当前网页会话';
          } else { this.hasToken = false; this.errorMsg = '连接已改变，请重新连接'; }
        } catch (_readError) {
          this.phase = 'login'; this.connectionSettings = false; this.signedOut = false;
          this.hasToken = false; this.errorMsg = '无法确认当前连接，请重试';
        }
      } else {
        this.hasToken = false; this.errorMsg = '无法完成登录或读取本机连接，请重试';
      }
      hilog.error(DOMAIN, TAG, 'Login or credential storage failed');
    } finally { this.busy = false; }
  }

  private entryUrl(): string {
    if (!this.useFreshEntry) return this.activeOrigin;
    const parts = this.activeOrigin.split('#');
    const separator = parts[0].includes('?') ? '&' : '?';
    return parts[0] + separator + '_appLoad=' + this.pageRevision.toString() +
      (parts.length > 1 ? '#' + parts.slice(1).join('#') : '');
  }

  build() {
    Stack() {
      if (this.phase === 'web' && this.activeOrigin.length > 0) {
        Column() {
          Refresh({ refreshing: $$this.refreshing }) {
            Web({ src: this.entryUrl(), controller: this.controller })
              .nestedScroll({ scrollForward: NestedScrollMode.SELF_FIRST, scrollBackward: NestedScrollMode.SELF_FIRST })
              .onControllerAttached(() => {
                try {
                  this.controller.registerJavaScriptProxy(this.nativeBridge, 'stmNative', [],
                    ['shareAttachment', 'saveAttachment', 'openTools', 'openTransfers', 'openUpload', 'getUploadReceipt', 'reauthenticate', 'logout'], bridgePermission(this.activeOrigin));
                } catch (_error) { promptAction.showToast({ message: '原生分享入口暂不可用，请重新打开应用' }); }
              })
              .onContextMenuShow((event) => {
                if (!event || event.param.getMediaType() !== ContextMenuMediaType.Image) return false;
                const source = event.param.getSourceUrl();
                const pageOrigin = this.activeOrigin;
                const prefix = this.activeOrigin.replace(/\/$/, '') + '/api/attachments/';
                if (!source.startsWith(prefix)) return false;
                const originalImage = /\/raw(\?.*)?$/.test(source);
                const match = source.substring(prefix.length).match(/^([a-zA-Z0-9_-]{1,128})\/(?:raw|thumb)(?:\?.*)?$/);
                if (!match) return false;
                const sourceConnection = readConnection(this.context).catch((): ConnectionSession | null => null);
                const actions: SheetInfo[] = [];
                if (originalImage) {
                  actions.push({ title: '复制图片', action: () => {
                    try { event.result.copyImage(); }
                    finally { event.result.closeContextMenu(); }
                  } });
                }
                actions.push({ title: '保存原图', action: () => {
                  event.result.closeContextMenu();
                  sourceConnection.then(async (connection: ConnectionSession | null) => {
                    if (!connection || connection.origin !== pageOrigin || this.activeOrigin !== pageOrigin ||
                      new url.URL(this.controller.getUrl()).origin !== pageOrigin || AppStorage.get<boolean>('appForeground') === false) throw new Error('CONNECTION_CHANGED');
                    const id = await requestAttachmentAction(this.context, match[1], 'save', connection);
                    await assertCurrentConnection(this.context, connection);
                    if (this.activeOrigin !== pageOrigin || new url.URL(this.controller.getUrl()).origin !== pageOrigin || AppStorage.get<boolean>('appForeground') === false) throw new Error('CONNECTION_CHANGED');
                    await this.getUIContext().getRouter().pushUrl({ url: 'pages/TransfersPage', params: { downloadId: id, action: 'save', sourceOrigin: connection.origin, sourceRevision: connection.revision } });
                  }).catch(() => { promptAction.showToast({ message: '无法准备附件，请检查连接或升级核心' }); });
                } });
                this.getUIContext().showActionSheet({
                  title: '图片',
                  message: originalImage ? '复制到其他应用，或保存到文件夹' : '保存原始图片到文件夹',
                  sheets: actions,
                  cancel: () => { event.result.closeContextMenu(); }
                });
                return true;
              })
              .domStorageAccess(true)
              .onlineImageAccess(true)
              .javaScriptAccess(true)
              .mixedMode(MixedMode.All)
              .mediaPlayGestureAccess(false)
              .width('100%')
              .height('100%')
              .onLoadIntercept((event) => {
                if (event) {
                  hilog.info(DOMAIN, TAG, 'Web onLoadIntercept: %{public}s', event.data.getRequestUrl());
                }
                return false;
              })
              .onPageBegin((event) => {
                if (event) {
                  hilog.info(DOMAIN, TAG, 'Web onPageBegin: %{public}s', event.url);
                }
              })
              .onPageEnd((event) => {
                this.refreshing = false;
                if (event) {
                  hilog.info(DOMAIN, TAG, 'Web onPageEnd: %{public}s', event.url);
                }
              })
              .onProgressChange((event) => {
                if (event) {
                  hilog.info(DOMAIN, TAG, 'Web progress: %{public}d', event.newProgress);
                }
              })
              .onSslErrorEvent((event) => {
                if (event) {
                  hilog.warn(DOMAIN, TAG, 'Web SSL error for %{public}s: %{public}s — blocked', event.url, event.error.toString());
                  event.handler.handleCancel();
                  if (this.connectionSettings || this.authOverlay || this.signedOut) return;
                  try { if (new url.URL(event.url).origin !== this.activeOrigin) return; } catch (_error) { return; }
                  this.errorMsg = '服务器证书验证失败，请检查证书与服务器地址';
                  this.phase = 'login';
                }
              })
              .onErrorReceive((event) => {
                this.refreshing = false;
                if (event && event.request.isMainFrame()) {
                  if (this.connectionSettings || this.authOverlay || this.signedOut) return;
                  try { if (new url.URL(event.request.getRequestUrl()).origin !== this.activeOrigin) return; } catch (_error) { return; }
                  let info = event.error.getErrorInfo();
                  let code = event.error.getErrorCode();
                  hilog.error(DOMAIN, TAG, 'Web main frame load failed [%{public}d]: %{public}s', code, info);
                  this.errorMsg = '页面加载失败 (' + code.toString() + ')';
                  this.phase = 'login';
                }
              })
          }
          .width('100%').layoutWeight(1)
          .onRefreshing(() => {
            this.controller.refresh();
          })
        }.width('100%').height('100%')
      } else if (this.phase === 'login' && !this.connectionSettings) {
        this.LoginView()
      } else {
        this.SplashView()
      }
      if (this.signedOut) {
        Column({ space: 12 }) {
          Text(this.logoutNotice || '正在退出当前连接…').fontColor(C_INK)
          if (this.errorMsg) { Text(this.errorMsg).fontColor(C_RED) }
          if (this.cookieCleanupNeeded) {
            Text('网页会话清理未完成').fontColor(C_RED)
            Button('重试清理网页会话').backgroundColor(CARD_HI).fontColor(C_INK).enabled(!this.busy).onClick(() => { this.retryCookieCleanup(); })
          }
          Button('重新登录当前连接').backgroundColor(C_ACCENT).fontColor(CARD_HI).enabled(!this.busy).onClick(() => {
            this.beginReauthenticate().catch(() => {});
          })
          Button('传输任务').backgroundColor(CARD_HI).fontColor(C_INK).enabled(!this.busy).onClick(() => { this.getUIContext().getRouter().pushUrl({ url: 'pages/TransfersPage' }); })
          Button('返回连接').backgroundColor(CARD_HI).fontColor(C_INK).enabled(!this.busy).onClick(() => { this.signedOut = false; this.phase = 'login'; })
        }.padding(24).backgroundColor(C_CARD).width('100%').height('100%').justifyContent(FlexAlign.Center)
      }
      if (this.connectionSettings) { this.LoginView() }
      if (this.authOverlay) {
        Stack() {
        Column({ space: 12 }) {
          Text('重新登录当前连接').fontSize(20).fontColor(C_INK)
          TextInput({ placeholder: '登录口令' }).type(InputType.Password).backgroundColor(CARD_HI).fontColor(C_INK).placeholderColor(C_INK_SOFT).enabled(!this.authSubmitting).onChange((value: string) => { this.password = value; })
          if (this.errorMsg) { Text(this.errorMsg).fontColor(C_RED) }
          Button('重新登录').backgroundColor(C_ACCENT).fontColor(CARD_HI).enabled(!this.authSubmitting).onClick(() => { this.submitReauthenticate(); })
          Button('取消').backgroundColor(CARD_HI).fontColor(C_INK).enabled(!this.authSubmitting).onClick(() => { this.cancelReauthenticate(); })
        }.padding(24).backgroundColor(C_CARD).width('90%')
        }.width('100%').height('100%').backgroundColor('#88000000')
      }
      if (this.pendingCount > 0 && this.phase === 'web' && !this.signedOut && !this.connectionSettings && !this.authOverlay) {
        Column() {
          Text(this.queueError || '待发送内容已保存在本机')
            .fontSize(12).fontColor(this.queueError ? C_RED : C_INK_SOFT)
          Button(this.queueBusy ? '补发中…' : '待发送 ' + this.pendingCount.toString() + ' 条 · 查看')
            .backgroundColor(CARD_HI).fontColor(C_INK).enabled(!this.queueBusy)
            .onClick(() => { this.getUIContext().getRouter().pushUrl({ url: 'pages/TransfersPage' }); })
        }
        .padding(12).backgroundColor(C_CARD).borderRadius(10)
        .align(Alignment.Bottom).margin({ bottom: 16 })
      }
    }
    .width('100%')
    .height('100%')
    .backgroundColor(C_PAPER)
  }

  @Builder
  SplashView() {
    Column() {
      Text('发给自己')
        .fontSize(26)
        .fontWeight(FontWeight.Bold)
        .fontColor(C_INK)
      LoadingProgress()
        .width(36)
        .height(36)
        .color(C_ACCENT)
        .margin({ top: 16 })
    }
    .width('100%')
    .height('100%')
    .justifyContent(FlexAlign.Center)
    .alignItems(HorizontalAlign.Center)
  }

  @Builder
  LoginView() {
    Column() {
      Column() {
        Text('发给自己')
          .fontSize(28)
          .fontWeight(FontWeight.Bold)
          .fontColor(C_INK)
        Text(this.connectionSettings ? '连接设置 · 输入服务器与口令' : 'SendToMyself · 请输入服务器与口令')
          .fontSize(13)
          .fontColor(C_INK_FAINT)
          .margin({ top: 8, bottom: 28 })

        TextInput({ placeholder: '服务器地址（如 http://192.168.1.2:8787）', text: this.serverUrl })
          .type(InputType.Normal)
          .enabled(!this.busy)
          .width('100%')
          .height(48)
          .backgroundColor(CARD_HI)
          .borderRadius(10)
          .borderWidth(1)
          .borderColor(C_LINE)
          .fontColor(C_INK)
          .placeholderColor(C_INK_FAINT)
          .padding({ left: 14, right: 14 })
          .onChange((value: string) => {
            this.serverUrl = value.trim();
            this.errorMsg = '';
          })
          .margin({ bottom: 14 })

        TextInput({ placeholder: '登录口令' })
          .type(InputType.Password)
          .enabled(!this.busy)
          .width('100%')
          .height(48)
          .backgroundColor(CARD_HI)
          .borderRadius(10)
          .borderWidth(1)
          .borderColor(C_LINE)
          .fontColor(C_INK)
          .placeholderColor(C_INK_FAINT)
          .padding({ left: 14, right: 14 })
          .onChange((value: string) => {
            this.password = value;
            this.errorMsg = '';
          })
          .onSubmit(() => {
            this.doLogin();
          })
          .margin({ bottom: this.errorMsg.length > 0 ? 10 : 22 })

        if (this.errorMsg.length > 0) {
          Text(this.errorMsg)
            .fontSize(13)
            .fontColor(C_RED)
            .width('100%')
            .textAlign(TextAlign.Start)
            .margin({ bottom: 16 })
        }

        Button(this.busy ? '连接中…' : '连接')
          .width('100%')
          .height(48)
          .type(ButtonType.Capsule)
          .backgroundColor(C_ACCENT)
          .fontColor(Color.White)
          .fontWeight(FontWeight.Medium)
          .enabled(!this.busy)
          .opacity(this.busy ? 0.6 : 1)
          .onClick(() => {
            this.doLogin();
          })

        if (this.connectionSettings) {
          Button('取消').backgroundColor(CARD_HI).fontColor(C_INK).width('100%').margin({ top: 12 }).enabled(!this.busy).onClick(() => { this.cancelConnectionSettings(); })
        } else {
          Button('传输任务').backgroundColor(CARD_HI).fontColor(C_INK).width('100%').margin({ top: 12 }).enabled(!this.busy).onClick(() => { this.getUIContext().getRouter().pushUrl({ url: 'pages/TransfersPage' }); })
          if (this.cookieCleanupNeeded) {
            Button('重试清理网页会话').backgroundColor(CARD_HI).fontColor(C_INK).width('100%').enabled(!this.busy).onClick(() => { this.retryCookieCleanup(); })
          }
        }

        if (this.hasToken && !this.connectionSettings) {
          if (this.webCookieBlocked) {
            Button('恢复网页会话').backgroundColor(CARD_HI).fontColor(C_INK).enabled(!this.busy).onClick(() => {
              this.beginReauthenticate().then((value: string) => {
                if (value.includes('authenticated')) { this.webCookieBlocked = false; this.phase = 'web'; }
              }).catch(() => { this.errorMsg = '网页会话恢复失败，请重试'; });
            })
          }
          Button('用已保存的令牌进入')
            .width('100%')
            .height(44)
            .type(ButtonType.Capsule)
            .backgroundColor(Color.Transparent)
            .fontColor(C_INK_SOFT)
            .borderWidth(1)
            .borderColor(C_LINE)
            .margin({ top: 12 })
            .enabled(!this.busy && !this.webCookieBlocked)
            .onClick(async () => {
              try {
                const current = await readConnection(this.context);
                if (!current?.deviceToken) { this.hasToken = false; this.errorMsg = '请重新登录'; return; }
                this.activeOrigin = current.origin; this.serverUrl = current.origin;
                this.hasToken = true; this.errorMsg = ''; this.phase = 'web';
              } catch (_error) { this.hasToken = false; this.errorMsg = '暂时无法读取本机连接，请重试'; }
            })

          Text('退出当前连接')
            .fontSize(13)
            .fontColor(C_INK_FAINT)
            .decoration({ type: TextDecorationType.Underline, color: C_INK_FAINT })
            .margin({ top: 14 })
            .onClick(async () => {
              try { await this.logoutConnection(); this.errorMsg = '已退出当前连接，待发送内容和本机文件已保留。服务端设备令牌未自动撤销。'; }
              catch (_error) { this.errorMsg = '无法退出当前连接，请重试'; }
            })
        }
      }
      .width('86%')
      .padding(24)
      .backgroundColor(C_CARD)
      .borderRadius(16)
      .borderWidth(1)
      .borderColor(C_LINE)
      .shadow({ radius: 22, color: '#22442d14', offsetX: 0, offsetY: 6 })
    }
    .width('100%')
    .height('100%')
    .justifyContent(FlexAlign.Center)
    .alignItems(HorizontalAlign.Center)
    .padding({ left: 20, right: 20 })
    .backgroundColor(C_PAPER)
  }
}
