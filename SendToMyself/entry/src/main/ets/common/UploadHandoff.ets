import { DetectionContext } from './DetectionContext';
import { common } from '@kit.AbilityKit';
import { util } from '@kit.ArkTS';
import { SharedFileData, cleanSharedFiles } from './ShareFiles';
import { enqueueWebUpload, getUploadReceipt, retryQueueItem } from './QueueService';
import { ConnectionSession, assertCurrentConnection } from './ConnectionSession';

export interface HandoffResult { status: string; dedupeKey: string; serverOrigin: string; reason?: string }
export class UploadHandoff {
  detectionContext?: DetectionContext;
  content: string; key: string; origin: string; requestId: string; connection: ConnectionSession;
  files: SharedFileData[] = [];
  writing: boolean = false; finished: boolean = false;
  private resolve: (value: string) => void;
  promise: Promise<string>;
  constructor(content: string, key: string, connection: ConnectionSession, detectionContext?: DetectionContext) {
    this.detectionContext = detectionContext; this.content = content; this.key = key; this.connection = connection; this.origin = connection.origin; this.requestId = util.generateRandomUUID();
    let complete: (value: string) => void = () => {};
    this.promise = new Promise<string>((resolve) => { complete = resolve; });
    this.resolve = complete;
  }
  canPrepare(): boolean { return active === this && !this.finished && !this.writing; }
  addPreparedFile(file: SharedFileData): boolean {
    if (!this.canPrepare()) { cleanSharedFiles([file]); return false; }
    this.files.push(file); return true;
  }
  removePreparedFile(index: number): void {
    if (!this.canPrepare() || index < 0 || index >= this.files.length) return;
    cleanSharedFiles([this.files[index]]); this.files.splice(index, 1);
  }
  cancel(): void { this.finish(this.writing ? 'unknown' : 'cancelled'); }
  finish(status: string, reason?: string): void {
    if (this.finished) return;
    this.finished = true;
    if (status === 'cancelled' || status === 'not_queued') cleanSharedFiles(this.files);
    this.resolve(JSON.stringify({ status: status, dedupeKey: this.key, serverOrigin: this.origin, reason: reason } as HandoffResult));
    if (active === this) active = undefined;
  }
  async submit(context: common.Context): Promise<void> {
    if (!this.canPrepare() || this.files.length === 0) return;
    try { await assertCurrentConnection(context, this.connection); }
    catch (_error) { if (this.canPrepare()) this.finish('not_queued', 'route_failed'); return; }
    if (!this.canPrepare()) return;
    this.writing = true;
    const result = await enqueueWebUpload(context, this.key, this.content, this.files, this.origin, this.detectionContext, this.connection);
    if (result === 'accepted') {
      try { await assertCurrentConnection(context, this.connection); }
      catch (_error) { this.finish('unknown'); return; }
      this.finish('queued');
      retryQueueItem(context, this.key, this.connection).catch(() => {});
    } else if (result === 'not_accepted') this.finish('not_queued', 'prepare_failed');
    else this.finish('unknown');
  }
}
let active: UploadHandoff | undefined;
export function currentHandoff(): UploadHandoff | undefined { return active; }
export async function openHandoff(context: common.Context, content: string, key: string, connection: ConnectionSession,
  route: () => Promise<void>, detectionContext?: DetectionContext): Promise<string> {
  const origin = connection.origin;
  await assertCurrentConnection(context, connection);
  if (content.length > 100000 || key.length < 1 || key.length > 64) return JSON.stringify({ status: 'not_queued', dedupeKey: key, serverOrigin: origin, reason: 'invalid_input' });
  if (active) {
    if (active.key === key && active.origin === origin && active.connection.revision === connection.revision) return active.promise;
    throw new Error('BUSY');
  }
  const accepted = await getUploadReceipt(context, key, origin);
  await assertCurrentConnection(context, connection);
  if (accepted) return JSON.stringify({ status: 'queued', dedupeKey: key, serverOrigin: origin });
  const pending = currentHandoff();
  if (pending) {
    if (pending.key === key && pending.origin === origin && pending.connection.revision === connection.revision) return pending.promise;
    throw new Error('BUSY');
  }
  const handoff = new UploadHandoff(content, key, connection, detectionContext); active = handoff;
  try { await route(); } catch (_error) { handoff.finish('not_queued', 'route_failed'); }
  return handoff.promise;
}
