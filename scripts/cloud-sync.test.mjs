import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const script = fileURLToPath(new URL("./cloud-sync.sh", import.meta.url));

function git(cwd, ...args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "cloud-sync-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const remote = join(root, "remote");
  const seed = join(root, "seed");
  const checkout = join(root, "checkout");
  git(root, "init", "--bare", "--initial-branch=main", remote);
  git(root, "clone", remote, seed);
  git(seed, "config", "user.name", "Test Fixture");
  git(seed, "config", "user.email", "fixture@example.invalid");
  writeFileSync(join(seed, "file.txt"), "baseline");
  git(seed, "add", ".");
  git(seed, "commit", "-m", "baseline");
  git(seed, "push", "origin", "main");
  git(root, "clone", remote, checkout);
  const baseline = git(checkout, "rev-parse", "HEAD");
  writeFileSync(join(seed, "file.txt"), "remote update");
  git(seed, "commit", "-am", "remote update");
  git(seed, "push", "origin", "main");
  const latest = git(seed, "rev-parse", "HEAD");
  return { checkout, baseline, latest };
}

function sync(checkout) {
  const result = spawnSync("bash", [script, checkout], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}

for (const branch of ["main", "work"]) {
  test("fast-forwards a clean " + branch + " checkout", (t) => {
    const { checkout, latest } = fixture(t);
    if (branch === "work") git(checkout, "switch", "-c", "work");
    sync(checkout);
    assert.equal(git(checkout, "rev-parse", "HEAD"), latest);
    assert.equal(git(checkout, "branch", "--show-current"), branch);
  });
}

for (const filename of ["file.txt", "untracked.txt"]) {
  test("preserves local changes in " + filename, (t) => {
    const { checkout, baseline } = fixture(t);
    writeFileSync(join(checkout, filename), "local work");
    assert.match(sync(checkout), /Local changes/);
    assert.equal(git(checkout, "rev-parse", "HEAD"), baseline);
    assert.ok(git(checkout, "status", "--porcelain").length > 0);
  });
}

test("preserves diverging local commits", (t) => {
  const { checkout } = fixture(t);
  git(checkout, "config", "user.name", "Test Fixture");
  git(checkout, "config", "user.email", "fixture@example.invalid");
  writeFileSync(join(checkout, "local.txt"), "local commit");
  git(checkout, "add", ".");
  git(checkout, "commit", "-m", "local work");
  const head = git(checkout, "rev-parse", "HEAD");
  assert.match(sync(checkout), /Local commits differ/);
  assert.equal(git(checkout, "rev-parse", "HEAD"), head);
});

test("preserves a feature branch and detached HEAD", (t) => {
  const { checkout, baseline } = fixture(t);
  git(checkout, "switch", "-c", "feature");
  assert.match(sync(checkout), /Keeping task branch/);
  assert.equal(git(checkout, "rev-parse", "HEAD"), baseline);
  git(checkout, "checkout", "--detach");
  assert.match(sync(checkout), /Keeping task branch/);
  assert.equal(git(checkout, "rev-parse", "HEAD"), baseline);
});
