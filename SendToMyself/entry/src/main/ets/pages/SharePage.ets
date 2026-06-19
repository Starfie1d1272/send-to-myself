import { UIExtensionContentSession } from '@kit.AbilityKit';

@Entry
@Component
struct SharePage {
  @State statusText: string = 'Saving...';
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
          this.statusText = 'Failed: ' + errMsg;
          this.statusColor = Color.Red;
          this.autoClose(3000);
        }
      }
    }
  }

  handleResult(result: string): void {
    if (result === 'success') {
      this.statusText = 'Saved!';
      this.statusColor = Color.Green;
      this.autoClose(800);
    } else if (result === 'queued') {
      this.statusText = 'Queued - will send when online';
      this.statusColor = Color.Orange;
      this.autoClose(1500);
    } else if (result === 'needsLogin') {
      this.statusText = 'Please login first';
      this.statusColor = Color.Red;
      this.autoClose(2000);
    } else {
      this.statusText = 'Failed';
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
