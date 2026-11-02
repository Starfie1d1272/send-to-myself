import { common, UIExtensionContentSession } from '@kit.AbilityKit';

@Entry
@Component
struct SharePage {
  @State statusText: string = '发送中…';
  @LocalStorageLink('shareResult') @Watch('onResultChange') result: string = '';
  @LocalStorageLink('shareError') @Watch('onErrorChange') error: string = '';
  @LocalStorageLink('shareMessage') message: string = '';
  @State statusColor: ResourceColor = Color.Gray;
  @State opening: boolean = false;
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

  }

  handleResult(result: string): void {
    if (result === 'success') {
      this.statusText = '已发送';
      this.statusColor = Color.Green;
      this.autoClose(800);
    } else if (result === 'queued') {
      this.statusText = this.message || '已保存在本机，打开应用或恢复网络后重试';
      this.statusColor = Color.Orange;

    } else if (result === 'needsLogin') {
      this.statusText = '请先在应用内登录';
      this.statusColor = Color.Red;

    } else {
      this.statusText = this.message || '发送失败';
      this.statusColor = Color.Red;

    }
  }

  private async openApp(): Promise<void> {
    if (this.opening) return;
    this.opening = true;
    try {
      const context = getContext(this) as common.UIExtensionContext;
      await context.startAbility({ bundleName: 'com.sendtomyself.harmony', abilityName: 'EntryAbility' });
      if (this.session) await this.session.terminateSelf();
    } catch (_error) {
      this.statusText = '暂时无法打开应用，请手动打开后查看传输任务';
      this.statusColor = Color.Red;
    } finally { this.opening = false; }
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
      if ((this.result || this.error) && this.result !== 'success') {
        Button('打开应用处理').enabled(!this.opening).onClick(() => { this.openApp(); })
        Button('关闭').onClick(() => { if (this.session) this.session.terminateSelf(); })
      }
    }
    .width('100%')
    .height('100%')
    .justifyContent(FlexAlign.Center)
    .alignItems(HorizontalAlign.Center)
    .backgroundColor(Color.White)
  }
}
