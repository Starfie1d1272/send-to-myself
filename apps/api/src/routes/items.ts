import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { createItemInput, updateItemInput } from "@sendtomyself/shared";
import { env } from "../env.js";
import type { IncomingFile } from "../services/attachments.js";
import * as svc from "../services/items.js";

export const itemsRoute = new Hono();

const bool = (v: string | undefined): boolean | undefined =>
  v === undefined ? undefined : v === "true" || v === "1";

// 发送（不分类，仅正文；附件走 /upload）
itemsRoute.post("/", zValidator("json", createItemInput), (c) =>
  c.json(svc.createItem(c.req.valid("json")), 201),
);

// 带附件发送（multipart：content 文本 + 一个或多个 files，SPEC §8, §10）
itemsRoute.post("/upload", async (c) => {
  const body = await c.req.parseBody({ all: true });
  const content = typeof body.content === "string" ? body.content : "";

  const raw = body.files ?? body["files[]"] ?? body.file;
  const blobs = (Array.isArray(raw) ? raw : [raw]).filter(
    (f): f is File => f instanceof File,
  );
  if (blobs.length === 0 && !content.trim()) {
    return c.json({ error: "empty" }, 400);
  }

  const files: IncomingFile[] = [];
  for (const b of blobs) {
    if (b.size > env.maxUploadBytes) {
      return c.json({ error: "file_too_large", limit: env.maxUploadBytes, filename: b.name }, 413);
    }
    files.push({
      filename: b.name || "file",
      mimeType: b.type || "application/octet-stream",
      data: Buffer.from(await b.arrayBuffer()),
    });
  }

  const item = await svc.createItemWithFiles(content, files);
  return c.json(item, 201);
});

// 时间线 / 搜索 / 筛选（游标分页）
itemsRoute.get("/", (c) => {
  const q = c.req.query();
  return c.json(
    svc.listItems({
      kind: q.kind as svc.ListFilter["kind"],
      category: q.category as svc.ListFilter["category"],
      isTodo: bool(q.isTodo),
      completed: bool(q.completed),
      pinned: bool(q.pinned),
      sensitive: bool(q.sensitive),
      q: q.q,
      cursor: q.cursor,
      limit: q.limit ? Number(q.limit) : undefined,
      deleted: bool(q.deleted) ?? false,
    }),
  );
});

itemsRoute.get("/:id", (c) => {
  const item = svc.getItem(c.req.param("id"));
  return item ? c.json(item) : c.json({ error: "not_found" }, 404);
});

itemsRoute.patch("/:id", zValidator("json", updateItemInput), (c) => {
  const item = svc.updateItem(c.req.param("id"), c.req.valid("json"));
  return item ? c.json(item) : c.json({ error: "not_found" }, 404);
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
