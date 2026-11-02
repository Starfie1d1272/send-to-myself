import { webview } from '@kit.ArkWeb';
import { readConnection, requireConnection, clearTokenIfCurrent, normalizeOrigin, AuthenticatedConnection, ConnectionSession } from '../common/ConnectionSession';
import { checkTokenValid, loginAndMintToken, logoutCurrentConnection } from '../common/AuthService';
import { startNetMonitor, stopNetMonitor } from '../common/NetMonitor';
import { processQueue, queueStatus } from '../common/QueueService';
import { hilog } from '@kit.PerformanceAnalysisKit';
import { DOMAIN, TAG } from '../common/Constants';
import { common } from '@kit.AbilityKit';
import { WebDownloads } from '../common/WebDownloads';
import { promptAction } from '@kit.ArkUI';
import { NativeBridge, bridgePermission } from '../common/NativeBridge';

// 与 Web 端 (apps/web/src/styles/global.css) 共用的设计语言
const C_PAPER = '#f2ece1';
const C_CARD = '#fbf7ef';
const C_INK = '#241d16';
const C_INK_SOFT = '#5b5044';
const C_INK_FAINT = '#938573';
const C_LINE = '#d3c4ab';
const C_ACCENT = '#bc4b2a';
const C_RED = '#a8331e';

type Phase = 'loading' | 'login' | 'web';

@Entry
@Component
struct MainPage {
  controller: webview.WebviewController = new webview.WebviewController();
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
  private authResolve?: (value: string) => void;
  private authReject?: (reason: Error) => void;
  private authOrigin: string = '';
  private authRevision: string = '';
  private pageRevision: number = Date.now();
  private useFreshEntry: boolean = false;
  private context: common.UIAbilityContext = getContext(this) as common.UIAbilityContext;
  private downloads: WebDownloads = new WebDownloads(this.context);
  private nativeBridge: NativeBridge = new NativeBridge(this.context, this.controller, async (id: string, action: string) => {
    await this.getUIContext().getRouter().pushUrl({ url: 'pages/TransfersPage', params: { downloadId: id, action: action } });
  }, () => {
    this.getUIContext().showActionSheet({
      title: '文件与传输', message: '',
      sheets: [
        { title: '发送文件', action: () => { this.getUIContext().getRouter().pushUrl({ url: 'pages/UploadPage' }); } },
        { title: this.pendingCount > 0 ? '传输记录 · ' + this.pendingCount.toString() + ' 条待发送' : '传输记录',
          action: () => { this.getUIContext().getRouter().pushUrl({ url: 'pages/TransfersPage' }); } }
      ]
    });
  }, () => this.beginReauthenticate(), () => this.logoutConnection());

  private async beginReauthenticate(): Promise<string> {
    if (this.busy) throw new Error('AUTH_BUSY');
    this.busy = true;
    try {
      const current = await readConnection(this.context);
      if (!current || current.origin !== this.activeOrigin) throw new Error('CONNECTION_CHANGED');
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
      if (current.deviceToken) snapshot = await requireConnection(this.context);
      const result = await loginAndMintToken(this.context, origin, password, '鸿蒙手机', snapshot, revision);
      if (!result.success || !result.connection || !result.webSetCookie) throw new Error(result.errorMessage === 'Network error' ? 'NETWORK_UNAVAILABLE' : 'AUTH_FAILED');
      const after = await readConnection(this.context);
      if (!after || after.origin !== origin || after.revision !== result.connection.revision) throw new Error('CONNECTION_CHANGED');
      await this.injectCookieToWeb(result.webSetCookie, origin);
      const resolve = this.authResolve;
      this.authResolve = undefined; this.authReject = undefined; this.password = ''; this.busy = false; this.authOverlay = false; this.authSubmitting = false;
      if (resolve) resolve(JSON.stringify({ status: 'authenticated', serverOrigin: origin, revision: after.revision }));
    } catch (error) {
      const reject = this.authReject;
      this.authResolve = undefined; this.authReject = undefined; this.password = ''; this.busy = false; this.authOverlay = false; this.authSubmitting = false;
      if (reject) { const code = (error as Error).message; reject(new Error(['CONNECTION_CHANGED', 'NETWORK_UNAVAILABLE', 'LOCAL_STORAGE_FAILED'].includes(code) ? code : 'AUTH_FAILED')); }
    }
  }
  private async logoutConnection(): Promise<string> {
    if (this.busy) throw new Error('AUTH_BUSY');
    this.busy = true;
    try {
      const result = await logoutCurrentConnection(this.context, this.activeOrigin, (origin: string) => {
        this.hasToken = false; this.signedOut = true;
        this.controller.runJavaScript('window.dispatchEvent(new CustomEvent("send-to-myself:host-logout",{detail:' + JSON.stringify({ serverOrigin: origin }) + '}))').catch(() => {});
      });
      this.logoutNotice = '已退出当前连接，待发送内容和本机文件已保留。服务端设备令牌未自动撤销。';
      if (result.transferStop === 'unconfirmed') this.logoutNotice += ' 部分在途传输尚未确认停止，请在传输任务中查看。';
      if (!result.cookieCleared) this.logoutNotice += ' 网页会话清理未完成，请重试清理。';
      if (result.remoteSessionLogout === 'unconfirmed') this.logoutNotice += ' 未能确认NAS上的网页会话已注销。';
      return JSON.stringify(result);
    } finally { this.busy = false; }
  }

  private async injectCookieToWeb(cookie: string, origin: string): Promise<void> {
    if (origin.startsWith('http://') && /(?:^|;)\s*secure(?:;|$)/i.test(cookie)) {
      throw new Error('HTTP连接不能使用Secure Cookie，请检查服务器配置');
    }
    webview.WebCookieManager.configCookieSync(origin, cookie, false, true);
    await webview.WebCookieManager.saveCookieAsync();
  }

  async aboutToAppear(): Promise<void> {
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
            const expired = 'stm_session=; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; SameSite=Lax' + (connection.origin.startsWith('https://') ? '; Secure' : '');
            const current = await readConnection(this.context);
            if (current && current.revision === connection.revision && current.origin === connection.origin) {
              webview.WebCookieManager.configCookieSync(connection.origin, expired, false, true);
              await webview.WebCookieManager.saveCookieAsync();
            }
          } catch (_error) { this.errorMsg = '网页会话清理未完成，请重试'; }
        }
        this.phase = 'login';
      }
    } catch (_error) { this.errorMsg = '暂时无法读取本机连接，请重试'; this.phase = 'login'; }
    startNetMonitor(this.context, () => { this.loadQueueStatus(); });
    this.retryQueue();
  }

  onPageShow(): void { this.retryQueue(); }

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
    stopNetMonitor();
  }

  onBackPress(): boolean {
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
      case 'No session cookie received':
        return '服务器未下发会话（HTTP 直连请关闭 SECURE_COOKIE）';
      default:
        return code ?? '登录失败';
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
      const result = await loginAndMintToken(this.context, candidate, this.password, '鸿蒙手机');
      if (!result.success) { this.errorMsg = this.mapError(result.errorMessage); return; }
      if (!result.connection || !result.webSetCookie) { this.errorMsg = '网页会话未建立'; return; }
      let current: ConnectionSession | null;
      try { current = await readConnection(this.context); }
      catch (_error) { this.hasToken = false; this.errorMsg = '暂时无法读取本机连接，请重试'; return; }
      if (!current || current.origin !== result.connection.origin || current.revision !== result.connection.revision || !current.deviceToken) {
        this.hasToken = false; this.errorMsg = '连接已改变，请重试'; return;
      }
      this.activeOrigin = current.origin;
      this.serverUrl = current.origin;
      this.hasToken = true;
      try { await this.injectCookieToWeb(result.webSetCookie, current.origin); this.webCookieBlocked = false; }
      catch (_error) { this.webCookieBlocked = true; this.errorMsg = '网页会话未建立，请检查Cookie配置并重试'; return; }
      this.useFreshEntry = true;
      this.password = '';
      this.phase = 'web';
      startNetMonitor(this.context, () => { this.loadQueueStatus(); });
      this.retryQueue();
    } catch (_error) {
      this.hasToken = false; this.errorMsg = '无法完成登录或读取本机连接，请重试';
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
                this.downloads.attach(this.controller);
                try {
                  this.controller.registerJavaScriptProxy(this.nativeBridge, 'stmNative', [],
                    ['shareAttachment', 'saveAttachment', 'openTools', 'reauthenticate', 'logout'], bridgePermission(this.activeOrigin));
                } catch (_error) { promptAction.showToast({ message: '原生分享入口暂不可用，请重新打开应用' }); }
              })
              .onContextMenuShow((event) => {
                if (!event || event.param.getMediaType() !== ContextMenuMediaType.Image) return false;
                const source = event.param.getSourceUrl();
                const prefix = this.activeOrigin.replace(/\/$/, '') + '/api/attachments/';
                if (!source.startsWith(prefix)) return false;
                const originalImage = /\/raw(\?.*)?$/.test(source);
                const downloadUrl = source.replace(/\/(thumb|raw)(\?.*)?$/, '/raw?download=1');
                const actions: SheetInfo[] = [];
                if (originalImage) {
                  actions.push({ title: '复制图片', action: () => {
                    try { event.result.copyImage(); }
                    finally { event.result.closeContextMenu(); }
                  } });
                }
                actions.push({ title: '保存原图', action: () => {
                  try {
                    this.controller.startDownload(downloadUrl);
                  } catch (_error) {
                    promptAction.showToast({ message: '无法开始下载，请重试' });
                  } finally { event.result.closeContextMenu(); }
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
                  this.errorMsg = '服务器证书验证失败，请检查证书与服务器地址';
                  this.phase = 'login';
                }
              })
              .onErrorReceive((event) => {
                this.refreshing = false;
                if (event && event.request.isMainFrame()) {
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
      } else if (this.phase === 'login') {
        this.LoginView()
      } else {
        this.SplashView()
      }
      if (this.authOverlay) {
        Column({ space: 12 }) {
          Text('重新登录当前连接').fontSize(20)
          TextInput({ placeholder: '登录口令' }).type(InputType.Password).enabled(!this.authSubmitting).onChange((value: string) => { this.password = value; })
          Button('重新登录').enabled(!this.authSubmitting).onClick(() => { this.submitReauthenticate(); })
          Button('取消').enabled(!this.authSubmitting).onClick(() => { this.cancelReauthenticate(); })
        }.padding(24).backgroundColor(C_CARD).width('90%')
      }
      if (this.signedOut) {
        Column({ space: 12 }) {
          Text(this.logoutNotice || '正在退出当前连接…')
          Button('返回连接').onClick(() => { this.signedOut = false; this.phase = 'login'; })
        }.padding(24).backgroundColor(C_CARD).width('100%').height('100%').justifyContent(FlexAlign.Center)
      }
      if (this.pendingCount > 0 && this.phase === 'web' && !this.signedOut) {
        Column() {
          Text(this.queueError || '待发送内容已保存在本机')
            .fontSize(12).fontColor(C_RED)
          Button(this.queueBusy ? '补发中…' : '待发送 ' + this.pendingCount.toString() + ' 条 · 查看')
            .enabled(!this.queueBusy)
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
        Text('SendToMyself · 请输入服务器与口令')
          .fontSize(13)
          .fontColor(C_INK_FAINT)
          .margin({ top: 8, bottom: 28 })

        TextInput({ placeholder: '服务器地址（如 http://192.168.1.2:8787）', text: this.serverUrl })
          .type(InputType.Normal)
          .enabled(!this.busy)
          .width('100%')
          .height(48)
          .backgroundColor(Color.White)
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
          .backgroundColor(Color.White)
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

        if (this.hasToken) {
          if (this.webCookieBlocked) {
            Button('恢复网页会话').enabled(!this.busy).onClick(() => {
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
  }
}
