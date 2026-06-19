import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { createItemInput, updateItemInput } from "@sendtomyself/shared";
import * as svc from "../services/items.js";

export const itemsRoute = new Hono();

const bool = (v: string | undefined): boolean | undefined =>
  v === undefined ? undefined : v === "true" || v === "1";

// 发送（不分类，仅正文；附件后续走 multipart）
itemsRoute.post("/", zValidator("json", createItemInput), (c) =>
  c.json(svc.createItem(c.req.valid("json")), 201),
);

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
