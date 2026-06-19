import { Readable } from "node:stream";
import { Hono } from "hono";
import type { Context } from "hono";
import { readStream } from "../lib/storage.js";
import * as svc from "../services/attachments.js";

export const attachmentsRoute = new Hono();

/** RFC 5987 文件名编码（兼容中文名）。 */
function contentDisposition(name: string, inline: boolean): string {
  const ascii = name.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "'");
  const encoded = encodeURIComponent(name);
  return `${inline ? "inline" : "attachment"}; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

function streamFile(c: Context, storageKey: string, mime: string, disposition?: string) {
  const web = Readable.toWeb(readStream(storageKey) as Readable) as ReadableStream;
  c.header("content-type", mime);
  c.header("cache-control", "private, max-age=31536000, immutable");
  if (disposition) c.header("content-disposition", disposition);
  return c.body(web);
}

/** 原文件：默认 inline（图片可直接预览），?download=1 强制下载。 */
attachmentsRoute.get("/:id/raw", (c) => {
  const a = svc.getAttachment(c.req.param("id"));
  if (!a) return c.json({ error: "not_found" }, 404);
  const download = c.req.query("download") === "1";
  const inline = !download && a.mimeType.startsWith("image/");
  return streamFile(c, a.storageKey, a.mimeType, contentDisposition(a.filename, inline));
});

/** 缩略图（图片）；无缩略图时回退原图。 */
attachmentsRoute.get("/:id/thumb", (c) => {
  const a = svc.getAttachment(c.req.param("id"));
  if (!a) return c.json({ error: "not_found" }, 404);
  if (a.thumbKey) return streamFile(c, a.thumbKey, "image/webp");
  return streamFile(c, a.storageKey, a.mimeType);
});

attachmentsRoute.delete("/:id", async (c) =>
  (await svc.deleteAttachment(c.req.param("id")))
    ? c.body(null, 204)
    : c.json({ error: "not_found" }, 404),
);
