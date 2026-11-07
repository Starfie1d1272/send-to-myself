import assert from "node:assert/strict";
import test from "node:test";
import { QueryClient, InfiniteQueryObserver } from "@tanstack/react-query";
import { api } from "../src/lib/api.ts";
import { initialTimelineState, itemPages, timelineParams } from "../src/lib/timeline.ts";

test("serializes false filters and filters links/deadlines before pagination", async (t) => {
  const old = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = old;
  });
  let requested;
  globalThis.fetch = async (url) => {
    requested = new URL(url, "https://test.invalid");
    return Response.json({ items: [], nextCursor: null });
  };
  await api.list(timelineParams({ ...initialTimelineState, view: "todo" }));
  assert.equal(requested.searchParams.get("completed"), "false");
  assert.equal(requested.searchParams.get("isTodo"), "true");
  await api.list(timelineParams({ ...initialTimelineState, contentType: "link", query: "帖子" }));
  assert.equal(requested.searchParams.get("hasLinks"), "true");
  assert.equal(requested.searchParams.get("q"), "帖子");
  const now = new Date(2026, 9, 7, 12);
  const due = timelineParams(
    { ...initialTimelineState, view: "todo", todoScope: "next7days" },
    now,
  );
  assert.equal(due.completed, false);
  assert.equal(due.dueBefore, new Date(now.getTime() + 168 * 3600000).toISOString());
});

test("query observer loads every page, resets on filter change and refreshes loaded pages", async (t) => {
  const old = globalThis.fetch;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  t.after(() => {
    globalThis.fetch = old;
    client.clear();
  });
  const cursors = [];
  globalThis.fetch = async (url) => {
    const query = new URL(url, "https://test.invalid").searchParams;
    const start = Number(query.get("cursor") ?? 0);
    cursors.push(start);
    const size = 237;
    const end = Math.min(start + 100, size);
    return Response.json({
      items: Array.from({ length: end - start }, (_, i) => ({ id: start + i })),
      nextCursor: end < size ? String(end) : null,
    });
  };
  const observer = new InfiniteQueryObserver(
    client,
    itemPages(timelineParams(initialTimelineState)),
  );
  const unsubscribe = observer.subscribe(() => {});
  t.after(unsubscribe);
  await observer.refetch();
  await observer.fetchNextPage();
  await observer.fetchNextPage();
  assert.equal(observer.getCurrentResult().hasNextPage, false);
  const ids = observer
    .getCurrentResult()
    .data.pages.flatMap((page) => page.items.map((item) => item.id));
  assert.equal(ids.length, 237);
  assert.equal(new Set(ids).size, 237);
  cursors.length = 0;
  await client.invalidateQueries({ queryKey: ["items"] });
  assert.deepEqual(cursors, [0, 100, 200]);
  observer.setOptions(itemPages(timelineParams({ ...initialTimelineState, view: "todo" })));
  await observer.refetch();
  assert.equal(observer.getCurrentResult().data.pages.length, 1);
});

test("frontend text and attachment retries transmit their persistent dedupe keys", async (t) => {
  const old = globalThis.fetch;
  const oldXhr = globalThis.XMLHttpRequest;
  t.after(() => {
    globalThis.fetch = old;
    globalThis.XMLHttpRequest = oldXhr;
  });
  const requests = [];
  const item = {
    id: "one",
    content: "same draft",
    kind: "text",
    category: "none",
    isTodo: false,
    completed: false,
    pinned: false,
    sensitive: false,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  };
  globalThis.fetch = async (_url, init) => {
    requests.push(init.body);
    return Response.json(item);
  };
  globalThis.XMLHttpRequest = class {
    upload = {};
    status = 201;
    responseText = JSON.stringify(item);
    open() {}
    send(body) {
      requests.push(body);
      this.onload();
    }
    abort() {
      this.onabort();
    }
  };
  await api.create({ content: "same draft", dedupeKey: "draft-key" });
  assert.equal(JSON.parse(requests[0]).dedupeKey, "draft-key");
  const file = new File(["bytes"], "image.png", { type: "image/png" });
  await api.upload("same draft", [file], "upload-key");
  await api.upload("same draft", [file], "upload-key");
  assert.equal(requests[1].get("dedupeKey"), "upload-key");
  assert.equal(requests[2].get("dedupeKey"), "upload-key");
});
