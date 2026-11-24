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

test("pending attempts can be deleted individually or cleared all at once", async () => {
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
