/**
 * 实时事件总线（SPEC §12.5）。
 * 传输层无关的 pub/sub —— 当前由 SSE 订阅；未来 WebSocket 可平滑接同一总线。
 * 业务层只调 publish，不感知传输方式。
 */

export type RealtimeEvent =
  | { type: "item.created"; payload: unknown }
  | { type: "item.updated"; payload: unknown }
  | { type: "item.deleted"; payload: { id: string } };

type Handler = (e: RealtimeEvent) => void;

const handlers = new Set<Handler>();

export const bus = {
  subscribe(h: Handler): () => void {
    handlers.add(h);
    return () => handlers.delete(h);
  },
  publish(e: RealtimeEvent): void {
    for (const h of handlers) h(e);
  },
};
