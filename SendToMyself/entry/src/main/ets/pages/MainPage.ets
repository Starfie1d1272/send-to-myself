import { webview } from '@kit.ArkWeb';
import { loadServerUrl, loadDeviceToken } from '../common/AssetStore';
import { isConfigured, checkTokenValid, loginAndMintToken } from '../common/AuthService';
import { startNetMonitor, stopNetMonitor } from '../common/NetMonitor';
import { processQueue } from '../common/QueueService';
import { hilog } from '@kit.PerformanceAnalysisKit';
import { DOMAIN, TAG } from '../common/Constants';
import { common } from '@kit.AbilityKit';

@Entry
@Component
struct MainPage {
  controller: webview.WebviewController = new webview.WebviewController();
  @State serverUrl: string = '';
  @State hasToken: boolean = false;
  @State showLogin: boolean = false;
  @State password: string = '';
  private context: common.UIAbilityContext = getContext(this) as common.UIAbilityContext;

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
        this.showLogin = false;
      } else {
        this.hasToken = false;
        this.showLogin = true;
      }
    } else {
      this.showLogin = true;
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
    if (this.controller.accessBackward()) {
      this.controller.backward();
      return true;
    }
    return false;
  }

  build() {
    Stack() {
      if (this.showLogin) {
        this.LoginView()
      } else {
        Web({ src: this.serverUrl, controller: this.controller })
          .domStorageAccess(true)
          .onlineImageAccess(true)
          .javaScriptAccess(true)
          .width('100%')
          .height('100%')
      }
    }
    .width('100%')
    .height('100%')
  }

  @Builder
  LoginView() {
    Column() {
      Text('SendToMyself')
        .fontSize(28)
        .fontWeight(FontWeight.Bold)
        .margin({ bottom: 40 })

      TextInput({ placeholder: 'Server URL (e.g. https://stm.example.com)', text: this.serverUrl })
        .type(InputType.Normal)
        .width('80%')
        .height(48)
        .onChange((value: string) => {
          this.serverUrl = value.trim();
        })
        .margin({ bottom: 16 })

      TextInput({ placeholder: 'Password' })
        .type(InputType.Password)
        .width('80%')
        .height(48)
        .onChange((value: string) => {
          this.password = value;
        })
        .margin({ bottom: 24 })

      Button('Login')
        .width('80%')
        .height(48)
        .type(ButtonType.Capsule)
        .onClick(async () => {
          hilog.info(DOMAIN, TAG, 'Login clicked, url=%{public}s', this.serverUrl);
          let result = await loginAndMintToken(this.serverUrl, this.password, 'HarmonyOS Device');
          if (result.success) {
            this.hasToken = true;
            this.showLogin = false;
            startNetMonitor(this.context);
            processQueue(this.context).catch(() => {});
          } else {
            hilog.error(DOMAIN, TAG, 'Login failed: %{public}s', result.errorMessage ?? 'unknown');
          }
        })

      if (this.hasToken) {
        Button('Skip Login (use saved token)')
          .width('80%')
          .height(40)
          .type(ButtonType.Capsule)
          .backgroundColor(Color.Gray)
          .margin({ top: 12 })
          .onClick(() => {
            this.showLogin = false;
          })
      }
    }
    .width('100%')
    .height('100%')
    .justifyContent(FlexAlign.Center)
    .alignItems(HorizontalAlign.Center)
    .padding({ left: 20, right: 20 })
  }
}
