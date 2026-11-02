import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { zValidator } from "@hono/zod-validator";
import { createItemInput, timelineFilter, updateItemInput } from "@sendtomyself/shared";
import { decodeCursor } from "../lib/cursor.js";
import { env } from "../env.js";
import type { IncomingFile } from "../services/attachments.js";
import * as svc from "../services/items.js";

export const itemsRoute = new Hono();

const bool = (v: string | undefined): boolean | undefined =>
  v === undefined ? undefined : v === "true" || v === "1";

// 发送（不分类，仅正文；附件走 /upload）
itemsRoute.post("/", zValidator("json", createItemInput), (c) => {
  try { return c.json(svc.createItem(c.req.valid("json")), 201); }
  catch (error) { if (error instanceof svc.ItemError) return c.json({ error: error.message }, 400); throw error; }
});

let activeUploads = 0;
itemsRoute.use("/upload", async (c, next) => {
  if (activeUploads >= 2) { c.header("Retry-After", "5"); return c.json({ error: "upload_busy" }, 429); }
  activeUploads++;
  try { await next(); } finally { activeUploads--; }
});
itemsRoute.use("/upload", bodyLimit({
  maxSize: env.maxUploadTotalBytes + 1024 * 1024,
  onError: (c) => c.json({ error: "upload_total_too_large", limit: env.maxUploadTotalBytes }, 413),
}));

// 带附件发送（multipart：content 文本 + 一个或多个 files，SPEC §8, §10）
itemsRoute.post("/upload", async (c) => {
  if (!/^multipart\/form-data(?:;|$)/i.test(c.req.header("content-type") ?? "")) return c.json({ error: "invalid_multipart" }, 400);
  let body;
  try { body = await c.req.parseBody({ all: true }); }
  catch { return c.json({ error: "invalid_multipart" }, 400); }
  const content = typeof body.content === "string" ? body.content : "";
  const input = createItemInput.safeParse({ content, dedupeKey: body.dedupeKey });
  if (!input.success) return c.json({ error: "invalid_input" }, 400);
  const { dedupeKey } = input.data;

  const raw = body.files ?? body["files[]"] ?? body.file;
  const blobs = (Array.isArray(raw) ? raw : [raw]).filter(
    (f): f is File => f instanceof File,
  );
  if (blobs.length === 0 && !content.trim()) {
    return c.json({ error: "empty" }, 400);
  }

  if (blobs.length > env.maxUploadFiles) return c.json({ error: "too_many_files", limit: env.maxUploadFiles }, 413);
  if (blobs.reduce((sum, file) => sum + file.size, 0) > env.maxUploadTotalBytes) return c.json({ error: "upload_total_too_large", limit: env.maxUploadTotalBytes }, 413);
  const files: IncomingFile[] = [];
  for (const b of blobs) {
    if (b.size > env.maxUploadBytes) {
      return c.json({ error: "file_too_large", limit: env.maxUploadBytes, filename: b.name }, 413);
    }
    files.push({
      filename: b.name || "file",
      mimeType: b.type || "application/octet-stream",
      size: b.size,
      read: async () => Buffer.from(await b.arrayBuffer()),
    });
  }

  const item = await svc.createItemWithFiles(content, files, dedupeKey);
  return c.json(item, 201);
});

// 时间线 / 搜索 / 筛选（游标分页）
itemsRoute.get("/", (c) => {
  const q = c.req.query();
  for (const key of ["isTodo", "completed", "pinned", "sensitive", "deleted", "hasLinks", "hasImages", "hasFiles"]) {
    if (q[key] !== undefined && !["true", "false", "1", "0"].includes(q[key]!)) {
      return c.json({ error: "invalid_query" }, 400);
    }
  }
  const parsed = timelineFilter.safeParse({
    ...q,
    limit: q.limit === undefined ? undefined : Number(q.limit),
    isTodo: bool(q.isTodo), completed: bool(q.completed), pinned: bool(q.pinned),
    hasLinks: bool(q.hasLinks), hasImages: bool(q.hasImages), hasFiles: bool(q.hasFiles),
    sensitive: bool(q.sensitive), deleted: bool(q.deleted),
  });
  if (!parsed.success) return c.json({ error: "invalid_query" }, 400);
  if (q.cursor) {
    try { decodeCursor(q.cursor); }
    catch { return c.json({ error: "invalid_cursor" }, 400); }
  }
  return c.json(svc.listItems(parsed.data));
});

itemsRoute.get("/:id", (c) => {
  const item = svc.getItem(c.req.param("id"));
  return item ? c.json(item) : c.json({ error: "not_found" }, 404);
});

itemsRoute.patch("/:id", zValidator("json", updateItemInput), (c) => {
  try {
    const item = svc.updateItem(c.req.param("id"), c.req.valid("json"));
    return item ? c.json(item) : c.json({ error: "not_found" }, 404);
  } catch (error) { if (error instanceof svc.ItemError) return c.json({ error: error.message }, 400); throw error; }
});

// 软删除
itemsRoute.delete("/:id", (c) =>
  svc.softDeleteItem(c.req.param("id"))
    ? c.body(null, 204)
    : c.json({ error: "not_found" }, 404),
);

// 从回收站恢复
itemsRoute.post("/:id/restore", (c) => {
  const item = svc.restoreItem(c.req.param("id"));
  return item ? c.json(item) : c.json({ error: "not_found" }, 404);
});

// 手动重抓链接预览
itemsRoute.post("/:id/refetch-preview", async (c) => {
  const item = await svc.refetchPreview(c.req.param("id"));
  return item ? c.json(item) : c.json({ error: "not_found" }, 404);
});
