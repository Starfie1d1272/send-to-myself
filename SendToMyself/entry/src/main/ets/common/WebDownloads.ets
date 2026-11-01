import { webview } from '@kit.ArkWeb';
import { common } from '@kit.AbilityKit';
import { fileIo, picker } from '@kit.CoreFileKit';
import { promptAction } from '@kit.ArkUI';

// ArkWeb keeps the authenticated request; only completed files reach the save picker.
export class WebDownloads {
  private delegate: webview.WebDownloadDelegate = new webview.WebDownloadDelegate();
  private activeGuid: string = '';
  private path: string = '';

  private context: common.UIAbilityContext;

  constructor(context: common.UIAbilityContext) { this.context = context; }

  attach(controller: webview.WebviewController): void {
    this.delegate.onBeforeDownload((item: webview.WebDownloadItem) => {
      if (this.activeGuid) {
        item.cancel();
        this.notify('请先完成当前文件的保存');
        return;
      }
      this.activeGuid = item.getGuid();
      this.path = this.context.cacheDir + '/attachment-download-' + Date.now().toString();
      try {
        item.start(this.path);
      } catch (_error) {
        item.cancel();
        this.cleanup();
        this.notify('下载失败，请重试');
      }
    });
    this.delegate.onDownloadFinish((item: webview.WebDownloadItem) => {
      if (item.getGuid() === this.activeGuid) this.save(item);
    });
    this.delegate.onDownloadFailed((item: webview.WebDownloadItem) => {
      if (item.getGuid() !== this.activeGuid) return;
      this.cleanup();
      this.notify('下载失败，请检查网络后重试');
    });
    controller.setDownloadDelegate(this.delegate);
  }

  private async save(item: webview.WebDownloadItem): Promise<void> {
    let destination: fileIo.File | undefined;
    try {
      const name = item.getSuggestedFileName().replace(/[\\/\x00-\x1f]/g, '_') || '附件';
      const uris = await new picker.DocumentViewPicker(this.context).save({ newFileNames: [name] });
      if (uris.length === 0) return;
      destination = fileIo.openSync(uris[0], fileIo.OpenMode.WRITE_ONLY | fileIo.OpenMode.TRUNC);
      await fileIo.copyFile(this.path, destination.fd);
      this.notify('文件已保存');
    } catch (_error) {
      this.notify('文件未保存，请重新下载');
    } finally {
      if (destination) {
        try { fileIo.closeSync(destination); } catch (_error) {}
      }
      this.cleanup();
    }
  }

  private cleanup(): void {
    if (this.path) {
      try { fileIo.unlinkSync(this.path); } catch (_error) {}
    }
    this.activeGuid = '';
    this.path = '';
  }

  private notify(message: string): void {
    promptAction.showToast({ message });
  }
}
