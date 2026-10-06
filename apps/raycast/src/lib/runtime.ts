import { getPreferenceValues, LocalStorage, environment } from "@raycast/api";
import { randomUUID } from "node:crypto";
import { readFile, stat, mkdir, writeFile, readdir, rm } from "node:fs/promises";
import { basename, join } from "node:path";
import { lookup } from "mime-types";
import { InboxClient } from "./client";
import { sendWithRetryKey } from "./pending";

export function client() {
  const preferences = getPreferenceValues<{ serverUrl: string; deviceToken: string }>();
  return new InboxClient(preferences.serverUrl, preferences.deviceToken);
}
export async function send(content: string, paths: string[]) {
  const api = client();
  const files: File[] = [];
  let size = 0;
  for (const path of paths) {
    const info = await stat(path);
    if (!info.isFile()) throw new Error("请只选择文件，不能发送文件夹。");
    size += info.size;
    if (size > 50 * 1024 * 1024) throw new Error("一次最多发送 50 MB 文件；服务器可能有更低限制。");
    const bytes = await readFile(path);
    const name = basename(path);
    files.push(new File([bytes], name, { type: lookup(name) || "application/octet-stream" }));
  }
  return sendWithRetryKey(api, content, files, LocalStorage);
}
export async function download(id: string, filename: string): Promise<string> {
  const dir = join(environment.supportPath, "attachments");
  await mkdir(dir, { recursive: true, mode: 0o700 });
  // Files copied to the clipboard must survive command exit. Expire them after seven days.
  for (const entry of await readdir(dir)) {
    const path = join(dir, entry);
    if ((await stat(path)).mtimeMs < Date.now() - 7 * 86400_000) await rm(path, { force: true });
  }
  const blob = await client().attachment(id);
  const safeName = basename(filename).replace(/[^\p{L}\p{N}._-]/gu, "_") || "attachment";
  const path = join(dir, `${randomUUID()}-${safeName}`);
  await writeFile(path, Buffer.from(await blob.arrayBuffer()), { mode: 0o600 });
  return path;
}
