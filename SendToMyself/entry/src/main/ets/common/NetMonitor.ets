import { connection } from '@kit.NetworkKit';
import { common } from '@kit.AbilityKit';
import { processQueue } from './QueueService';
import { hilog } from '@kit.PerformanceAnalysisKit';
import { DOMAIN, TAG } from './Constants';
import { BusinessError } from '@kit.BasicServicesKit';

let netConnection: connection.NetConnection | undefined = undefined;

export function startNetMonitor(context: common.Context): void {
  if (netConnection) {
    return;
  }
  netConnection = connection.createNetConnection();
  netConnection.on('netAvailable', () => {
    hilog.info(DOMAIN, TAG, 'Network available, processing queue');
    processQueue(context).catch((err: Error) => {
      hilog.error(DOMAIN, TAG, 'Queue processing failed: %{public}s', err.message);
    });
  });
  netConnection.register((error: BusinessError) => {
    if (error) {
      hilog.error(DOMAIN, TAG, 'NetConnection register failed: %{public}s', error.message);
    }
  });
}

export function stopNetMonitor(): void {
  if (netConnection) {
    netConnection.unregister(() => {});
    netConnection = undefined;
  }
}
