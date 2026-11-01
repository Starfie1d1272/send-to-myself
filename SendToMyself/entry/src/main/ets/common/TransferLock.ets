import { common } from '@kit.AbilityKit';
import { fileIo } from '@kit.CoreFileKit';

export class TransferBusyError extends Error {
  constructor() { super('内容正在处理中，请稍后重试'); }
}
const held: Set<string> = new Set<string>();

// The same OS lock protects the UI and share-extension processes.
export async function withTransferLock<T>(context: common.Context, name: string,
  action: () => Promise<T>, wait: boolean = true): Promise<T> {
  const path = context.filesDir + '/transfer-' + encodeURIComponent(name) + '.lock';
  const file = fileIo.openSync(path, fileIo.OpenMode.READ_WRITE | fileIo.OpenMode.CREATE);
  let acquired = false;
  try {
    for (let attempt = 0; attempt < (wait ? 80 : 1); attempt++) {
      if (!held.has(path)) {
        try { file.tryLock(true); held.add(path); acquired = true; break; } catch (_error) {}
      }
      if (wait) await new Promise<void>((resolve) => { setTimeout(resolve, 25); });
    }
    if (!acquired) throw new TransferBusyError();
    return await action();
  } finally {
    try { if (acquired) { held.delete(path); file.unlock(); } }
    finally { fileIo.closeSync(file); }
  }
}
