// Execute the real non-UI ArkTS modules with mocked platform services.
// This verifies logic, not an SDK build or device behavior.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, mkdtempSync, rmSync, openSync, closeSync, copyFileSync, unlinkSync, existsSync, mkdirSync, writeFileSync, readSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, basename } from "node:path";
import { randomUUID } from "node:crypto";
import { transformSync } from "esbuild";
const source = new URL("../../../SendToMyself/entry/src/main/ets/common/", import.meta.url);

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "stm-harmony-"));
  const store = new Map();
  const openFiles = new Set();
  const locks = new Set();
  const requests = [];
  const clients = [];
  const state = { token: "device-token", server: "https://server.invalid", records: [], respond: async () => ({ responseCode: 201 }) };
  t.after(() => { for (const fd of openFiles) closeSync(fd); rmSync(root, { recursive: true, force: true }); });
  const asset = {
    loadServerUrl: async () => state.server,
    loadDeviceToken: async () => state.token,
    removeDeviceToken: async () => { state.token = undefined; },
  };
  const mime = { ".png": "image/png", ".jpg": "image/jpeg", "general.png": "image/png", ".pdf": "application/pdf" };
  const prefs = { get: async (key, fallback) => store.get(key) ?? fallback, put: async (key, value) => { store.set(key, value); }, flush: async () => {} };
  const kits = {
    "@kit.ArkData": {
      preferences: { getPreferences: async () => prefs, removePreferencesFromCache: async () => {} },
      uniformTypeDescriptor: {
        getUniformDataTypeByFilenameExtension: (extension) => extension,
        getTypeDescriptor: (type) => ({ mimeTypes: mime[type] ? [mime[type]] : [] }),
      },
    },
    "@kit.PerformanceAnalysisKit": { hilog: { info() {}, warn() {}, error() {} } },
    "@kit.ArkTS": { util: { generateRandomUUID: randomUUID, TextEncoder: class { encodeInto(text) { return new TextEncoder().encode(text); } } } },
    "@kit.ShareKit": { systemShare: { getSharedData: async () => ({ getRecords: () => state.records }) } },
    "@kit.CoreFileKit": {
      fileUri: { FileUri: class { constructor(uri) { this.name = basename(uri); } } },
      fileIo: {
        OpenMode: { READ_ONLY: 0, READ_WRITE: 2, CREATE: 64 },
        accessSync: existsSync,
        mkdirSync: (path) => mkdirSync(path, { recursive: true }),
        openSync: (path, flags) => { const fd = openSync(path, flags); openFiles.add(fd); return { fd,
          tryLock: () => { if (locks.has(path)) throw new Error("busy"); locks.add(path); },
          unlock: () => { locks.delete(path); },
        }; },
        closeSync: (file) => { closeSync(file.fd); openFiles.delete(file.fd); },
        readSync: (fd, buffer) => readSync(fd, new Uint8Array(buffer), 0, buffer.byteLength, 0),
        copyFileSync: (from, to) => copyFileSync(`/proc/self/fd/${from}`, `/proc/self/fd/${to}`),
        unlinkSync,
      },
    },
    "@kit.NetworkKit": { http: { RequestMethod: { POST: "POST", GET: "GET" }, createHttp: () => {
      const client = { destroyed: false, request: async (url, options) => { requests.push({ url, options }); return state.respond(url, options); }, destroy: () => { client.destroyed = true; } };
      clients.push(client); return client;
    } } },
  };
  let cache = new Map([["./AssetStore", asset]]);
  function newProcess() { cache = new Map([["./AssetStore", asset]]); return load; }
  function load(name) {
    if (cache.has(name)) return cache.get(name);
    const result = transformSync(readFileSync(new URL(name.replace(/^\.\//, "") + ".ets", source), "utf8"), { loader: "ts", format: "cjs", target: "es2022" });
    const module = { exports: {} };
    cache.set(name, module.exports);
    new Function("require", "module", "exports", result.code)((dependency) => kits[dependency] ?? load(dependency), module, module.exports);
    cache.set(name, module.exports);
    return module.exports;
  }
  return { root, context: { filesDir: root, cacheDir: join(root, "cache") }, load, newProcess, state, store, requests, clients, openFiles };
}
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };

test("Harmony queue preserves concurrent arrivals and serializes overlapping drains", async (t) => {
  const f = fixture(t); const queue = f.load("./QueueService");
  const entered = deferred(); const finish = deferred();
  f.state.respond = async () => { entered.resolve(); await finish.promise; return { responseCode: 201 }; };
  await Promise.all([queue.enqueue(f.context, "first", "text", "one"), queue.enqueue(f.context, "second", "text", "two")]);
  const processing = queue.processQueue(f.context);
  await entered.promise;
  const overlap = queue.processQueue(f.context);
  await queue.enqueue(f.context, "new", "text", "three");
  finish.resolve();
  await Promise.all([processing, overlap]);
  assert.equal(f.requests.length, 2);
  assert.equal(await queue.isQueued(f.context, "first"), false);
  assert.equal(await queue.isQueued(f.context, "second"), false);
  assert.equal(await queue.isQueued(f.context, "new"), true);
  await queue.processQueue(f.context);
  assert.equal((await queue.queueStatus(f.context)).count, 0);
  assert.equal(f.requests.length, 3);
});

test("Harmony 401 pauses without dropping records or files; login retry cleans acknowledged files", async (t) => {
  const f = fixture(t); const queue = f.load("./QueueService");
  const file = join(f.root, "pending.png"); writeFileSync(file, "image");
  await queue.enqueue(f.context, "image", "upload", "", [{ path: file, filename: "截图.png", mimeType: "image/png" }]);
  await queue.enqueue(f.context, "text", "text", "keep");
  f.state.respond = async () => ({ responseCode: 401 });
  await queue.processQueue(f.context);
  assert.equal(f.requests.length, 1);
  assert.equal(f.state.token, undefined);
  assert.equal((await queue.queueStatus(f.context)).count, 2);
  assert.match((await queue.queueStatus(f.context)).error, /登录/);
  assert.equal(existsSync(file), true);
  await queue.processQueue(f.context);
  assert.equal(f.requests.length, 1);
  f.state.token = "new-token";
  f.state.respond = async () => ({ responseCode: 201 });
  await queue.processQueue(f.context);
  assert.equal((await queue.queueStatus(f.context)).count, 0);
  assert.equal(existsSync(file), false);
  const part = f.requests[1].options.multiFormDataList.find((part) => part.name === "files");
  assert.equal(part.contentType, "image/png");
  assert.equal(part.remoteFileName, "截图.png");
  assert.ok(f.clients.every((client) => client.destroyed));
});

test("Harmony non-auth failures remain visible, successful later records clear independently", async (t) => {
  const f = fixture(t); const queue = f.load("./QueueService");
  await queue.enqueue(f.context, "too-large", "text", "bad");
  await queue.enqueue(f.context, "ok", "text", "ok");
  f.state.respond = async (_url, options) => ({ responseCode: JSON.parse(options.extraData).dedupeKey === "too-large" ? 413 : 201 });
  await queue.processQueue(f.context);
  assert.equal(await queue.isQueued(f.context, "too-large"), true);
  assert.equal(await queue.isQueued(f.context, "ok"), false);
  assert.match((await queue.queueStatus(f.context)).error, /413/);
  assert.equal(f.state.token, "device-token");
  assert.ok(f.clients.every((client) => client.destroyed));
});

test("Harmony records do not send to a changed server; network errors retain and destroy requests", async (t) => {
  const f = fixture(t); const queue = f.load("./QueueService");
  await queue.enqueue(f.context, "bound", "text", "private");
  f.state.server = "https://different.invalid";
  await queue.processQueue(f.context);
  assert.equal(f.requests.length, 0);
  assert.equal((await queue.queueStatus(f.context)).count, 1);
  f.state.server = "https://server.invalid";
  f.state.respond = async () => { throw new Error("offline"); };
  await queue.processQueue(f.context);
  assert.equal(await queue.isQueued(f.context, "bound"), true);
  assert.ok(f.clients.every((client) => client.destroyed));
});

test("Harmony image shares persist file metadata before HTTP and recover after an offline restart", async (t) => {
  const f = fixture(t); const share = f.load("./ShareHandler"); const queue = f.load("./QueueService");
  const original = join(f.root, "原图.png"); writeFileSync(original, "original-bytes");
  f.state.records = [{ uri: original, utd: "general.png" }, { content: "说明" }];
  f.state.respond = async () => {
    assert.equal((JSON.parse(f.store.get("queue"))).length, 1);
    throw new Error("offline");
  };
  const result = await share.handleShare({}, f.context);
  assert.equal(result.queued, true);
  assert.equal(result.needsLogin, false);
  let item = JSON.parse(f.store.get("queue"))[0];
  assert.equal(item.files[0].mimeType, "image/png");
  assert.equal(item.files[0].filename, "原图.png");
  assert.equal(item.files[0].path.startsWith(join(f.root, "shared-queue")), true);
  assert.equal(readFileSync(item.files[0].path, "utf8"), "original-bytes");
  assert.equal(f.openFiles.size, 0);
  f.state.respond = async () => ({ responseCode: 201 });
  await queue.processQueue(f.context);
  assert.equal((await queue.queueStatus(f.context)).count, 0);
  assert.equal(existsSync(item.files[0].path), false);
});

test("Harmony hyperlink records are text, filenames cannot collide, login sends no stale token", async (t) => {
  const f = fixture(t); const share = f.load("./ShareHandler");
  f.state.records = [{ content: "帖子", uri: "https://example.invalid/post", utd: "general.hyperlink" }];
  assert.equal((await share.handleShare({}, f.context)).success, true);
  assert.equal(JSON.parse(f.requests[0].options.extraData).content, "帖子\nhttps://example.invalid/post");
  const files = f.load("./ShareFiles");
  const original = join(f.root, "same.png"); writeFileSync(original, "bytes");
  const first = files.copySharedFile(f.context, original);
  const second = files.copySharedFile(f.context, original);
  assert.notEqual(first.path, second.path);
  assert.equal(first.filename, "same.png");
  await f.load("./HttpClient").postJson("/api/auth/login", { password: "test" });
  assert.equal(f.requests.at(-1).options.header.Authorization, undefined);
  assert.equal(f.openFiles.size, 0);
});


test("Harmony independent module instances cannot overwrite another process's enqueue", async (t) => {
  const f = fixture(t);
  const first = f.load("./QueueService");
  const second = f.newProcess()("./QueueService");
  await Promise.all(Array.from({ length: 20 }, (_, i) =>
    (i % 2 ? first : second).enqueue(f.context, `process-${i}`, "text", String(i))));
  assert.equal((await first.queueStatus(f.context)).count, 20);
  assert.equal((await second.queueStatus(f.context)).count, 20);
  assert.equal(f.openFiles.size, 0);
});


test("Harmony generic image UTD and opaque media URI still preserve image MIME and supplied filename", (t) => {
  const f = fixture(t);
  const original = join(f.root, "12345");
  writeFileSync(original, Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const file = f.load("./ShareFiles").copySharedFile(f.context, original, "相册截图.png", "general.image");
  assert.equal(file.filename, "相册截图.png");
  assert.equal(file.mimeType, "image/png");
  assert.equal(f.openFiles.size, 0);
});
