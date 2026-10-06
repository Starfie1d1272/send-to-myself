import assert from "node:assert/strict";
import test from "node:test";
import { subscribeRealtime } from "../src/lib/realtime.ts";

test("refreshes on initial connect, reconnect and item events; cleanup closes SSE", (t) => {
  const source = new EventTarget();
  let closed = false;
  const previous = globalThis.EventSource;
  t.after(() => { if (previous === undefined) delete globalThis.EventSource; else globalThis.EventSource = previous; });
  globalThis.EventSource = class {
    constructor(url) { assert.equal(url, "/api/realtime"); return source; }
  };
  source.close = () => { closed = true; };
  let refreshes = 0;
  const close = subscribeRealtime(() => refreshes++);
  for (const event of ["open", "item.created", "item.updated", "item.deleted", "open"]) {
    source.dispatchEvent(new Event(event));
  }
  assert.equal(refreshes, 5);
  source.dispatchEvent(new Event("ping"));
  assert.equal(refreshes, 5);
  close();
  assert.equal(closed, true);
});
