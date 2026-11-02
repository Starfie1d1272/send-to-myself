import { eq } from "drizzle-orm";
import { detectUrls } from "@sendtomyself/shared/detect";
import type { Item, LinkPreview } from "@sendtomyself/shared";
import { db } from "../db/client.js";
import { items } from "../db/schema.js";
import { rowToItem } from "../lib/mapper.js";
import { readPreviewResource } from "../lib/preview-http.js";
import { listByItem } from "./attachments.js";

/** 抓取并解析链接预览；失败不抛，返回带 status 的结果（SPEC §7 抓取失败仍保存）。 */
export async function fetchPreview(rawUrl: string): Promise<LinkPreview> {
  const base: LinkPreview = {
    url: rawUrl,
    domain: safeDomain(rawUrl),
    status: "error",
    fetchedAt: new Date().toISOString(),
  };
  try {
    const { data, finalUrl } = await readPreviewResource(rawUrl, "html");
    const meta = parseHtml(data.toString("utf8"), finalUrl);
    return {
      ...base,
      ...meta,
      domain: safeDomain(finalUrl) ?? base.domain,
      status: "ok",
    };
  } catch {
    return base; // 失败：仅留 url/domain，前端照常展示原始链接
  }
}

/** 抓取预览并写回 item.meta.preview，返回更新后的 DTO（供广播）。 */
export async function fetchPreviewInto(itemId: string, rawUrl: string, expectedContent: string): Promise<Item | null> {
  const preview = await fetchPreview(rawUrl);
  const row = db.select().from(items).where(eq(items.id, itemId)).get();
  if (!row || row.deletedAt !== null || row.content !== expectedContent || detectUrls(row.content)[0] !== rawUrl) return null;
  const meta = row.meta ? JSON.parse(row.meta) : {};
  meta.preview = preview;
  db.update(items).set({ meta: JSON.stringify(meta) }).where(eq(items.id, itemId)).run();
  const updated = db.select().from(items).where(eq(items.id, itemId)).get()!;
  return rowToItem(updated, listByItem(itemId));
}

/** Fetch a complete image through the controlled preview transport. */
export async function fetchImage(rawUrl: string): Promise<{ data: Buffer; contentType: string } | null> {
  try {
    const { data, contentType } = await readPreviewResource(rawUrl, "image");
    return { data, contentType };
  } catch {
    return null;
  }
}

// —— HTML 解析（轻量正则，无额外依赖）——

function parseHtml(html: string, baseUrl: string): Partial<LinkPreview> {
  const head = html.slice(0, 100_000); // 只看头部，预览元数据都在 <head>
  const og = (prop: string) =>
    matchAttr(head, new RegExp(
      `<meta[^>]+(?:property|name)=["']${prop}["'][^>]*>`,
      "i",
    ));
  const title =
    og("og:title") ??
    decode(head.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim());
  const description = og("og:description") ?? metaName(head, "description");
  const image = abs(og("og:image"), baseUrl);
  const favicon = abs(findFavicon(head), baseUrl) ?? abs("/favicon.ico", baseUrl);
  return clean({ title, description, image, favicon });
}

function matchAttr(metaTag: string | undefined, re: RegExp): string | undefined {
  const tag = metaTag?.match(re)?.[0];
  if (!tag) return undefined;
  return decode(tag.match(/content=["']([^"']*)["']/i)?.[1]);
}

function metaName(head: string, name: string): string | undefined {
  const tag = head.match(new RegExp(`<meta[^>]+name=["']${name}["'][^>]*>`, "i"))?.[0];
  return decode(tag?.match(/content=["']([^"']*)["']/i)?.[1]);
}

function findFavicon(head: string): string | undefined {
  const re = /<link[^>]+rel=["'][^"']*icon[^"']*["'][^>]*>/gi;
  const tag = head.match(re)?.[0];
  return tag?.match(/href=["']([^"']*)["']/i)?.[1];
}

function abs(href: string | undefined, base: string): string | undefined {
  if (!href) return undefined;
  try {
    return new URL(href, base).toString();
  } catch {
    return undefined;
  }
}

function safeDomain(u: string): string | undefined {
  try {
    return new URL(u).hostname;
  } catch {
    return undefined;
  }
}

function decode(s: string | undefined): string | undefined {
  if (!s) return undefined;
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .trim()
    .slice(0, 500) || undefined;
}

function clean<T extends Record<string, unknown>>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v != null)) as Partial<T>;
}
