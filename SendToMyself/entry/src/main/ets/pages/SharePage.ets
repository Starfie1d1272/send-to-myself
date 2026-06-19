import { UIExtensionContentSession } from '@kit.AbilityKit';

@Entry
@Component
struct SharePage {
  @State statusText: string = '发送中…';
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
    let storage2 = this.getUIContext().getSharedLocalStorage();
    if (storage2) {
      let result = storage2.get<string>('shareResult');
      if (result && result.length > 0) {
        this.handleResult(result);
      } else {
        let errMsg = storage2.get<string>('shareError');
        if (errMsg && errMsg.length > 0) {
          this.statusText = '失败：' + errMsg;
          this.statusColor = Color.Red;
          this.autoClose(3000);
        }
      }
    }
  }

  handleResult(result: string): void {
    if (result === 'success') {
      this.statusText = '已发送';
      this.statusColor = Color.Green;
      this.autoClose(800);
    } else if (result === 'queued') {
      this.statusText = '已加入队列，联网后自动发送';
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
