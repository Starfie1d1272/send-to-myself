import assert from "node:assert/strict";
import test from "node:test";
import { copyImage, copyText } from "../src/lib/clipboard.ts";
import { shareAttachment } from "../src/lib/share.ts";
const attachment = { id: "a", filename: "截图.png", mimeType: "image/png" };
function globals(t, secure = true) {
  const descriptors = new Map();
  for (const key of ["navigator", "window", "fetch", "ClipboardItem", "createImageBitmap", "document"]) descriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
  t.after(() => { for (const [key, value] of descriptors) { if (value) Object.defineProperty(globalThis, key, value); else delete globalThis[key]; } });
  const writes = [];
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { clipboard: { write: async (items) => writes.push(items), writeText: async () => assert.fail("Must not replace image with URL") } } });
  globalThis.window = { isSecureContext: secure };
  globalThis.fetch = async () => new Response("bytes", { headers: { "content-type": "image/png" } });
  globalThis.createImageBitmap = async () => ({ width: 2, height: 2, close() {} });
  globalThis.document = { createElement: () => ({ getContext: () => ({ drawImage() {} }), toBlob: callback => callback(new Blob(["PNG bytes"], { type: "image/png" })) }) };
  globalThis.ClipboardItem = class { constructor(value) { this.value = value; } };
  return writes;
}
test("image copy writes actual bytes and never substitutes a private URL", async (t) => {
  const writes = globals(t);
  assert.equal(await copyImage("/api/attachments/a/raw"), true);
  assert.equal(await writes[0][0].value["image/png"].text(), "PNG bytes");
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

test("desktop copies text and converted PNG bytes on HTTP without reading clipboard", async (t) => {
  const writes = globals(t, false);
  const commands = [];
  window.__TAURI__ = { core: { invoke: async (command, args) => commands.push({ command, args }) } };
  assert.equal(await copyText("Mac → Windows"), true);
  globalThis.fetch = async () => new Response("JPEG bytes", { headers: { "content-type": "image/jpeg" } });
  assert.equal(await copyImage("/api/attachments/a/raw"), true);
  assert.deepEqual(commands[0], { command: "copy_text", args: { text: "Mac → Windows" } });
  assert.equal(commands[1].command, "copy_image");
  assert.equal(new TextDecoder().decode(new Uint8Array(commands[1].args.png)), "PNG bytes");
  assert.equal(writes.length, 0);
});
test("denied native writes and oversized images fail without copying URLs", async (t) => {
  globals(t, false);
  window.__TAURI__ = { core: { invoke: async () => { throw new Error("denied"); } } };
  assert.equal(await copyImage("/api/attachments/a/raw"), false);
  window.isSecureContext = true;
  globalThis.createImageBitmap = async () => ({ width: 100_000, height: 100_000, close() {} });
  assert.equal(await copyImage("/api/attachments/a/raw"), false);
});
