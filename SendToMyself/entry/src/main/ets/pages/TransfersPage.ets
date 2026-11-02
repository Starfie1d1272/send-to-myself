import { common } from '@kit.AbilityKit';
import { QueueRow, listQueue, processQueue, reconcileQueue, retryQueueItem, removeQueueItem, pauseQueueItem } from '../common/QueueService';
import { DownloadRow, listDownloads, refreshDownloads, retryDownload, removeDownload,
  shareDownload, saveDownload } from '../common/NativeDownloads';

export interface TransferPageParams { downloadId?: string; action?: string }

@Entry
@Component
struct TransfersPage {
  @State queue: QueueRow[] = [];
  @State downloads: DownloadRow[] = [];
  @State error: string = '';
  @State busyKey: string = '';
  @State expandedKey: string = '';
  private context: common.UIAbilityContext = getContext(this) as common.UIAbilityContext;
  private timer: number = -1;
  private visible: boolean = false;
  private loading: boolean = false;
  private autoOpen: TransferPageParams = {};

  aboutToAppear(): void {
    this.autoOpen = (this.getUIContext().getRouter().getParams() ?? {}) as TransferPageParams;
  }
  onPageShow(): void {
    this.visible = true;
    processQueue(this.context).then(() => { this.refresh(); }).catch(() => { this.error = '部分内容未能发送，可逐条重试'; });
    this.refresh();
    if (this.timer < 0) this.timer = setInterval(() => { this.refresh(); }, 2000);
  }
  onPageHide(): void { this.autoOpen = {}; this.stop(); }
  aboutToDisappear(): void { this.stop(); }
  private stop(): void {
    this.visible = false;
    if (this.timer >= 0) clearInterval(this.timer);
    this.timer = -1;
  }
  private async refresh(): Promise<void> {
    if (this.loading || !this.visible || AppStorage.get<boolean>('appForeground') === false) return;
    this.loading = true;
    try {
      await reconcileQueue(this.context);
      await refreshDownloads(this.context);
      const rows = await listQueue(this.context);
      const downloads = await listDownloads(this.context);
      if (!this.visible) return;
      this.queue = rows;
      this.downloads = downloads;
      if (this.autoOpen.downloadId && downloads.some((item: DownloadRow) => item.id === this.autoOpen.downloadId && item.ready)) {
        const id = this.autoOpen.downloadId;
        const action = this.autoOpen.action;
        this.autoOpen = {};
        if (AppStorage.get<boolean>('appForeground') !== false) {
          await this.perform(id, () => action === 'save' ? saveDownload(this.context, id) : shareDownload(this.context, id));
        }
      }
    } catch (_error) { if (this.visible) this.error = '暂时无法读取传输记录，请稍后刷新'; }
    finally { this.loading = false; }
  }
  private async perform(key: string, action: () => Promise<void>): Promise<void> {
    if (this.busyKey) return;
    this.busyKey = key;
    this.error = '';
    try { await action(); }
    catch (error) { this.error = (error as Error).message; }
    finally { this.busyKey = ''; await this.refresh(); }
  }
  private confirmRemove(key: string, download: boolean): void {
    this.getUIContext().showAlertDialog({
      title: download ? '移除本机下载？' : '取消发送并删除？',
      message: download ? '删除本机副本，服务器上的附件会保留。' : '将停止本机任务并移除本机副本。已到达 NAS 的内容不会撤回。',
      primaryButton: { value: '保留', action: () => {} },
      secondaryButton: { value: '删除', action: () => {
        this.perform(key, () => download ? removeDownload(this.context, key) : removeQueueItem(this.context, key));
      } }
    });
  }

  build() {
    Column() {
      Row() {
        Button('返回').onClick(() => { this.getUIContext().getRouter().back(); })
        Text('传输任务').fontColor('#241d16').fontSize(20).fontWeight(FontWeight.Medium).layoutWeight(1).margin({ left: 12 })
        Button('刷新').enabled(!this.loading).onClick(() => { this.error = ''; this.refresh(); })
      }.width('100%').padding(12)
      if (this.error) { Text(this.error).fontColor('#a8331e').padding(12).width('100%') }
      Scroll() {
        Column({ space: 12 }) {
          Text('待发送 · ' + this.queue.length.toString()).fontColor('#241d16').fontSize(18).width('100%')
          if (this.queue.length === 0) { Text('没有待发送内容').fontColor('#5b5044').padding(16) }
          ForEach(this.queue, (item: QueueRow) => {
            Column({ space: 10 }) {
              Text(item.content || '附件').fontColor('#241d16').fontSize(16).width('100%')
                .maxLines(this.expandedKey === item.key ? 10000 : 3).textOverflow({ overflow: TextOverflow.Ellipsis })
              if (item.files) { Text(item.files).fontColor('#241d16').fontSize(14).width('100%') }
              Text(item.status).fontColor('#241d16').fontSize(13).fontColor('#5b5044').width('100%')
              if (this.expandedKey === item.key) {
                Text(new Date(item.createdAt).toLocaleString() + '\n' + item.serverUrl).fontColor('#241d16').fontSize(12).width('100%')
              }
              Flex({ wrap: FlexWrap.Wrap }) {
                Button(this.expandedKey === item.key ? '收起' : '详情').margin(4)
                  .onClick(() => { this.expandedKey = this.expandedKey === item.key ? '' : item.key; })
                if (item.active) {
                  Button('暂停').margin(4).enabled(!this.busyKey)
                    .onClick(() => { this.perform(item.key, () => pauseQueueItem(this.context, item.key)); })
                } else if (!item.terminalDeleted) {
                  Button(item.paused ? '继续' : '重试').margin(4).enabled(!this.busyKey)
                    .onClick(() => { this.perform(item.key, () => retryQueueItem(this.context, item.key)); })
                }
                Button('删除').margin(4).enabled(!this.busyKey).onClick(() => { this.confirmRemove(item.key, false); })
              }
            }.padding(16).width('100%').backgroundColor('#fbf7ef').borderRadius(12)
          }, (item: QueueRow) => item.key)
          Text('下载到本机 · ' + this.downloads.length.toString()).fontColor('#241d16').fontSize(18).width('100%').margin({ top: 12 })
          Text('传输可在后台继续。下载完成后可分享或保存，移除可释放本机空间。').fontColor('#241d16').fontSize(13).fontColor('#5b5044').width('100%')
          ForEach(this.downloads, (item: DownloadRow) => {
            Column({ space: 10 }) {
              Text(item.filename).fontColor('#241d16').fontSize(16).width('100%')
              Text(item.status).fontColor('#241d16').fontSize(13).fontColor('#5b5044').width('100%')
              Flex({ wrap: FlexWrap.Wrap }) {
                if (item.ready) {
                  Button('分享').margin(4).enabled(!this.busyKey)
                    .onClick(() => { this.perform(item.id, () => shareDownload(this.context, item.id)); })
                  Button('保存到文件夹').margin(4).enabled(!this.busyKey)
                    .onClick(() => { this.perform(item.id, () => saveDownload(this.context, item.id)); })
                } else if (!item.active) {
                  Button('重试').margin(4).enabled(!this.busyKey)
                    .onClick(() => { this.perform(item.id, () => retryDownload(this.context, item.id)); })
                }
                Button('移除').margin(4).enabled(!this.busyKey).onClick(() => { this.confirmRemove(item.id, true); })
              }
            }.padding(16).width('100%').backgroundColor('#fbf7ef').borderRadius(12)
          }, (item: DownloadRow) => item.id)
        }.padding(16).width('100%')
      }.layoutWeight(1).width('100%')
    }.width('100%').height('100%').backgroundColor('#f2ece1')
  }
}
