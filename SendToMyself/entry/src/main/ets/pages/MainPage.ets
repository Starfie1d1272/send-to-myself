import { webview } from '@kit.ArkWeb';
import { loadServerUrl, loadDeviceToken, removeDeviceToken } from '../common/AssetStore';
import { checkTokenValid, loginAndMintToken } from '../common/AuthService';
import { startNetMonitor, stopNetMonitor } from '../common/NetMonitor';
import { processQueue } from '../common/QueueService';
import { hilog } from '@kit.PerformanceAnalysisKit';
import { DOMAIN, TAG } from '../common/Constants';
import { common } from '@kit.AbilityKit';

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
  @State hasToken: boolean = false;
  @State phase: Phase = 'loading';
  @State password: string = '';
  @State busy: boolean = false;
  @State errorMsg: string = '';
  @State sessionCookie: string = '';
  private context: common.UIAbilityContext = getContext(this) as common.UIAbilityContext;

  private injectCookieToWeb(cookie: string, url: string): void {
    if (!cookie || !url) {
      return;
    }
    let cookieStr = cookie + ';path=/';
    try {
      webview.WebCookieManager.configCookieSync(url, cookieStr);
      hilog.info(DOMAIN, TAG, 'Cookie injected for %{public}s', url);
      webview.WebCookieManager.saveCookieAsync();
    } catch (err) {
      let errMsg = (err as Error).message;
      hilog.error(DOMAIN, TAG, 'Cookie inject failed: %{public}s', errMsg);
    }
  }

  async aboutToAppear(): Promise<void> {
    let url = await loadServerUrl();
    let token = await loadDeviceToken();
    this.hasToken = token !== undefined;
    if (url) {
      this.serverUrl = url;
    }
    if (url && token) {
      let valid = await checkTokenValid();
      if (valid) {
        try {
          let existing = webview.WebCookieManager.fetchCookieSync(url);
          hilog.info(DOMAIN, TAG, 'Cold start cookie check: %{public}s', existing ? 'found' : 'empty');
        } catch (_e) {
          hilog.info(DOMAIN, TAG, 'Cold start cookie check: none');
        }
        this.phase = 'web';
      } else {
        this.hasToken = false;
        this.phase = 'login';
      }
    } else {
      this.phase = 'login';
    }
    startNetMonitor(this.context);
    processQueue(this.context).catch((err: Error) => {
      hilog.error(DOMAIN, TAG, 'Initial queue processing failed: %{public}s', err.message);
    });
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
    hilog.info(DOMAIN, TAG, 'Login clicked, url=%{public}s', this.serverUrl);
    let result = await loginAndMintToken(this.serverUrl, this.password, '鸿蒙手机');
    this.busy = false;
    if (result.success) {
      this.hasToken = true;
      this.password = '';
      if (result.sessionCookie) {
        this.sessionCookie = result.sessionCookie;
        this.injectCookieToWeb(result.sessionCookie, this.serverUrl);
      }
      this.phase = 'web';
      startNetMonitor(this.context);
      processQueue(this.context).catch(() => {});
    } else {
      this.errorMsg = this.mapError(result.errorMessage);
      hilog.error(DOMAIN, TAG, 'Login failed: %{public}s', result.errorMessage ?? 'unknown');
    }
  }

  build() {
    Stack() {
      if (this.phase === 'web' && this.serverUrl.length > 0) {
        Web({ src: this.serverUrl, controller: this.controller })
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
              hilog.warn(DOMAIN, TAG, 'Web SSL error for %{public}s: %{public}s — allowing', event.url, event.error.toString());
              event.handler.handleConfirm();
            }
          })
          .onErrorReceive((event) => {
            if (event && event.request.isMainFrame()) {
              let info = event.error.getErrorInfo();
              let code = event.error.getErrorCode();
              hilog.error(DOMAIN, TAG, 'Web main frame load failed [%{public}d]: %{public}s', code, info);
              this.errorMsg = '页面加载失败 (' + code.toString() + ')';
              this.phase = 'login';
            }
          })
      } else if (this.phase === 'login') {
        this.LoginView()
      } else {
        this.SplashView()
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
          Button('用已保存的令牌进入')
            .width('100%')
            .height(44)
            .type(ButtonType.Capsule)
            .backgroundColor(Color.Transparent)
            .fontColor(C_INK_SOFT)
            .borderWidth(1)
            .borderColor(C_LINE)
            .margin({ top: 12 })
            .onClick(() => {
              this.errorMsg = '';
              this.phase = 'web';
            })

          Text('清除已保存的登录')
            .fontSize(13)
            .fontColor(C_INK_FAINT)
            .decoration({ type: TextDecorationType.Underline, color: C_INK_FAINT })
            .margin({ top: 14 })
            .onClick(async () => {
              await removeDeviceToken();
              this.hasToken = false;
              this.password = '';
              this.errorMsg = '已清除，请重新输入地址与口令';
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
