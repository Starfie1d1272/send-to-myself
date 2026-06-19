import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { bus } from "../realtime/bus.js";

export const realtimeRoute = new Hono();

/**
 * SSE 通道（SPEC §12.5）。订阅事件总线，把 item.* 事件推给已连接客户端。
 * 传输细节只在此处，业务层经 bus 解耦，未来可替换为 WebSocket。
 */
realtimeRoute.get("/", (c) =>
  streamSSE(c, async (stream) => {
    const unsub = bus.subscribe((e) => {
      void stream.writeSSE({ event: e.type, data: JSON.stringify(e.payload) });
    });
    stream.onAbort(unsub);

    // 心跳，避免代理断开闲置连接
    while (!stream.aborted) {
      await stream.writeSSE({ event: "ping", data: String(Date.now()) });
      await stream.sleep(15_000);
    }
    unsub();
  }),
);
