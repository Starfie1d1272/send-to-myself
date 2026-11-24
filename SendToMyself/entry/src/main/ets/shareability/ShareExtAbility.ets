import { ShareExtensionAbility, UIExtensionContentSession, Want } from '@kit.AbilityKit';
import { handleShare } from '../common/ShareHandler';
import { hilog } from '@kit.PerformanceAnalysisKit';
import { DOMAIN, TAG } from '../common/Constants';

export default class ShareExtAbility extends ShareExtensionAbility {
  private activeSessions: Set<UIExtensionContentSession> = new Set();

  onSessionCreate(want: Want, session: UIExtensionContentSession): void {
    hilog.info(DOMAIN, TAG, 'ShareExtAbility onSessionCreate');

    let storageParam: Record<string, Object> = {
      'session': session,
      'shareResult': '',
      'shareError': '',
      'shareMessage': ''
    };
    let storage = new LocalStorage(storageParam);
    this.activeSessions.add(session);

    session.loadContent('pages/SharePage', storage);

    handleShare(want, this.context).then((result) => {
      if (!this.activeSessions.has(session)) return;
      hilog.info(DOMAIN, TAG, 'Share result: success=%{public}s queued=%{public}s needsLogin=%{public}s',
        result.success.toString(), result.queued.toString(), result.needsLogin.toString());
      if (result.success) {
        storage.setOrCreate<string>('shareResult', 'success');
      } else if (result.queued) {
        storage.setOrCreate<string>('shareMessage', result.errorMessage || '已加入后台传输，可在应用内查看进度');
        storage.setOrCreate<string>('shareResult', 'queued');
      } else if (result.unknown) {
        storage.setOrCreate<string>('shareMessage', result.errorMessage || '本机保存结果尚未确认');
        storage.setOrCreate<string>('shareResult', 'unknown');
      } else if (result.needsLogin) {
        storage.setOrCreate<string>('shareResult', 'needsLogin');
      } else {
        storage.setOrCreate<string>('shareError', result.errorMessage ?? 'Unknown error');
      }
    }).catch((err: Error) => {
      if (!this.activeSessions.has(session)) return;
      hilog.error(DOMAIN, TAG, 'Share handling error: %{public}s', err.message);
      storage.setOrCreate<string>('shareError', err.message);
    });
  }

  onSessionDestroy(session: UIExtensionContentSession): void {
    this.activeSessions.delete(session);
    hilog.info(DOMAIN, TAG, 'ShareExtAbility onSessionDestroy');
  }

  onCreate(): void {
    hilog.info(DOMAIN, TAG, 'ShareExtAbility onCreate');
  }

  onDestroy(): void {
    this.activeSessions.clear();
    hilog.info(DOMAIN, TAG, 'ShareExtAbility onDestroy');
  }
}
