import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import test from "node:test";
import { loadDraft, saveDraft, clearDraft } from "../src/lib/draft.ts";

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
