import { createReadStream } from "node:fs";
import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, extname, join, normalize, resolve, sep } from "node:path";
import { env } from "../env.js";
import { newId } from "./id.js";

/**
 * 本地文件存储（SPEC §3, §8, §13）。
 * 对外只用相对 `storageKey`，实际位置 = STORAGE_ROOT + storageKey，
 * 便于未来切 NAS/SMB/R2/S3，零迁移成本。二进制不入库。
 */

const root = resolve(env.storageRoot);

/** storageKey → 绝对路径，并防越界（路径穿越攻击）。 */
export function resolveKey(storageKey: string): string {
  const abs = resolve(root, normalize(storageKey));
  if (abs !== root && !abs.startsWith(root + sep)) {
    throw new Error("invalid storageKey");
  }
  return abs;
}

/** 生成按年月组织的存储键：2026/06/<id>.<ext>。 */
export function makeKey(filename: string, prefix = ""): string {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  const ext = extname(filename).slice(0, 16); // 保留扩展名，限长
  return join(prefix, String(y), m, `${newId()}${ext}`).split(sep).join("/");
}

/** 写入二进制，返回 storageKey。 */
export async function putBuffer(storageKey: string, data: Buffer): Promise<void> {
  const abs = resolveKey(storageKey);
  await mkdir(dirname(abs), { recursive: true });
  await writeFile(abs, data);
}

/** 读取为可流式响应的 Node ReadStream。 */
export function readStream(storageKey: string): NodeJS.ReadableStream {
  return createReadStream(resolveKey(storageKey));
}

export async function exists(storageKey: string): Promise<boolean> {
  try {
    await stat(resolveKey(storageKey));
    return true;
  } catch {
    return false;
  }
}

/** 删除文件（不存在时静默）。 */
export async function remove(storageKey: string): Promise<void> {
  await rm(resolveKey(storageKey), { force: true });
}

export const storage = { root, resolveKey, makeKey, putBuffer, readStream, exists, remove };
