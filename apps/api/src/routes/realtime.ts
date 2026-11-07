import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { credentialValid, resolveCredential } from "../lib/auth.js";
import { bus } from "../realtime/bus.js";

export const realtimeRoute = new Hono();
realtimeRoute.get("/", (c) => {
  const credential = resolveCredential(c);
  if (!credential) return c.json({ error: "unauthorized" }, 401);
  return streamSSE(c, async (stream) => {
    let closed = false;
    let writes = Promise.resolve();
    let wake: (() => void) | undefined;
    const close = () => {
      if (!closed) {
        closed = true;
        unsub();
        wake?.();
      }
    };
    const send = (event: string, data: string) => {
      writes = writes
        .then(async () => {
          if (closed) return;
          if (!credentialValid(credential, true)) {
            close();
            return;
          }
          await stream.writeSSE({ event, data });
        })
        .catch(close);
    };
    const unsub = bus.subscribe((e) => send(e.type, JSON.stringify(e.payload)));
    stream.onAbort(close);
    try {
      while (!closed && !stream.aborted) {
        send("ping", String(Date.now()));
        await writes;
        if (!closed)
          await new Promise<void>((resolve) => {
            const timer = setTimeout(() => {
              wake = undefined;
              resolve();
            }, 15_000);
            wake = () => {
              clearTimeout(timer);
              wake = undefined;
              resolve();
            };
          });
      }
    } finally {
      close();
    }
  });
});
