import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { itemSchema } from "@sendtomyself/shared";
import { eq } from "drizzle-orm";

const root = await mkdtemp(join(tmpdir(), "stm-api-"));
process.env.DB_PATH = join(root, "app.db");
process.env.STORAGE_ROOT = join(root, "uploads");
process.env.AUTH_PASSWORD = "test-only-password";
process.env.MAX_UPLOAD_BYTES = "1024";
await import("../src/db/migrate.js");
const { db } = await import("../src/db/client.js");
const { items, attachments } = await import("../src/db/schema.js");
const svc = await import("../src/services/items.js");
const { bus } = await import("../src/realtime/bus.js");
const { createApp } = await import("../src/app.js");
const { resolveKey } = await import("../src/lib/storage.js");
const { encodeCursor } = await import("../src/lib/cursor.js");
const app = createApp();
const events: Array<{ type: string; payload: unknown }> = [];
const unsub = bus.subscribe((event) => events.push(event));

beforeEach(async () => {
  db.delete(items).run();
  await rm(process.env.STORAGE_ROOT!, { recursive: true, force: true });
  events.length = 0;
});
after(async () => { unsub(); db.$client.close(); await rm(root, { recursive: true, force: true }); });
const file = (filename: string, data = "fixture") => ({ filename, mimeType: "text/plain", data: Buffer.from(data) });

async function storedFiles(): Promise<string[]> {
  try { return (await readdir(process.env.STORAGE_ROOT!, { recursive: true, withFileTypes: true }))
    .filter((entry) => entry.isFile()).map((entry) => entry.name); }
  catch { return []; }
}

async function cookie(): Promise<string> {
  const response = await app.request("/api/auth/login", { method: "POST",
    headers: { "content-type": "application/json" }, body: JSON.stringify({ password: "test-only-password" }) });
  assert.equal(response.status, 200);
  return response.headers.get("set-cookie")!.split(";")[0]!;
}

async function upload(files: File[], key?: string) {
  const body = new FormData();
  body.set("content", "中文附件");
  if (key !== undefined) body.set("dedupeKey", key);
  files.forEach((file) => body.append("files", file));
  return app.request("/api/items/upload", { method: "POST", headers: { cookie: await cookie() }, body });
}

test("pagination retains every same-second item across boundaries and concurrent inserts", () => {
  const created = Array.from({ length: 9 }, (_, i) => svc.createItem({ content: `中文 ${i}` }));
  created.forEach((item) => db.update(items).set({ createdAt: 100 }).where(eq(items.id, item.id)).run());
  const expected = created.map((item) => item.id).sort().reverse();
  const first = svc.listItems({ limit: 3 });
  const newer = svc.createItem({ content: "新记录" });
  const seen = first.items.map((item) => item.id);
  let cursor = first.nextCursor;
  while (cursor) {
    const page = svc.listItems({ limit: 3, cursor });
    seen.push(...page.items.map((item) => item.id));
    cursor = page.nextCursor;
  }
  assert.deepEqual(seen, expected);
  assert.equal(seen.includes(newer.id), false);
  assert.equal(svc.listItems({ cursor: "1970-01-01T00:01:41Z" }).items.length, 9);
  assert.throws(() => svc.listItems({ cursor: "broken" }), /invalid_cursor/);
});

test("failed second file rolls back the item, prior file and dedupe key; retry completes", async () => {
  // NUL in the second storage filename deterministically fails real file I/O.
  await assert.rejects(svc.createItemWithFiles("upload", [file("first.txt"), file("bad.\0")], "retry-key"));
  assert.equal(db.select().from(items).all().length, 0);
  assert.equal(db.select().from(attachments).all().length, 0);
  assert.deepEqual(await storedFiles(), []);
  assert.deepEqual(events, []);
  const item = await svc.createItemWithFiles("upload", [file("first.txt"), file("second.txt")], "retry-key");
  assert.equal(item.attachments?.length, 2);
  assert.equal(events.length, 1);
  const retry = await svc.createItemWithFiles("upload", [file("first.txt"), file("second.txt")], "retry-key");
  assert.equal(retry.id, item.id);
  assert.equal((await storedFiles()).length, 2);
  assert.equal(events.length, 1);
});

test("database insert failure removes prepared files and leaves no partial item", async () => {
  db.$client.exec("CREATE TRIGGER fail_attachment BEFORE INSERT ON attachments BEGIN SELECT RAISE(ABORT, 'injected'); END");
  try { await assert.rejects(svc.createItemWithFiles("upload", [file("test.txt")], "db-retry"), /injected/); }
  finally { db.$client.exec("DROP TRIGGER fail_attachment"); }
  assert.equal(svc.listItems({}).items.length, 0);
  assert.deepEqual(await storedFiles(), []);
  const retry = await svc.createItemWithFiles("upload", [file("test.txt")], "db-retry");
  assert.equal(retry.attachments?.length, 1);
});

test("parallel uploads with one dedupe key commit and broadcast exactly once", async () => {
  const results = await Promise.all(Array.from({ length: 6 }, () =>
    svc.createItemWithFiles("parallel", [file("test.txt")], "parallel-key")));
  assert.equal(new Set(results.map((item) => item.id)).size, 1);
  assert.equal(svc.listItems({}).items.length, 1);
  assert.equal(db.select().from(attachments).all().length, 1);
  assert.equal((await storedFiles()).length, 1);
  assert.equal(events.filter((event) => event.type === "item.created").length, 1);
});

test("no timeline item or creation event is visible while files are being prepared", async () => {
  const pending = svc.createItemWithFiles("pending", [file("test.txt")], "pending-key");
  assert.equal(svc.listItems({}).items.length, 0);
  assert.equal(events.length, 0);
  await pending;
  assert.equal(svc.listItems({}).items.length, 1);
});

test("upload, download, filename search, trash and restore preserve attachment bytes", async () => {
  const response = await upload([new File(["original bytes"], "中文.txt", { type: "text/plain" })], "multipart-key");
  assert.equal(response.status, 201);
  const item = itemSchema.parse(await response.json());
  const headers = { cookie: await cookie() };
  const raw = await app.request(`/api/attachments/${item.attachments![0]!.id}/raw?download=1`, { headers });
  assert.equal(raw.status, 200);
  assert.equal(await raw.text(), "original bytes");
  assert.match(raw.headers.get("content-disposition")!, /filename\*=UTF-8/);
  assert.equal(svc.listItems({ q: "中文.txt" }).items[0]?.id, item.id);
  assert.equal(svc.softDeleteItem(item.id), true);
  assert.equal(svc.listItems({}).items.length, 0);
  assert.equal(svc.listItems({ deleted: true }).items[0]?.id, item.id);
  const restored = svc.restoreItem(item.id)!;
  assert.equal(restored.attachments?.length, 1);
  assert.equal(await readFile(resolveKey(item.attachments![0]!.storageKey), "utf8"), "original bytes");
});

test("HTTP queries and multipart input reject invalid limits, cursors and dedupe keys", async () => {
  const headers = { cookie: await cookie() };
  for (const query of ["limit=0", "limit=-1", "limit=1.5", "limit=NaN", "limit=101", "cursor=broken", "isTodo=invalid", "deleted=invalid", `cursor=${encodeCursor(10, "").replace(/=/g, "")}`]) {
    assert.equal((await app.request(`/api/items?${query}`, { headers })).status, 400, query);
  }
  for (const key of ["", "x".repeat(65)]) {
    assert.equal((await upload([new File(["a"], "a.txt")], key)).status, 400);
  }
  assert.equal((await upload([new File(["a".repeat(1025)], "large.txt")])).status, 413);
  assert.equal(svc.listItems({}).items.length, 0);
});

test("device token authenticates uploads, cannot mint tokens, and is rejected after revocation", async () => {
  assert.equal((await app.request("/api/items")).status, 401);
  const headers = { cookie: await cookie(), "content-type": "application/json" };
  const device = await app.request("/api/auth/devices", { method: "POST", headers, body: JSON.stringify({ name: "test phone" }) });
  const { token } = await device.json() as { token: string };
  const bearer = { authorization: `Bearer ${token}`, "content-type": "application/json" };
  assert.equal((await app.request("/api/items", { headers: bearer })).status, 200);
  assert.equal((await app.request("/api/auth/devices", { method: "POST", headers: bearer, body: JSON.stringify({ name: "other" }) })).status, 401);
  assert.equal((await app.request(`/api/auth/devices/${token.slice(-6)}`, { method: "DELETE", headers })).status, 204);
  assert.equal((await app.request("/api/items", { headers: bearer })).status, 401);
});

test("two SSE subscribers receive committed create, update, delete and restore events", async () => {
  const headers = { cookie: await cookie() };
  const controllers = [new AbortController(), new AbortController()];
  const readers = await Promise.all(controllers.map(async (controller) => {
    const response = await app.request("/api/realtime", { headers, signal: controller.signal });
    assert.equal(response.status, 200);
    const reader = response.body!.getReader();
    assert.match(new TextDecoder().decode((await reader.read()).value), /event: ping/);
    return reader;
  }));
  try {
    const item = svc.createItem({ content: "sse" });
    svc.updateItem(item.id, { isTodo: true });
    svc.softDeleteItem(item.id);
    svc.restoreItem(item.id);
    for (const reader of readers) {
      let data = "";
      while (!data.includes('event: item.updated\ndata:') || data.split('event: item.updated').length < 3) {
        const chunk = await reader.read();
        assert.equal(chunk.done, false);
        data += new TextDecoder().decode(chunk.value);
      }
      assert.match(data, /event: item.created/);
      assert.match(data, /event: item.deleted/);
      assert.match(data, new RegExp(item.id));
    }
  } finally {
    controllers.forEach((controller) => controller.abort());
    await Promise.all(readers.map((reader) => reader.cancel()));
  }
});

test("WAL snapshot restores item state, attachment bytes and detects missing/corrupted files", async () => {
  const { snapshot, verifyBackup } = await import("../src/lib/backup.js");
  const backup = join(root, "backup");
  await mkdir(backup, { recursive: true });
  const item = await svc.createItemWithFiles("backup", [file("data.txt", "original")], "backup-key");
  svc.updateItem(item.id, { isTodo: true, pinned: true, dueAt: "2026-10-07T12:00:00Z" });
  svc.softDeleteItem(item.id);
  await snapshot(process.env.DB_PATH!, backup, process.env.STORAGE_ROOT!);
  // 改动源库后备份导出仍保留快照时的状态。
  svc.restoreItem(item.id);
  const exported = JSON.parse(await readFile(join(backup, "export.json"), "utf8"));
  assert.equal(exported.items[0].pinned, 1);
  assert.ok(exported.items[0].deleted_at);
  await verifyBackup(backup, process.env.STORAGE_ROOT!);
  const key = item.attachments![0]!.storageKey;
  await writeFile(resolveKey(key), "modified"); // 相同字节数，仅大小校验无法发现。
  await assert.rejects(verifyBackup(backup, process.env.STORAGE_ROOT!), /checksum/);
  await rm(resolveKey(key));
  await assert.rejects(verifyBackup(backup, process.env.STORAGE_ROOT!), /ENOENT/);
});

test("image upload stores original and thumbnail; invalid image falls back to original", async () => {
  const { default: sharp } = await import("sharp");
  const image = await sharp({ create: { width: 10, height: 10, channels: 3, background: "red" } }).png().toBuffer();
  const item = await svc.createItemWithFiles("image", [{ filename: "image.png", mimeType: "image/png", data: image }]);
  const attachment = item.attachments![0]!;
  assert.equal(attachment.hasThumb, true);
  const row = db.select().from(attachments).where(eq(attachments.id, attachment.id)).get()!;
  assert.deepEqual(await readFile(resolveKey(row.storageKey)), image);
  assert.equal((await sharp(await readFile(resolveKey(row.thumbKey!))).metadata()).format, "webp");
  const invalid = await svc.createItemWithFiles("fallback", [{ filename: "bad.png", mimeType: "image/png", data: Buffer.from("not an image") }]);
  assert.equal(invalid.attachments![0]!.hasThumb, false);
});

test("link and deadline filters apply before page limits, including attachment records with links", async () => {
  // Insert directly so fixtures never schedule outbound preview requests.
  const older = svc.createItem({ content: "older fixture" });
  db.update(items).set({ kind: "image", createdAt: 1, meta: JSON.stringify({ suggestions: { urls: ["https://example.invalid/post"] } }) })
    .where(eq(items.id, older.id)).run();
  const due = svc.createItem({ content: "due fixture" });
  svc.updateItem(due.id, { isTodo: true, dueAt: "2026-10-08T10:00:00Z" });
  const late = svc.createItem({ content: "later fixture" });
  svc.updateItem(late.id, { isTodo: true, dueAt: "2026-10-20T10:00:00Z" });
  const completed = svc.createItem({ content: "completed fixture" });
  svc.updateItem(completed.id, { isTodo: true, completed: true, dueAt: "2026-10-08T10:00:00Z" });
  for (let i = 0; i < 105; i++) svc.createItem({ content: `newer ${i}` });
  const headers = { cookie: await cookie() };
  const links = await app.request("/api/items?hasLinks=true&limit=1", { headers });
  assert.equal(links.status, 200);
  assert.deepEqual(((await links.json()) as { items: Array<{ id: string }> }).items.map((item: { id: string }) => item.id), [older.id]);
  const deadlines = await app.request("/api/items?isTodo=true&completed=false&dueBefore=2026-10-15T00%3A00%3A00Z&limit=1", { headers });
  assert.equal(deadlines.status, 200);
  assert.deepEqual(((await deadlines.json()) as { items: Array<{ id: string }> }).items.map((item: { id: string }) => item.id), [due.id]);
  assert.equal((await app.request("/api/items?hasLinks=invalid", { headers })).status, 400);
  assert.equal((await app.request("/api/items?dueBefore=invalid", { headers })).status, 400);
});

test("Raycast and desktop share records, attachments, retries, pagination and token revocation", async () => {
  const extensionClientPath = "../../raycast/src/lib/client.js";
  const { InboxClient } = await import(extensionClientPath);
  const session = await cookie();
  const issued = await app.request("/api/auth/devices", { method: "POST", headers: { cookie: session, "content-type": "application/json" }, body: JSON.stringify({ name: "Raycast Mac" }) });
  assert.equal(issued.status, 201);
  const { token } = await issued.json() as { token: string };
  const transport: typeof fetch = async (url, init) => app.request(new Request(String(url), init));
  let lost = true;
  const client = new InboxClient("http://localhost", token, async (url: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const response = await transport(url, init);
    if (lost && init?.method === "POST") { lost = false; throw new Error("reply lost after server commit"); }
    return response;
  });
  await assert.rejects(client.send("Mac → Windows 中文记录", [], "raycast-retry"));
  const sent = await client.send("Mac → Windows 中文记录", [], "raycast-retry");
  const desktop = await app.request("/api/items", { headers: { cookie: session } });
  const desktopItems = (await desktop.json() as { items: Array<{ id: string }> }).items;
  assert.equal(desktopItems.length, 1); assert.equal(desktopItems[0]!.id, sent.id);
  // Reverse direction: a desktop cookie upload is available through a Raycast bearer.
  const uploaded = await upload([new File(["file contents"], "桌面文件.txt", { type: "text/plain" })], "desktop-file");
  assert.equal(uploaded.status, 201);
  const fileItem = itemSchema.parse(await uploaded.json());
  assert.equal(await (await client.attachment(fileItem.attachments![0]!.id)).text(), "file contents");
  assert.equal((await client.list("Mac → Windows")).items[0]!.id, sent.id);
  for (let i = 0; i < 32; i++) svc.createItem({ content: `分页 ${i}` });
  const first = await client.list(); assert.equal(first.items.length, 30); assert.ok(first.nextCursor);
  const second = await client.list("", first.nextCursor!);
  assert.equal(new Set([...first.items, ...second.items].map((item: { id: string }) => item.id)).size, 34);
  const denied = await app.request("/api/auth/devices", { headers: { authorization: `Bearer ${token}` } });
  assert.equal(denied.status, 401);
  const revoked = await app.request(`/api/auth/devices/${token.slice(-6)}`, { method: "DELETE", headers: { cookie: session } });
  assert.equal(revoked.status, 204);
  await assert.rejects(client.list(), /吊销/);
  await assert.rejects(client.attachment(fileItem.attachments![0]!.id), /吊销/);
});
