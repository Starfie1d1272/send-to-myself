import assert from "node:assert/strict";
import test from "node:test";
import { InboxClient, normalizeServer } from "../src/lib/client.ts";

test("server normalization preserves ports and rejects credential-bearing URLs", () => {
  assert.equal(normalizeServer(" http://localhost:8787/ "), "http://localhost:8787");
  assert.equal(normalizeServer("inbox.example.com"), "https://inbox.example.com");
  for (const url of ["file:///a", "https://user:secret@example.com", "https://a.com?token=secret", "https://a.com/#key"]) assert.throws(() => normalizeServer(url));
});
test("bearer requests never follow redirects and pagination/search are encoded", async () => {
  let request;
  const client = new InboxClient("http://localhost:8787", " secret-token ", async (url, init) => {
    request = { url, init }; return Response.json({ items: [], nextCursor: null });
  });
  await client.list("中文 & #", "cursor+/=");
  const url = new URL(request.url);
  assert.equal(url.searchParams.get("q"), "中文 & #");
  assert.equal(url.searchParams.get("cursor"), "cursor+/=");
  assert.equal(request.init.headers.authorization, "Bearer secret-token");
  assert.equal(request.init.redirect, "error");
  assert.ok(request.init.signal);
});
test("errors expose useful status without leaking response body, server or token", async () => {
  for (const status of [401, 413, 500]) {
    const client = new InboxClient("https://private.example", "secret", async () => new Response("secret internal trace", { status }));
    await assert.rejects(client.list(), error => !/secret|private\.example|internal trace/.test(error.message));
  }
  const client = new InboxClient("https://private.example", "secret", async () => { throw new Error("leaked token=secret"); });
  await assert.rejects(client.send("hello", [], "key"), /结果可能尚未确认/);
});
test("multipart preserves original bytes, MIME, Unicode name and retry key", async () => {
  const client = new InboxClient("http://localhost:8787", "token", async (url, init) => {
    assert.equal(new URL(url).pathname, "/api/items/upload");
    assert.equal(init.body.get("content"), "中文记录");
    assert.equal(init.body.get("dedupeKey"), "retry-key");
    const file = init.body.get("files");
    assert.equal(file.name, "图片.png"); assert.equal(file.type, "image/png");
    assert.deepEqual(new Uint8Array(await file.arrayBuffer()), new Uint8Array([1, 2, 3]));
    return Response.json({ id: "created" });
  });
  assert.equal((await client.send("中文记录", [new File([new Uint8Array([1, 2, 3])], "图片.png", { type: "image/png" })], "retry-key")).id, "created");
});
test("abort of a superseded search stays an abort", async () => {
  const controller = new AbortController(); controller.abort();
  const client = new InboxClient("https://example.com", "token", async () => { throw controller.signal.reason; });
  await assert.rejects(client.list("old", undefined, controller.signal), { name: "AbortError" });
});

test("unconfirmed sends survive restart and intervening sends with the same key; confirmed sends get a new key", async () => {
  const { sendWithRetryKey } = await import("../src/lib/pending.ts");
  const data = new Map();
  const store = { getItem: async key => data.get(key), setItem: async (key, value) => { data.set(key, value); }, removeItem: async key => { data.delete(key); } };
  const keys = [];
  let fail = true;
  const api = new InboxClient("http://localhost:8787", "token", async (_, init) => {
    keys.push(JSON.parse(init.body).dedupeKey);
    if (fail) throw new Error("reply lost");
    return Response.json({ id: "created" });
  });
  await assert.rejects(sendWithRetryKey(api, "clipboard", [], store));
  await assert.rejects(sendWithRetryKey(api, "different note", [], store));
  fail = false;
  // New client instance models a command restart; storage outlives the command.
  await sendWithRetryKey(api, "clipboard", [], store);
  assert.equal(keys[0], keys[2]); assert.notEqual(keys[0], keys[1]);
  await sendWithRetryKey(api, "clipboard", [], store);
  assert.notEqual(keys[2], keys[3]);
  assert.equal(data.size, 1);
});
test("a changed attachment changes the retry key without losing an earlier failed send", async () => {
  const { sendWithRetryKey } = await import("../src/lib/pending.ts");
  const data = new Map();
  const store = { getItem: async key => data.get(key), setItem: async (key, value) => { data.set(key, value); }, removeItem: async key => { data.delete(key); } };
  const keys = [];
  const api = new InboxClient("http://localhost:8787", "token", async (_, init) => { keys.push(init.body.get("dedupeKey")); throw new Error("offline"); });
  const send = text => sendWithRetryKey(api, "", [new File([text], "same.txt", { type: "text/plain" })], store);
  await assert.rejects(send("A")); await assert.rejects(send("B")); await assert.rejects(send("A"));
  assert.notEqual(keys[0], keys[1]); assert.equal(keys[0], keys[2]);
});
test("unreadable or corrupt retry storage never silently creates another request", async () => {
  const { sendWithRetryKey } = await import("../src/lib/pending.ts");
  const api = new InboxClient("http://localhost", "token", async () => { assert.fail("must not send"); });
  const store = { getItem: async () => { throw new Error("storage unavailable"); }, setItem: async () => {}, removeItem: async () => {} };
  await assert.rejects(sendWithRetryKey(api, "hello", [], store), /storage unavailable/);
  store.getItem = async () => "broken JSON";
  await assert.rejects(sendWithRetryKey(api, "hello", [], store), /重试记录损坏/);
});
test("draft cleanup failure keeps retry identity after the server has confirmed", async () => {
  const { sendWithRetryKey } = await import("../src/lib/pending.ts");
  const data = new Map();
  const store = { getItem: async key => data.get(key), setItem: async (key, value) => { data.set(key, value); }, removeItem: async key => { data.delete(key); } };
  const keys = [];
  const api = new InboxClient("http://localhost", "token", async (_, init) => { keys.push(JSON.parse(init.body).dedupeKey); return Response.json({ id: "already-sent" }); });
  await assert.rejects(sendWithRetryKey(api, "draft", [], store, async () => { throw new Error("cannot clear draft"); }), /cannot clear draft/);
  assert.equal(data.size, 1);
  await sendWithRetryKey(api, "draft", [], store, async () => {});
  assert.equal(keys[0], keys[1]); assert.equal(data.size, 0);
});
