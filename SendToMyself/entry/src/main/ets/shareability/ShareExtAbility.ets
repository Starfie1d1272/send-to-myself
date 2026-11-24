import { ShareExtensionAbility, UIExtensionContentSession, Want } from '@kit.AbilityKit';
import { handleShare } from '../common/ShareHandler';
import { isQueued, listQueue, QueueRow, reconcileQueueItem } from '../common/QueueService';
import { hilog } from '@kit.PerformanceAnalysisKit';
import { DOMAIN, TAG } from '../common/Constants';

export default class ShareExtAbility extends ShareExtensionAbility {
  private cleanups: Map<UIExtensionContentSession, () => void> = new Map();

  onSessionCreate(want: Want, session: UIExtensionContentSession): void {
    hilog.info(DOMAIN, TAG, 'ShareExtAbility onSessionCreate');

    let storageParam: Record<string, Object> = {
      'session': session,
      'shareResult': '',
      'shareError': '',
      'shareMessage': ''
    };
    let storage = new LocalStorage(storageParam);
    let active = true;
    let pollTimer = -1;
    let checking = false;
    const stopWatching = () => {
      active = false;
      if (pollTimer >= 0) {
        clearInterval(pollTimer);
        pollTimer = -1;
      }
    };
    this.cleanups.set(session, stopWatching);

    session.loadContent('pages/SharePage', storage);

    handleShare(want, this.context).then((result) => {
      if (!active) return;
      hilog.info(DOMAIN, TAG, 'Share result: success=%{public}s queued=%{public}s needsLogin=%{public}s',
        result.success.toString(), result.queued.toString(), result.needsLogin.toString());
      if (result.success) {
        storage.setOrCreate<string>('shareResult', 'success');
      } else if (result.queued) {
        storage.setOrCreate<string>('shareMessage', result.errorMessage || '已保存在本机，打开应用或恢复网络后重试');
        storage.setOrCreate<string>('shareResult', 'queued');
        if (result.key && !result.needsLogin) {
          const key = result.key;
          pollTimer = setInterval(() => {
            if (!active || checking) return;
            checking = true;
            reconcileQueueItem(this.context, key).then(async () => {
              if (!active) return;
              if (!await isQueued(this.context, key)) {
                stopWatching();
                storage.setOrCreate<string>('shareMessage', '');
                storage.setOrCreate<string>('shareResult', 'success');
                return;
              }
              const row = (await listQueue(this.context)).find((item: QueueRow) => item.key === key);
              if (!active || !row) return;
              storage.setOrCreate<string>('shareMessage', row.status || '已加入后台传输，可在应用内查看进度');
              if (row.statusKnown && !row.active) {
                stopWatching();
              }
            }).catch(() => {}).finally(() => { checking = false; });
          }, 800);
        }
      } else if (result.unknown) {
        storage.setOrCreate<string>('shareMessage', result.errorMessage || '本机保存结果尚未确认');
        storage.setOrCreate<string>('shareResult', 'unknown');
      } else if (result.needsLogin) {
        storage.setOrCreate<string>('shareResult', 'needsLogin');
      } else {
        storage.setOrCreate<string>('shareError', result.errorMessage ?? 'Unknown error');
      }
    }).catch((err: Error) => {
      if (!active) return;
      hilog.error(DOMAIN, TAG, 'Share handling error: %{public}s', err.message);
      storage.setOrCreate<string>('shareError', err.message);
    });
  }

  onSessionDestroy(session: UIExtensionContentSession): void {
    const cleanup = this.cleanups.get(session);
    if (cleanup) {
      cleanup();
      this.cleanups.delete(session);
    }
    hilog.info(DOMAIN, TAG, 'ShareExtAbility onSessionDestroy');
  }

  onCreate(): void {
    hilog.info(DOMAIN, TAG, 'ShareExtAbility onCreate');
  }

  onDestroy(): void {
    hilog.info(DOMAIN, TAG, 'ShareExtAbility onDestroy');
  }
}
