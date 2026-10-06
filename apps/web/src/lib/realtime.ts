import { useEffect } from "react";

/**
 * 订阅服务端 SSE（SPEC §12.5）。任一 item.* 事件触发回调（通常用于刷新时间线）。
 * 传输细节封装在此，与 UI 解耦。
 */
export function subscribeRealtime(onChange: () => void): () => void {
  const es = new EventSource("/api/realtime");
  const handler = () => onChange();
  // SSE 不重放断线期间的事件；每次建立连接都重查时间线，补齐漏掉的变化。
  es.addEventListener("open", handler);
  es.addEventListener("item.created", handler);
  es.addEventListener("item.updated", handler);
  es.addEventListener("item.deleted", handler);
  return () => es.close();
}

export function useRealtime(onChange: () => void) {
  useEffect(() => subscribeRealtime(onChange), [onChange]);
}
