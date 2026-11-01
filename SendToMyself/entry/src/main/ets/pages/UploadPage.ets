import { common } from '@kit.AbilityKit';
import { picker } from '@kit.CoreFileKit';
import { util } from '@kit.ArkTS';
import { SharedFileData, copySharedFileAsync, cleanSharedFiles } from '../common/ShareFiles';
import { enqueue, retryQueueItem } from '../common/QueueService';

@Entry
@Component
struct UploadPage {
  @State content: string = '';
  @State busy: boolean = false;
  @State status: string = '';
  private context: common.UIAbilityContext = getContext(this) as common.UIAbilityContext;

  onBackPress(): boolean { return this.busy; }
  private async selectAndSend(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.status = '';
    const files: SharedFileData[] = [];
    let persisted = false;
    try {
      const uris = await new picker.DocumentViewPicker(this.context).select({ maxSelectNumber: 20 });
      if (uris.length === 0) return;
      for (let i = 0; i < uris.length; i++) {
        this.status = '正在保存在本机 · ' + (i + 1).toString() + '/' + uris.length.toString();
        files.push(await copySharedFileAsync(this.context, uris[i]));
      }
      const key = util.generateRandomUUID();
      await enqueue(this.context, key, 'upload', this.content.trim(), files);
      persisted = true;
      this.content = '';
      await retryQueueItem(this.context, key);
      await this.getUIContext().getRouter().replaceUrl({ url: 'pages/TransfersPage' });
    } catch (error) {
      if (!persisted) cleanSharedFiles(files);
      this.status = persisted ? '内容已保存在待发送队列，可在传输页重试' : '未加入队列：' + (error as Error).message;
    } finally { this.busy = false; }
  }
  build() {
    Column({ space: 18 }) {
      Row() {
        Button('返回').enabled(!this.busy).onClick(() => { this.getUIContext().getRouter().back(); })
        Text('后台发送文件').fontColor('#241d16').fontSize(22).margin({ left: 12 })
      }.width('100%')
      Text('添加说明后选择文件。内容保存在本机后加入传输队列，可切换到其他应用。').fontColor('#241d16').fontSize(15).width('100%')
      TextArea({ placeholder: '说明（可选）', text: this.content }).fontColor('#241d16').backgroundColor('#fbf7ef').height(160).enabled(!this.busy)
        .maxLength(20000).onChange((value: string) => { this.content = value; })
      Button(this.busy ? '准备中…' : '选择文件并发送').width('100%').enabled(!this.busy)
        .onClick(() => { this.selectAndSend(); })
      Button('查看传输与待发送').width('100%').enabled(!this.busy)
        .onClick(() => { this.getUIContext().getRouter().replaceUrl({ url: 'pages/TransfersPage' }); })
      if (this.status) { Text(this.status).fontColor('#241d16').fontSize(14).width('100%') }
      Text('后台传输仍受服务器文件大小限制。').fontColor('#241d16').fontSize(13).fontColor('#5b5044').width('100%')
    }.padding(20).width('100%').height('100%').backgroundColor('#f2ece1')
  }
}
