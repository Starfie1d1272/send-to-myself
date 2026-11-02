import { PAPER, CARD_HI, INK, INK_SOFT, ACCENT, SPACE } from '../common/Theme';
import { common } from '@kit.AbilityKit';
import { fileIo, picker } from '@kit.CoreFileKit';
import { copySharedFileAsync, SharedFileData } from '../common/ShareFiles';
import { currentHandoff, UploadHandoff } from '../common/UploadHandoff';
import { assertCurrentConnection, authenticatedSnapshot } from '../common/ConnectionSession';
import { getJson } from '../common/HttpClient';

interface Limits { maxUploadBytes: number; maxUploadTotalBytes: number; maxUploadFiles: number }
@Entry
@Component
struct UploadPage {
  @State files: SharedFileData[] = [];
  @State busy: boolean = false;
  @State status: string = '';
  @State cancelled: boolean = false;
  @State expanded: boolean = false;
  private handoff?: UploadHandoff;
  private visible: boolean = false;
  private context: common.UIAbilityContext = getContext(this) as common.UIAbilityContext;
  aboutToAppear(): void { this.visible = true; this.handoff = currentHandoff(); if (this.handoff) this.select(); else this.getUIContext().getRouter().back(); }
  aboutToDisappear(): void { this.visible = false; this.handoff?.cancel(); }
  onBackPress(): boolean { if (this.busy) { if (!this.handoff?.writing) { this.cancelled = true; this.handoff?.cancel(); } return true; } return false; }
  private async select(): Promise<void> {
    const handoff = this.handoff; if (!handoff || this.busy) return;
    this.busy = true; this.cancelled = false;
    try {
      const uris = await new picker.DocumentViewPicker(this.context).select({ maxSelectNumber: 20 - handoff.files.length });
      if (!handoff.canPrepare()) { if (this.visible) this.getUIContext().getRouter().back(); return; }
      if (this.cancelled) { handoff.cancel(); this.getUIContext().getRouter().back(); return; }
      if (!uris.length && handoff.files.length === 0) { handoff.finish('cancelled'); this.getUIContext().getRouter().back(); return; }
      for (let i = 0; i < uris.length; i++) {
        this.status = '正在准备 ' + (i + 1).toString() + '/' + uris.length.toString() + ' 个附件，尚未发送';
        const file = await copySharedFileAsync(this.context, uris[i], undefined, undefined, this.context.filesDir + '/web-upload-staging/' + handoff.requestId);
        if (!handoff.addPreparedFile(file)) { if (this.visible) this.getUIContext().getRouter().back(); return; }
        if (this.cancelled) { handoff.finish('cancelled'); this.getUIContext().getRouter().back(); return; }
      }
      if (!handoff.canPrepare()) return;
      this.files = [...handoff.files]; this.status = '文件限制将在发送时检查';
    } catch (_error) { if (handoff.canPrepare()) handoff.finish('not_queued', 'prepare_failed'); if (this.visible) this.getUIContext().getRouter().back(); }
    finally { this.busy = false; }
  }
  private async send(): Promise<void> {
    const handoff = this.handoff; if (!handoff || this.busy || !handoff.files.length) return;
    this.busy = true;
    try {
      await assertCurrentConnection(this.context, handoff.connection);
      if (!handoff.canPrepare()) { if (this.visible) this.getUIContext().getRouter().back(); return; }
      let limits: Limits | undefined;
      try {
        const connection = authenticatedSnapshot(handoff.connection);
        const response = await Promise.race([getJson(this.context, connection, '/api/info'), new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 4000))]);
        if (response.responseCode === 200) limits = JSON.parse(response.result as string) as Limits;
      } catch (_error) {}
      if (!handoff.canPrepare()) { if (this.visible) this.getUIContext().getRouter().back(); return; }
      await assertCurrentConnection(this.context, handoff.connection);
      if (limits) {
        const sizes = handoff.files.map((file: SharedFileData) => fileIo.statSync(file.path).size);
        if (sizes.length > limits.maxUploadFiles || sizes.some((size: number) => size > limits!.maxUploadBytes) || sizes.reduce((a: number, b: number) => a + b, 0) > limits.maxUploadTotalBytes) { this.status = '附件超过服务器限制，请调整'; return; }
      }
      if (this.cancelled) { handoff.finish('cancelled'); this.getUIContext().getRouter().back(); return; }
      await handoff.submit(this.context); if (this.visible) this.getUIContext().getRouter().back();
    } catch (_error) { if (!handoff.finished) { if (handoff.writing) handoff.finish('unknown'); else handoff.finish('not_queued', 'prepare_failed'); this.getUIContext().getRouter().back(); } }
    finally { this.busy = false; }
  }
  build() {
    Scroll() {
      Column({ space: 16 }) {
        Text('发送附件').fontSize(22).fontColor(INK)
        Text(this.handoff?.content || '（无文字）').fontColor(INK).maxLines(this.expanded ? 10000 : 8).onClick(() => { this.expanded = !this.expanded; })
        Text('需要修改文字时返回首页').fontColor(INK_SOFT)
        ForEach(this.files, (file: SharedFileData, index: number) => {
          Row() { Text(file.filename + ' · ' + fileIo.statSync(file.path).size.toString() + ' B').fontColor(INK).layoutWeight(1)
            Button('移除').backgroundColor(CARD_HI).fontColor(INK).enabled(!this.busy).onClick(() => { const handoff = this.handoff; if (!handoff) return; handoff.removePreparedFile(index); this.files = [...handoff.files]; }) }
        }, (file: SharedFileData) => file.path)
        Text(this.status).fontColor(INK_SOFT)
        Button('继续添加').backgroundColor(CARD_HI).fontColor(INK).enabled(!this.busy && this.files.length < 20).onClick(() => this.select())
        Button('发送').backgroundColor(ACCENT).fontColor(CARD_HI).enabled(!this.busy && this.files.length > 0).onClick(() => this.send())
        Button(this.busy ? '取消准备' : '返回').backgroundColor(CARD_HI).fontColor(INK).enabled(!this.handoff?.writing).onClick(() => { if (this.busy) { this.cancelled = true; this.handoff?.cancel(); } else { this.handoff?.cancel(); this.getUIContext().getRouter().back(); } })
      }.padding(SPACE).width('100%')
    }.width('100%').height('100%').backgroundColor(PAPER)
  }
}
