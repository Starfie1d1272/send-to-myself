import assert from "node:assert/strict";
import test from "node:test";
import { copyImage } from "../src/lib/clipboard.ts";
import { shareAttachment } from "../src/lib/share.ts";
const attachment = { id: "a", filename: "截图.png", mimeType: "image/png" };
function globals(t, secure = true) {
  const descriptors = new Map();
  for (const key of ["navigator", "window", "fetch", "ClipboardItem"]) descriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
  t.after(() => { for (const [key, value] of descriptors) { if (value) Object.defineProperty(globalThis, key, value); else delete globalThis[key]; } });
  const writes = [];
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { clipboard: { write: async (items) => writes.push(items), writeText: async () => assert.fail("Must not replace image with URL") } } });
  globalThis.window = { isSecureContext: secure };
  globalThis.fetch = async () => new Response("bytes", { headers: { "content-type": "image/png" } });
  globalThis.ClipboardItem = class { constructor(value) { this.value = value; } };
  return writes;
}
test("image copy writes actual bytes and never substitutes a private URL", async (t) => {
  const writes = globals(t);
  assert.equal(await copyImage("/api/attachments/a/raw"), true);
  assert.equal(await writes[0][0].value["image/png"].text(), "bytes");
  window.isSecureContext = false;
  assert.equal(await copyImage("/api/attachments/a/raw"), false);
  window.isSecureContext = true;
  globalThis.fetch = async () => new Response("login", { status: 401 });
  assert.equal(await copyImage("/api/attachments/a/raw"), false);
  assert.equal(writes.length, 1);
});
test("share sends file bytes, cancellation is inert, unsupported targets receive no private link", async (t) => {
  globals(t);
  const shares = [];
  navigator.canShare = () => true;
  navigator.share = async (payload) => shares.push(payload);
  assert.equal(await shareAttachment(attachment), "shared");
  assert.equal(await shares[0].files[0].text(), "bytes");
  assert.equal(shares[0].files[0].name, attachment.filename);
  navigator.share = async () => { throw new DOMException("cancelled", "AbortError"); };
  assert.equal(await shareAttachment(attachment), "cancelled");
  navigator.canShare = () => false;
  assert.equal(await shareAttachment(attachment), "unsupported");
  assert.equal(shares.length, 1);
});
