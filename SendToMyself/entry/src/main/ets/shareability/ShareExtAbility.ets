import { ShareExtensionAbility, UIExtensionContentSession, Want } from '@kit.AbilityKit';
import { handleShare } from '../common/ShareHandler';
import { hilog } from '@kit.PerformanceAnalysisKit';
import { DOMAIN, TAG } from '../common/Constants';

export default class ShareExtAbility extends ShareExtensionAbility {
  onSessionCreate(want: Want, session: UIExtensionContentSession): void {
    hilog.info(DOMAIN, TAG, 'ShareExtAbility onSessionCreate');

    let storageParam: Record<string, Object> = {
      'session': session,
      'shareResult': '',
      'shareError': ''
    };
    let storage = new LocalStorage(storageParam);

    session.loadContent('pages/SharePage', storage);

    handleShare(want, this.context).then((result) => {
      hilog.info(DOMAIN, TAG, 'Share result: success=%{public}s queued=%{public}s needsLogin=%{public}s',
        result.success.toString(), result.queued.toString(), result.needsLogin.toString());
      if (result.success) {
        storage.setOrCreate<string>('shareResult', 'success');
      } else if (result.queued) {
        storage.setOrCreate<string>('shareResult', 'queued');
      } else if (result.needsLogin) {
        storage.setOrCreate<string>('shareResult', 'needsLogin');
      } else {
        storage.setOrCreate<string>('shareError', result.errorMessage ?? 'Unknown error');
      }
    }).catch((err: Error) => {
      hilog.error(DOMAIN, TAG, 'Share handling error: %{public}s', err.message);
      storage.setOrCreate<string>('shareError', err.message);
    });
  }

  onSessionDestroy(session: UIExtensionContentSession): void {
    hilog.info(DOMAIN, TAG, 'ShareExtAbility onSessionDestroy');
  }

  onCreate(): void {
    hilog.info(DOMAIN, TAG, 'ShareExtAbility onCreate');
  }

  onDestroy(): void {
    hilog.info(DOMAIN, TAG, 'ShareExtAbility onDestroy');
  }
}
