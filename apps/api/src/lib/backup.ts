import { createHash } from "node:crypto";
import { lstat, readFile, writeFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import Database from "better-sqlite3";

type StoredFile = { key: string; size: number; sha256: string };
function checkedPath(root: string, key: string): string {
  const path = resolve(root, key);
  if (!path.startsWith(resolve(root) + sep)) throw new Error(`Invalid storage key: ${key}`);
  return path;
}
async function fingerprint(root: string, key: string): Promise<StoredFile> {
  const path = checkedPath(root, key);
  if (!(await lstat(path)).isFile()) throw new Error(`Not a regular attachment: ${key}`);
  const data = await readFile(path);
  return { key, size: data.length, sha256: createHash("sha256").update(data).digest("hex") };
}
function inspect(db: Database.Database) {
  if (db.pragma("integrity_check", { simple: true }) !== "ok") throw new Error("Database integrity check failed");
  if ((db.pragma("foreign_key_check") as unknown[]).length) throw new Error("Database foreign key check failed");
  const items = db.prepare("SELECT * FROM items").all() as Array<{ id: string; purge_started_at?: number | null }>;
  const purging = new Set(items.filter(item => item.purge_started_at != null).map(item => item.id));
  const attachments = db.prepare("SELECT * FROM attachments").all() as Array<{ item_id: string; storage_key: string; thumb_key: string | null; size: number }>;
  return { items, attachments, purging };
}

async function fingerprintIfPresent(root: string, key: string, allowMissing: boolean): Promise<StoredFile | undefined> {
  try { return await fingerprint(root, key); }
  catch (error) { if (allowMissing && (error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
}

/** Caller stops writers while the snapshot and its attachment archive are made. */
export async function snapshot(dbPath: string, destination: string, uploads: string): Promise<void> {
  const source = new Database(dbPath, { readonly: true, fileMustExist: true });
  try { await source.backup(resolve(destination, "app.db")); }
  finally { source.close(); }
  const db = new Database(resolve(destination, "app.db"), { fileMustExist: true });
  // 便携快照不依赖 WAL/SHM，亦可在只读介质上校验。
  try {
    db.pragma("journal_mode = DELETE");
    const data = inspect(db);
    const files: StoredFile[] = [];
    for (const attachment of data.attachments) {
      const file = await fingerprintIfPresent(uploads, attachment.storage_key, data.purging.has(attachment.item_id));
      if (file && file.size !== attachment.size) throw new Error(`Attachment size mismatch: ${file.key}`);
      if (file) files.push(file);
      const thumb = attachment.thumb_key && await fingerprintIfPresent(uploads, attachment.thumb_key, data.purging.has(attachment.item_id));
      if (thumb) files.push(thumb);
    }
    await writeFile(resolve(destination, "manifest.json"), JSON.stringify({ version: 1, files }, null, 2));
    await writeFile(resolve(destination, "export.json"), JSON.stringify({ exportedAt: new Date().toISOString(), items: data.items, attachments: data.attachments }, null, 2));
  } finally { db.close(); }
}

/** Also supports historical backups without manifests, checking every referenced file. */
export async function verifyBackup(directory: string, uploads: string): Promise<void> {
  const db = new Database(resolve(directory, "app.db"), { readonly: true, fileMustExist: true });
  try {
    const { attachments, purging } = inspect(db);
    const actual = new Map<string, StoredFile>();
    for (const attachment of attachments) {
      const file = await fingerprintIfPresent(uploads, attachment.storage_key, purging.has(attachment.item_id));
      if (file && file.size !== attachment.size) throw new Error(`Attachment size mismatch: ${file.key}`);
      if (file) actual.set(file.key, file);
      if (attachment.thumb_key) {
        const thumb = await fingerprintIfPresent(uploads, attachment.thumb_key, purging.has(attachment.item_id));
        if (thumb) actual.set(thumb.key, thumb);
      }
    }
    let manifest: { version: number; files: StoredFile[] };
    try { manifest = JSON.parse(await readFile(resolve(directory, "manifest.json"), "utf8")); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    if (manifest.version !== 1 || !Array.isArray(manifest.files) || manifest.files.length !== actual.size) {
      throw new Error("Invalid backup manifest");
    }
    for (const file of manifest.files) {
      const found = actual.get(file.key);
      if (!found || found.size !== file.size || found.sha256 !== file.sha256) {
        throw new Error(`Attachment checksum mismatch: ${file.key}`);
      }
      actual.delete(file.key);
    }
    if (actual.size) throw new Error("Incomplete backup manifest");
  } finally { db.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [command, directory, uploads] = process.argv.slice(2);
  if (!directory || !uploads) throw new Error("Usage: backup.ts <snapshot|verify> <backup-directory> <uploads-directory>");
  if (command === "snapshot") await snapshot(process.env.DB_PATH ?? "/data/app.db", directory, uploads);
  else if (command === "verify") await verifyBackup(directory, uploads);
  else throw new Error("Invalid backup command");
  console.log(`Backup ${command}: ok`);
}
