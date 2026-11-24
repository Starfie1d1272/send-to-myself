import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import test from "node:test";
import {
  clearDraft,
  clearPendingAttempts,
  deletePendingAttempt,
  listPendingAttempts,
  loadDraft,
  prepareComposerDraft,
  saveDraft,
  selectPendingAttempt,
} from "../src/lib/draft.ts";

test("draft restores text and attachment bytes/metadata, and ordered clear cannot resurrect it", async () => {
  await clearDraft();
  const file = new File(["image-bytes"], "截图.png", { type: "image/png", lastModified: 100 });
  await saveDraft({ content: "未发送的想法", files: [file], dedupeKey: "same-attempt" });
  const draft = await loadDraft();
  assert.equal(draft.dedupeKey, "same-attempt");
  assert.equal(draft.content, "未发送的想法");
  assert.equal(draft.files[0].name, file.name);
  assert.equal(draft.files[0].type, "image/png");
  assert.equal(draft.files[0].lastModified, 100);
  assert.equal(await draft.files[0].text(), "image-bytes");
  const first = saveDraft({ content: "旧内容", files: [file] });
  const second = saveDraft({ content: "修改后的内容", files: [] });
  const clear = clearDraft();
  await Promise.all([first, second, clear]);
  assert.deepEqual(await loadDraft(), { content: "", files: [] });
});

test("pending attempts can be deleted individually or cleared all at once", async (t) => {
  const prevStorage = Object.getOwnPropertyDescriptor(globalThis, "sessionStorage");
  const sessionMap = new Map();
  Object.defineProperty(globalThis, "sessionStorage", {
    configurable: true,
    value: {
      getItem: (k) => sessionMap.get(k) ?? null,
      setItem: (k, v) => sessionMap.set(k, String(v)),
      removeItem: (k) => sessionMap.delete(k),
    },
  });
  t.after(() => {
    if (prevStorage) Object.defineProperty(globalThis, "sessionStorage", prevStorage);
    else delete globalThis.sessionStorage;
  });
  await clearPendingAttempts();
  await clearDraft();
  await prepareComposerDraft(
    { content: "第一条", files: [], dedupeKey: "k1", webSendAttempted: true },
    "k1",
  );
  await prepareComposerDraft(
    { content: "第二条", files: [], dedupeKey: "k2", webSendAttempted: true },
    "k2",
  );
  let list = await listPendingAttempts();
  assert.deepEqual(
    list.map((item) => item.key),
    ["k1", "k2"],
  );
  assert.ok(await selectPendingAttempt("k1"));
  await deletePendingAttempt("k1");
  list = await listPendingAttempts();
  assert.deepEqual(
    list.map((item) => item.key),
    ["k2"],
  );
  await clearPendingAttempts();
  assert.deepEqual(await listPendingAttempts(), []);
  assert.deepEqual(await loadDraft(), { content: "", files: [] });
});

test("legacy nativeHandoffPending records restore with a fresh dedupeKey and clearing attempts preserves unsent drafts", async (t) => {
  const prevStorage = Object.getOwnPropertyDescriptor(globalThis, "sessionStorage");
  const sessionMap = new Map();
  Object.defineProperty(globalThis, "sessionStorage", {
    configurable: true,
    value: {
      getItem: (k) => sessionMap.get(k) ?? null,
      setItem: (k, v) => sessionMap.set(k, String(v)),
      removeItem: (k) => sessionMap.delete(k),
    },
  });
  t.after(() => {
    if (prevStorage) Object.defineProperty(globalThis, "sessionStorage", prevStorage);
    else delete globalThis.sessionStorage;
  });

  await clearPendingAttempts();
  await clearDraft();
  // Simulate a pre-upgrade IndexedDB record with nativeHandoffPending: true and webSendAttempted: false.
  await new Promise((resolve, reject) => {
    const req = indexedDB.open("send-to-myself-drafts", 1);
    req.onsuccess = () => {
      const tx = req.result.transaction("drafts", "readwrite");
      tx.objectStore("drafts").put(
        {
          content: "旧原生草稿文字",
          files: [],
          dedupeKey: "legacy-native-key",
          webSendAttempted: false,
          nativeHandoffPending: true,
        },
        "attempt:legacy-native-key",
      );
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    };
    req.onerror = () => reject(req.error);
  });
  // Save a normal unsent draft over the active composer slot.
  await saveDraft({
    content: "普通未发送草稿",
    files: [],
    dedupeKey: "unsent-key",
    webSendAttempted: false,
  });

  const list = await listPendingAttempts();
  assert.equal(list.length, 1);
  assert.equal(list[0].key, "legacy-native-key");
  assert.equal(list[0].native, true);

  const restored = await selectPendingAttempt("legacy-native-key");
  assert.ok(restored);
  assert.equal(restored.content, "旧原生草稿文字");
  assert.equal(restored.webSendAttempted, false);
  assert.equal(restored.restoredFromNative, true);
  assert.notEqual(restored.dedupeKey, "legacy-native-key");

  // Clearing pending attempts removes attempt:* but keeps the normal unsent draft intact.
  await clearPendingAttempts();
  assert.deepEqual(await listPendingAttempts(), []);
  const shared = await loadDraft();
  assert.equal(shared.content, "普通未发送草稿");
  assert.equal(shared.dedupeKey, "unsent-key");
  assert.equal(shared.webSendAttempted, false);
});
