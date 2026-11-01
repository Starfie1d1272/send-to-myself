// Execute the real non-UI ArkTS modules with mocked platform services.
// This verifies logic, not an SDK build or device behavior.
import assert from "node:assert/strict";
import test from "node:test";
import { constants, readFileSync, mkdtempSync, rmSync, openSync, closeSync, unlinkSync, existsSync, mkdirSync, writeFileSync, readSync, statSync, rmdirSync } from "node:fs";
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
  const tasks = new Map();
  const agentCalls = [];
  const State = { INITIALIZED: 0, WAITING: 16, RUNNING: 32, RETRYING: 33, PAUSED: 48,
    STOPPED: 49, COMPLETED: 64, FAILED: 65, REMOVED: 80 };
  const missingTask = () => Object.assign(new Error("task missing"), { code: 21900006 });
  const state = { agentCreateError: undefined, agentRemoveError: undefined, beforeStart: undefined, beforePut: undefined, token: "device-token", server: "https://server.invalid", records: [], respond: async () => ({ responseCode: 201 }) };
  t.after(() => { for (const fd of openFiles) closeSync(fd); rmSync(root, { recursive: true, force: true }); });
  const asset = {
    loadServerUrl: async () => state.server,
    loadDeviceToken: async () => state.token,
    removeDeviceToken: async () => { state.token = undefined; },
  };
  const mime = { ".png": "image/png", ".jpg": "image/jpeg", "general.png": "image/png", ".pdf": "application/pdf" };
  const prefs = { get: async (key, fallback) => store.get(key) ?? fallback, put: async (key, value) => { if (state.beforePut) await state.beforePut(key, value); store.set(key, value); }, flush: async () => {} };
  const kits = {
    "@kit.BasicServicesKit": { request: { agent: {
      State, Action: { UPLOAD: 1, DOWNLOAD: 0 }, Mode: { BACKGROUND: 0 }, Network: { ANY: 0 },
      create: async (_context, config) => {
        if (state.agentCreateError) throw state.agentCreateError;
        const tid = randomUUID();
        const task = { tid, config, progress: { state: State.INITIALIZED, index: 0, processed: 0, sizes: [100] },
          start: async () => { agentCalls.push(["start", tid]); if (state.beforeStart) await state.beforeStart(task); task.progress.state = State.RUNNING; },
          pause: async () => { agentCalls.push(["pause", tid]); task.progress.state = State.PAUSED; },
          resume: async () => { agentCalls.push(["resume", tid]); task.progress.state = State.RUNNING; },
          on: () => {},
        };
        tasks.set(tid, task); agentCalls.push(["create", tid]); return task;
      },
      show: async (id) => { if (!tasks.has(id)) throw missingTask(); return tasks.get(id); },
      getTask: async (_context, id) => { if (!tasks.has(id)) throw missingTask(); return tasks.get(id); },
      remove: async (id) => {
        if (state.agentRemoveError) throw state.agentRemoveError;
        agentCalls.push(["remove", id]); if (!tasks.delete(id)) throw missingTask();
      },
    } } },
    "@kit.ArkData": {
      preferences: { getPreferences: async () => prefs, removePreferencesFromCache: async () => {} },
      uniformTypeDescriptor: {
        getUniformDataTypeByFilenameExtension: (extension) => extension,
        UniformDataType: { FILE: "general.file" },
        getUniformDataTypeByMIMEType: (type) => type === "application/pdf" ? "com.adobe.pdf" : "general.image",
        getTypeDescriptor: (type) => ({ mimeTypes: mime[type] ? [mime[type]] : [] }),
      },
    },
    "@kit.PerformanceAnalysisKit": { hilog: { info() {}, warn() {}, error() {} } },
    "@kit.ArkTS": { url: { URL }, util: { generateRandomUUID: randomUUID, TextEncoder: class { encodeInto(text) { return new TextEncoder().encode(text); } } } },
    "@kit.ShareKit": { systemShare: {
      SharedData: class { constructor(record) { this.record = record; } },
      ShareController: class { constructor(data) { this.data = data; } on() {} async show() { state.shared = this.data.record; } },
      SharePreviewMode: { DEFAULT: 0 }, SelectionMode: { SINGLE: 0 },
      getSharedData: async () => ({ getRecords: () => state.records }) } },
    "@kit.CoreFileKit": {
      picker: { DocumentViewPicker: class { async save() { return []; } } },
      fileUri: { getUriFromPath: (path) => "file://test" + path, FileUri: class { constructor(uri) { this.name = basename(uri); } } },
      fileIo: {
        OpenMode: { READ_ONLY: constants.O_RDONLY, READ_WRITE: constants.O_RDWR, CREATE: constants.O_CREAT },
        accessSync: existsSync,
        statSync, rmdirSync,
        mkdirSync: (path) => mkdirSync(path, { recursive: true }),
        openSync: (path, flags) => { const fd = openSync(path, flags); openFiles.add(fd); return { fd,
          tryLock: () => { if (locks.has(path)) throw new Error("busy"); locks.add(path); },
          unlock: () => { locks.delete(path); },
        }; },
        closeSync: (file) => { closeSync(file.fd); openFiles.delete(file.fd); },
        readSync: (fd, buffer) => readSync(fd, new Uint8Array(buffer), 0, buffer.byteLength, 0),
        copyFile: async (from, to) => writeFileSync(to, readFileSync(from)),
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
  return { root, tasks, agentCalls, State, context: { filesDir: root, cacheDir: join(root, "cache") }, load, newProcess, state, store, requests, clients, openFiles };
}
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };

test("Harmony credentials survive module reload with ordinary encrypted assets", async () => {
  const entries = new Map();
  const asset = {
    Tag: { ALIAS: "alias", SECRET: "secret", RETURN_TYPE: "return", ACCESSIBILITY: "access", IS_PERSISTENT: "persistent" },
    ReturnType: { ALL: "all" }, Accessibility: { DEVICE_FIRST_UNLOCKED: "unlocked" },
    add: async (attributes) => {
      assert.equal(attributes.has("persistent"), false, "ordinary apps must not request uninstall-persistent storage");
      entries.set(new TextDecoder().decode(attributes.get("alias")), attributes);
    },
    remove: async (query) => { entries.delete(new TextDecoder().decode(query.get("alias"))); },
    query: async (query) => { const value = entries.get(new TextDecoder().decode(query.get("alias"))); return value ? [value] : []; },
  };
  const kits = {
    "@kit.AssetStoreKit": { asset },
    "@kit.ArkTS": { url: { URL }, util: { TextEncoder: class { encodeInto(value) { return new TextEncoder().encode(value); } },
      TextDecoder: { create: () => ({ decodeToString: (value) => new TextDecoder().decode(value) }) } } },
  };
  function load() {
    const code = transformSync(readFileSync(new URL("AssetStore.ets", source), "utf8"), { loader: "ts", format: "cjs" }).code;
    const module = { exports: {} };
    new Function("require", "module", "exports", code)((name) => kits[name] ?? fixtureConstants(), module, module.exports);
    return module.exports;
  }
  function fixtureConstants() {
    const code = transformSync(readFileSync(new URL("Constants.ets", source), "utf8"), { loader: "ts", format: "cjs" }).code;
    const module = { exports: {} };
    new Function("module", "exports", code)(module, module.exports);
    return module.exports;
  }
  const first = load();
  await first.saveServerUrl("https://device-test.invalid");
  await first.saveDeviceToken("test-device-token");
  const restarted = load();
  assert.equal(await restarted.loadServerUrl(), "https://device-test.invalid");
  assert.equal(await restarted.loadDeviceToken(), "test-device-token");
  await restarted.removeDeviceToken();
  assert.equal(await first.loadDeviceToken(), undefined);
});

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

test("Harmony multipart preserves text and dedupe keys as UTF-8 fields", async (t) => {
  const f = fixture(t);
  const client = f.load("./HttpClient");
  const key = randomUUID();
  f.state.respond = async (_url, options) => {
    assert.equal(options.header["Content-Type"], "multipart/form-data");
    const form = new FormData();
    for (const part of options.multiFormDataList) {
      // Native multipart accepts strings or ArrayBuffer; typed arrays are objects.
      assert.equal(typeof part.data, "string");
      form.append(part.name, part.data);
    }
    const parsed = await new Request("https://server.invalid", { method: "POST", body: form }).formData();
    assert.equal(parsed.get("content"), "手机附件 · 中文正文");
    assert.equal(parsed.get("dedupeKey"), key);
    return { responseCode: 201 };
  };
  assert.equal(await client.postUploadItem("手机附件 · 中文正文", [], key), true);
});

test("Harmony cold start distinguishes unreachable auth from an invalid token", async (t) => {
  const f = fixture(t);
  const auth = f.load("./AuthService");
  f.state.respond = async () => { throw new Error("offline"); };
  assert.equal(await auth.checkTokenValid(), undefined);
  f.state.respond = async () => ({ responseCode: 503 });
  assert.equal(await auth.checkTokenValid(), undefined);
  f.state.respond = async () => ({ responseCode: 200, result: JSON.stringify({ authenticated: false }) });
  assert.equal(await auth.checkTokenValid(), false);
  f.state.respond = async () => ({ responseCode: 200, result: JSON.stringify({ authenticated: true }) });
  assert.equal(await auth.checkTokenValid(), true);
  f.state.token = undefined;
  assert.equal(await auth.checkTokenValid(), false);
});

test("Harmony text 401 retains records, login retry acknowledges them", async (t) => {
  const f = fixture(t); const queue = f.load("./QueueService");
  await queue.enqueue(f.context, "text", "text", "keep");
  f.state.respond = async () => ({ responseCode: 401 });
  await queue.processQueue(f.context);
  assert.equal(f.state.token, undefined);
  assert.equal((await queue.queueStatus(f.context)).count, 1);
  assert.match((await queue.queueStatus(f.context)).error, /登录/);
  await queue.processQueue(f.context);
  assert.equal(f.requests.length, 1);
  f.state.token = "new-token";
  f.state.respond = async () => ({ responseCode: 201 });
  await queue.processQueue(f.context);
  assert.equal((await queue.queueStatus(f.context)).count, 0);
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
  f.state.beforeStart = async (task) => {
    assert.equal(JSON.parse(f.store.get("queue"))[0].agentId, task.tid);
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
  f.state.beforeStart = undefined;
  const restarted = f.newProcess()("./QueueService");
  await restarted.processQueue(f.context);
  f.tasks.get(item.agentId).progress.state = f.State.COMPLETED;
  await restarted.reconcileQueue(f.context);
  assert.equal((await restarted.queueStatus(f.context)).count, 0);
  assert.equal(existsSync(item.files[0].path), false);
});

test("Harmony hyperlink records are text, filenames cannot collide, login sends no stale token", async (t) => {
  const f = fixture(t); const share = f.load("./ShareHandler");
  f.state.records = [{ content: "帖子", uri: "https://example.invalid/post", utd: "general.hyperlink" }];
  assert.equal((await share.handleShare({}, f.context)).success, true);
  assert.equal(JSON.parse(f.requests[0].options.extraData).content, "帖子\nhttps://example.invalid/post");
  const files = f.load("./ShareFiles");
  const original = join(f.root, "same.png"); writeFileSync(original, "bytes");
  const first = await files.copySharedFileAsync(f.context, original);
  const second = await files.copySharedFileAsync(f.context, original);
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


test("Harmony generic image UTD and opaque media URI still preserve image MIME and supplied filename", async (t) => {
  const f = fixture(t);
  const original = join(f.root, "12345");
  writeFileSync(original, Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const file = await f.load("./ShareFiles").copySharedFileAsync(f.context, original, "相册截图.png", "general.image");
  assert.equal(file.filename, "相册截图.png");
  assert.equal(file.mimeType, "image/png");
  assert.equal(f.openFiles.size, 0);
});

test("background multipart keeps all files in one request and persists its ID before starting", async (t) => {
  const f = fixture(t); const queue = f.load("./QueueService");
  const files = ["a.png", "b.pdf"].map((filename) => {
    const path = join(f.root, filename); writeFileSync(path, filename);
    return { path, filename, mimeType: filename.endsWith("png") ? "image/png" : "application/pdf" };
  });
  const key = randomUUID();
  await queue.enqueue(f.context, key, "upload", "中文说明", files);
  f.state.beforeStart = async (task) => assert.equal(JSON.parse(f.store.get("queue"))[0].agentId, task.tid);
  const otherProcess = f.newProcess()("./QueueService");
  await Promise.all([queue.processQueue(f.context), otherProcess.processQueue(f.context)]);
  assert.equal(f.tasks.size, 1);
  const task = [...f.tasks.values()][0];
  assert.equal(task.config.mode, 0);
  assert.equal(task.config.multipart, true);
  assert.equal(task.config.redirect, false);
  assert.equal(task.config.headers.Authorization, "Bearer device-token");
  assert.equal(task.config.data.find((part) => part.name === "dedupeKey").value, key);
  assert.equal(task.config.data.find((part) => part.name === "content").value, "中文说明");
  assert.deepEqual(task.config.data.find((part) => part.name === "files").value.map((part) => [part.filename, part.contentType]),
    [["a.png", "image/png"], ["b.pdf", "application/pdf"]]);
  assert.ok(files.every((file) => existsSync(file.path)));
  task.progress.state = f.State.COMPLETED;
  await otherProcess.reconcileQueue(f.context);
  assert.equal((await queue.queueStatus(f.context)).count, 0);
  assert.ok(files.every((file) => !existsSync(file.path)));
});

test("failed background upload survives restart and explicit retry reuses its dedupe key", async (t) => {
  const f = fixture(t); const queue = f.load("./QueueService");
  const path = join(f.root, "large.bin"); writeFileSync(path, "payload");
  await queue.enqueue(f.context, "retry-key", "upload", "", [{ path, filename: "large.bin", mimeType: "application/octet-stream" }]);
  await queue.processQueue(f.context);
  const first = [...f.tasks.values()][0]; first.progress.state = f.State.FAILED;
  const restarted = f.newProcess()("./QueueService");
  await restarted.reconcileQueue(f.context);
  assert.equal((await restarted.queueStatus(f.context)).count, 1);
  assert.match((await restarted.listQueue(f.context))[0].status, /失败/);
  await restarted.retryQueueItem(f.context, "retry-key");
  const second = [...f.tasks.values()][0];
  assert.notEqual(second.tid, first.tid);
  assert.equal(second.config.data.find((part) => part.name === "dedupeKey").value, "retry-key");
  assert.equal(existsSync(path), true);
});

test("cancel failure retains queue and files, restart finishes the recorded cancellation", async (t) => {
  const f = fixture(t); const queue = f.load("./QueueService");
  const path = join(f.root, "cancel.bin"); writeFileSync(path, "keep until stopped");
  await queue.enqueue(f.context, "cancel", "upload", "", [{ path, filename: "cancel.bin", mimeType: "application/octet-stream" }]);
  await queue.processQueue(f.context);
  f.state.agentRemoveError = new Error("service unavailable");
  await assert.rejects(queue.removeQueueItem(f.context, "cancel"), /service unavailable/);
  assert.equal(JSON.parse(f.store.get("queue"))[0].cancelRequested, true);
  assert.equal(existsSync(path), true);
  f.state.agentRemoveError = undefined;
  await f.newProcess()("./QueueService").reconcileQueue(f.context);
  assert.equal((await queue.queueStatus(f.context)).count, 0);
  assert.equal(f.tasks.size, 0);
  assert.equal(existsSync(path), false);
});

test("deleting a pending snapshot item prevents its dispatch; active text cannot be deleted mid-request", async (t) => {
  const f = fixture(t); const queue = f.load("./QueueService");
  const entered = deferred(); const release = deferred();
  await queue.enqueue(f.context, "sending", "text", "one");
  await queue.enqueue(f.context, "remove-next", "text", "two");
  f.state.respond = async () => { entered.resolve(); await release.promise; return { responseCode: 201 }; };
  const processing = queue.processQueue(f.context);
  await entered.promise;
  const otherProcess = f.newProcess()("./QueueService");
  await assert.rejects(otherProcess.removeQueueItem(f.context, "sending"), /处理中/);
  await otherProcess.removeQueueItem(f.context, "remove-next");
  release.resolve(); await processing;
  assert.equal(f.requests.length, 1);
  assert.equal((await queue.queueStatus(f.context)).count, 0);
});

test("failed persistence never starts an untracked upload or deletes its source", async (t) => {
  const f = fixture(t); const queue = f.load("./QueueService");
  const path = join(f.root, "retain.bin"); writeFileSync(path, "retain");
  await queue.enqueue(f.context, "persist", "upload", "", [{ path, filename: "retain.bin", mimeType: "application/octet-stream" }]);
  f.state.beforePut = async (key, value) => { if (key === "queue" && JSON.parse(value)[0]?.agentId) throw new Error("disk full"); };
  await assert.rejects(queue.processQueue(f.context), /disk full/);
  assert.equal(f.agentCalls.filter(([action]) => action === "start").length, 0);
  assert.equal(f.tasks.size, 0);
  assert.equal(JSON.parse(f.store.get("queue"))[0].agentId, undefined);
  assert.equal(existsSync(path), true);
});

test("paused upload continues with the same task and automatic reconciliation does not resume it", async (t) => {
  const f = fixture(t); const queue = f.load("./QueueService");
  await queue.enqueue(f.context, "pause", "upload", "", [{ path: join(f.root, "x"), filename: "x", mimeType: "text/plain" }]);
  await queue.processQueue(f.context);
  const task = [...f.tasks.values()][0];
  await queue.pauseQueueItem(f.context, "pause");
  await queue.reconcileQueue(f.context);
  assert.equal(task.progress.state, f.State.PAUSED);
  await queue.retryQueueItem(f.context, "pause");
  assert.equal(task.progress.state, f.State.RUNNING);
  assert.equal(f.tasks.size, 1);
});

test("native downloads reject arbitrary URLs and paths, deduplicate taps, preserve authenticated origin", async (t) => {
  const f = fixture(t); const downloads = f.load("./NativeDownloads");
  for (const id of ["../secret", "https://evil.invalid/a", "x?redirect=https://evil.invalid", "a%2fb"]) {
    await assert.rejects(downloads.prepareDownload(f.context, id, "file", "text/plain", 4), /无效/);
  }
  assert.equal(f.tasks.size, 0);
  const ids = await Promise.all([
    downloads.prepareDownload(f.context, "attachment-1", "../../file.pdf", "application/pdf", 4),
    downloads.prepareDownload(f.context, "attachment-1", "../../file.pdf", "application/pdf", 4),
  ]);
  assert.equal(ids[0], ids[1]); assert.equal(f.tasks.size, 1);
  const task = [...f.tasks.values()][0];
  assert.equal(task.config.url, "https://server.invalid/api/attachments/attachment-1/raw");
  assert.equal(task.config.headers.Authorization, "Bearer device-token");
  assert.equal(task.config.redirect, false);
  assert.equal(task.config.mode, 0);
  assert.ok(task.config.saveas.startsWith(join(f.root, "received-transfers", ids[0]) + "/"));
  assert.equal(task.config.saveas.split("/").at(-1), ".._.._file.pdf");
});

test("completed download survives restart; only verified local bytes are offered to Share Kit", async (t) => {
  const f = fixture(t); const downloads = f.load("./NativeDownloads");
  const id = await downloads.prepareDownload(f.context, "pdf-1", "报告.pdf", "application/pdf", 4);
  const task = [...f.tasks.values()][0];
  writeFileSync(task.config.saveas, "data"); task.progress.state = f.State.COMPLETED;
  const restarted = f.newProcess()("./NativeDownloads");
  await restarted.refreshDownloads(f.context);
  assert.equal((await restarted.listDownloads(f.context))[0].ready, true);
  await restarted.shareDownload(f.context, id);
  assert.equal(f.state.shared.utd, "com.adobe.pdf");
  assert.equal(f.state.shared.uri, "file://test" + task.config.saveas);
  assert.equal(f.state.shared.title, "报告.pdf");
  assert.equal(existsSync(task.config.saveas), true);
  await assert.rejects(restarted.removeDownload(f.context, id), /关闭分享/);
});

test("truncated download remains retryable and is never shared", async (t) => {
  const f = fixture(t); const downloads = f.load("./NativeDownloads");
  const id = await downloads.prepareDownload(f.context, "truncated", "large.pdf", "application/pdf", 1000);
  const task = [...f.tasks.values()][0];
  writeFileSync(task.config.saveas, "short"); task.progress.state = f.State.COMPLETED;
  await downloads.refreshDownloads(f.context);
  assert.equal((await downloads.listDownloads(f.context))[0].ready, false);
  assert.match((await downloads.listDownloads(f.context))[0].status, /大小不一致/);
  await assert.rejects(downloads.shareDownload(f.context, id), /尚未下载完成/);
  assert.equal(f.state.shared, undefined);
  await downloads.retryDownload(f.context, id);
  assert.equal(f.tasks.size, 1);
  assert.notEqual([...f.tasks.keys()][0], task.tid);
});

test("download removal preserves its file until system cancellation succeeds", async (t) => {
  const f = fixture(t); const downloads = f.load("./NativeDownloads");
  const id = await downloads.prepareDownload(f.context, "cancel-download", "file.pdf", "application/pdf", 4);
  const task = [...f.tasks.values()][0]; writeFileSync(task.config.saveas, "part");
  f.state.agentRemoveError = new Error("service unavailable");
  await assert.rejects(downloads.removeDownload(f.context, id));
  assert.equal(existsSync(task.config.saveas), true);
  f.state.agentRemoveError = undefined;
  await f.newProcess()("./NativeDownloads").refreshDownloads(f.context);
  assert.equal((await downloads.listDownloads(f.context)).length, 0);
  assert.equal(existsSync(task.config.saveas), false);
});

test("bridge allowlist names the configured scheme, host, and effective port", (t) => {
  const f = fixture(t);
  const bridge = f.load("./NativeBridge");
  const permission = JSON.parse(bridge.bridgePermission("http://192.168.144.1:8799"));
  assert.deepEqual(permission.javascriptProxyPermission.urlPermissionList,
    [{ scheme: "http", host: "192.168.144.1", port: "8799", path: "/" }]);
  assert.equal(JSON.parse(bridge.bridgePermission("https://example.invalid")).javascriptProxyPermission.urlPermissionList[0].port, "443");
  assert.throws(() => bridge.bridgePermission("file:///etc/passwd"), /无效/);
  assert.throws(() => bridge.bridgePermission("https://user:password@example.invalid"), /无效/);
});

test("native bridge rejects calls after navigation to another origin", async (t) => {
  const f = fixture(t); const { NativeBridge } = f.load("./NativeBridge");
  const previous = globalThis.AppStorage;
  globalThis.AppStorage = { get: () => true };
  t.after(() => { globalThis.AppStorage = previous; });
  const bridge = new NativeBridge(f.context, { getUrl: () => "https://evil.invalid" }, async () => { throw new Error("must not navigate"); });
  await assert.rejects(bridge.shareAttachment("file-1", "file.pdf", "application/pdf", 4), /首页/);
  assert.equal(f.tasks.size, 0);
});

test("recovery does not redispatch failed text every time progress is refreshed", async (t) => {
  const f = fixture(t); const queue = f.load("./QueueService");
  await queue.enqueue(f.context, "bad-text", "text", "bad");
  f.state.respond = async () => ({ responseCode: 413 });
  await queue.processQueue(f.context);
  await queue.reconcileQueue(f.context);
  await queue.reconcileQueue(f.context);
  assert.equal(f.requests.length, 1);
});

test("completed downloads with a missing local file remain visible for retry", async (t) => {
  const f = fixture(t); const downloads = f.load("./NativeDownloads");
  await downloads.prepareDownload(f.context, "lost-file", "file.pdf", "application/pdf", 4);
  [...f.tasks.values()][0].progress.state = f.State.COMPLETED;
  await downloads.refreshDownloads(f.context);
  const row = (await downloads.listDownloads(f.context))[0];
  assert.equal(row.ready, false);
  assert.match(row.status, /副本不可用/);
});

test("download filenames stay within the local UTF-8 name limit and retain their extension", (t) => {
  const f = fixture(t); const { safeFilename } = f.load("./NativeDownloads");
  const name = safeFilename("报告".repeat(100) + ".pdf");
  assert.ok(Buffer.byteLength(name, "utf8") <= 255);
  assert.ok(name.endsWith(".pdf"));
  assert.equal(safeFilename(".."), "attachment");
});

test("native tools menu requires the configured origin and foreground app", async (t) => {
  const f = fixture(t);
  const { NativeBridge } = f.load("./NativeBridge");
  const previous = globalThis.AppStorage;
  let foreground = true;
  let current = f.state.server;
  let opened = 0;
  globalThis.AppStorage = { get: () => foreground };
  t.after(() => { globalThis.AppStorage = previous; });
  const bridge = new NativeBridge(f.context, { getUrl: () => current }, async () => {}, () => { opened++; });
  assert.equal(await bridge.openTools(), "opened");
  current = "https://evil.invalid";
  await assert.rejects(bridge.openTools(), /首页/);
  current = f.state.server; foreground = false;
  await assert.rejects(bridge.openTools(), /首页/);
  assert.equal(opened, 1);
});
