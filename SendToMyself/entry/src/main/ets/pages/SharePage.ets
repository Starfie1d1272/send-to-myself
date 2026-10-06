import { UIExtensionContentSession } from '@kit.AbilityKit';

@Entry
@Component
struct SharePage {
  @State statusText: string = '发送中…';
  @LocalStorageLink('shareResult') @Watch('onResultChange') result: string = '';
  @LocalStorageLink('shareError') @Watch('onErrorChange') error: string = '';
  @LocalStorageLink('shareMessage') message: string = '';
  @State statusColor: ResourceColor = Color.Gray;
  private session: UIExtensionContentSession | undefined = undefined;

  aboutToAppear(): void {
    let storage = this.getUIContext().getSharedLocalStorage();
    if (storage) {
      let sessionObj = storage.get<UIExtensionContentSession>('session');
      if (sessionObj) {
        this.session = sessionObj;
      }
    }
    if (this.result) this.handleResult(this.result);
    else if (this.error) this.onErrorChange();
  }

  onResultChange(): void { this.handleResult(this.result); }
  onErrorChange(): void {
    if (!this.error) return;
    this.statusText = '失败：' + this.error;
    this.statusColor = Color.Red;
    this.autoClose(3000);
  }

  handleResult(result: string): void {
    if (result === 'success') {
      this.statusText = '已发送';
      this.statusColor = Color.Green;
      this.autoClose(800);
    } else if (result === 'queued') {
      this.statusText = this.message || '已保存在本机，打开应用或恢复网络后重试';
      this.statusColor = Color.Orange;
      this.autoClose(1500);
    } else if (result === 'needsLogin') {
      this.statusText = '请先在应用内登录';
      this.statusColor = Color.Red;
      this.autoClose(2000);
    } else {
      this.statusText = '发送失败';
      this.statusColor = Color.Red;
      this.autoClose(2000);
    }
  }

  autoClose(delayMs: number): void {
    setTimeout(() => {
      if (this.session) {
        this.session.terminateSelf();
      }
    }, delayMs);
  }

  build() {
    Column() {
      Text(this.statusText)
        .fontSize(20)
        .fontWeight(FontWeight.Medium)
        .fontColor(this.statusColor)
    }
    .width('100%')
    .height('100%')
    .justifyContent(FlexAlign.Center)
    .alignItems(HorizontalAlign.Center)
    .backgroundColor(Color.White)
  }
}
