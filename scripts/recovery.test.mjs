import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

function command(cwd, executable, args, success = true) {
  const result = spawnSync(executable, args, { cwd, encoding: "utf8", timeout: 120000 });
  if (success) assert.equal(result.status, 0, result.stdout + result.stderr);
  else assert.notEqual(result.status, 0, "Expected command to fail");
  return result.stdout.trim();
}
const image = process.env.RECOVERY_IMAGE ?? "send-to-myself:ci";

test("Docker backup/dry-run/restore preserve database and attachments and reject incomplete backups", { timeout: 180000 }, async (t) => {
  const root = mkdtempSync(join(tmpdir(), "stm-recovery-"));
  mkdirSync(join(root, "scripts"));
  cpSync(new URL("./backup.sh", import.meta.url), join(root, "scripts/backup.sh"));
  cpSync(new URL("./restore.sh", import.meta.url), join(root, "scripts/restore.sh"));
  writeFileSync(join(root, "compose.yaml"), `services:
  app:
    image: ${image}
    stop_grace_period: 2s
    environment:
      AUTH_PASSWORD: recovery-test-password
    ports:
      - "127.0.0.1::8787"
    volumes:
      - ./data:/data
`);
  const compose = (...args) => command(root, "docker", ["compose", ...args]);
  t.after(() => {
    command(root, "docker", ["compose", "down", "--volumes", "--remove-orphans"]);
    // 容器中的 root 创建的数据目录可能不允许宿主普通用户直接删除。
    command(root, "docker", ["run", "--rm", "--user", "0:0", "-v", `${root}:/cleanup`,
      "--entrypoint", "find", image, "/cleanup", "-mindepth", "1", "-delete"]);
    rmSync(root, { recursive: true, force: true });
  });
  compose("up", "-d");
  const address = compose("port", "app", "8787");
  let base = `http://${address}`;
  async function ready() {
    base = `http://${compose("port", "app", "8787")}`;
    for (let i = 0; i < 100; i++) {
      try { if ((await fetch(`${base}/health`, { signal: AbortSignal.timeout(1000) })).ok) return; } catch {}
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.fail("API did not become healthy: " + compose("logs", "app"));
  }
  await ready();
  const login = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ password: "recovery-test-password" }) });
  assert.equal(login.status, 200);
  const headers = { cookie: login.headers.get("set-cookie").split(";")[0] };
  function backup() {
    command(root, "bash", ["scripts/backup.sh"]);
    const backups = readdirSync(join(root, "backups")).filter((name) => !name.startsWith("."));
    return backups.map((name) => join(root, "backups", name));
  }
  const empty = backup()[0];
  await ready();
  const form = new FormData();
  form.append("content", "恢复演练");
  form.append("dedupeKey", "recovery-upload");
  form.append("files", new File(["original attachment bytes"], "中文.txt", { type: "text/plain" }));
  const uploaded = await fetch(`${base}/api/items/upload`, { method: "POST", headers, body: form });
  assert.equal(uploaded.status, 201);
  const item = await uploaded.json();
  const full = backup().find((path) => path !== empty);
  command(root, "bash", ["scripts/restore.sh", full, "--dry-run"]);
  await ready();
  const broken = join(root, "broken");
  cpSync(full, broken, { recursive: true });
  rmSync(join(broken, "uploads.tar.gz"));
  command(root, "bash", ["scripts/restore.sh", broken, "--dry-run"], false);
  assert.equal((await fetch(`${base}/api/items`, { headers })).status, 200);
  // 归档路径越界须在停服前拒绝。
  const unsafe = join(root, "unsafe");
  mkdirSync(unsafe);
  cpSync(join(full, "app.db"), join(unsafe, "app.db"));
  writeFileSync(join(unsafe, "outside.txt"), "unsafe");
  command(root, "tar", ["-czf", join(unsafe, "uploads.tar.gz"), "-C", unsafe, "outside.txt"]);
  command(root, "bash", ["scripts/restore.sh", unsafe, "--dry-run"], false);
  assert.equal((await fetch(`${base}/health`)).status, 200);
  await fetch(`${base}/api/items`, { method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify({ content: "after backup" }) });
  command(root, "bash", ["scripts/restore.sh", full]);
  await ready();
  const timeline = await (await fetch(`${base}/api/items`, { headers })).json();
  assert.deepEqual(timeline.items.map((value) => value.id), [item.id]);
  const raw = await fetch(`${base}/api/attachments/${item.attachments[0].id}/raw`, { headers });
  assert.equal(await raw.text(), "original attachment bytes");
  assert.ok(readdirSync(root).some((name) => name.startsWith("data.before-restore-")));
  // 无附件的备份也须替换 uploads，不能保留后来的文件。
  command(root, "bash", ["scripts/restore.sh", empty]);
  await ready();
  const restored = await (await fetch(`${base}/api/items`, { headers })).json();
  assert.equal(restored.items.length, 0);
  assert.deepEqual(readdirSync(join(root, "data/uploads")), []);
});
