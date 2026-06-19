import { Hono } from "hono";
import { fetchImage } from "../services/preview.js";

export const previewRoute = new Hono();

/**
 * 图片代理（SPEC §7）：前端封面/favicon 经此加载，绕过图床防盗链与混合内容。
 * 同源 + 受 requireAuth 保护（img 请求自带 session cookie）。
 */
previewRoute.get("/image", async (c) => {
  const url = c.req.query("url");
  if (!url || !/^https?:\/\//i.test(url)) return c.body(null, 400);
  const img = await fetchImage(url);
  if (!img) return c.body(null, 502);
  c.header("content-type", img.contentType);
  c.header("cache-control", "public, max-age=604800"); // 缓存一周，封面基本不变
  return c.body(new Uint8Array(img.data).buffer); // Hono 只收 ArrayBuffer
});
