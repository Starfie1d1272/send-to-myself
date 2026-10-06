import assert from "node:assert/strict";
import test from "node:test";
import { QueryClient, InfiniteQueryObserver } from "@tanstack/react-query";
import { api } from "../src/lib/api.ts";
import { itemPages, timelineParams } from "../src/lib/timeline.ts";

test("serializes false filters and filters links/deadlines before pagination", async (t) => {
  const old = globalThis.fetch;
  t.after(() => { globalThis.fetch = old; });
  let requested;
  globalThis.fetch = async (url) => { requested = new URL(url, "https://test.invalid"); return Response.json({ items: [], nextCursor: null }); };
  await api.list(timelineParams("todo", ""));
  assert.equal(requested.searchParams.get("completed"), "false");
  assert.equal(requested.searchParams.get("isTodo"), "true");
  await api.list(timelineParams("link", "帖子"));
  assert.equal(requested.searchParams.get("hasLinks"), "true");
  assert.equal(requested.searchParams.get("q"), "帖子");
  const now = new Date(2026, 9, 7, 12);
  const due = timelineParams("due", "", now);
  assert.equal(due.completed, false);
  assert.equal(due.dueBefore, new Date(2026, 9, 15).toISOString());
});

test("query observer loads every page, resets on filter change and refreshes loaded pages", async (t) => {
  const old = globalThis.fetch;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  t.after(() => { globalThis.fetch = old; client.clear(); });
  const cursors = [];
  globalThis.fetch = async (url) => {
    const query = new URL(url, "https://test.invalid").searchParams;
    const start = Number(query.get("cursor") ?? 0);
    cursors.push(start);
    const size = 237;
    const end = Math.min(start + 100, size);
    return Response.json({ items: Array.from({ length: end - start }, (_, i) => ({ id: start + i })), nextCursor: end < size ? String(end) : null });
  };
  const observer = new InfiniteQueryObserver(client, itemPages(timelineParams("all", "")));
  const unsubscribe = observer.subscribe(() => {});
  t.after(unsubscribe);
  await observer.refetch();
  await observer.fetchNextPage();
  await observer.fetchNextPage();
  assert.equal(observer.getCurrentResult().hasNextPage, false);
  const ids = observer.getCurrentResult().data.pages.flatMap((page) => page.items.map((item) => item.id));
  assert.equal(ids.length, 237);
  assert.equal(new Set(ids).size, 237);
  cursors.length = 0;
  await client.invalidateQueries({ queryKey: ["items"] });
  assert.deepEqual(cursors, [0, 100, 200]);
  observer.setOptions(itemPages(timelineParams("todo", "")));
  await observer.refetch();
  assert.equal(observer.getCurrentResult().data.pages.length, 1);
});


test("frontend text and attachment retries transmit their persistent dedupe keys", async (t) => {
  const old = globalThis.fetch;
  t.after(() => { globalThis.fetch = old; });
  const requests = [];
  globalThis.fetch = async (_url, init) => { requests.push(init); return Response.json({ id: "one" }); };
  await api.create({ content: "same draft", dedupeKey: "draft-key" });
  assert.equal(JSON.parse(requests[0].body).dedupeKey, "draft-key");
  const file = new File(["bytes"], "image.png", { type: "image/png" });
  await api.upload("same draft", [file], "upload-key");
  await api.upload("same draft", [file], "upload-key");
  assert.equal(requests[1].body.get("dedupeKey"), "upload-key");
  assert.equal(requests[2].body.get("dedupeKey"), "upload-key");
});
