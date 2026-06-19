import { eq } from "drizzle-orm";
import type { Item, LinkPreview } from "@sendtomyself/shared";
import { db } from "../db/client.js";
import { items } from "../db/schema.js";
import { env } from "../env.js";
import { rowToItem } from "../lib/mapper.js";
import { assertSafeUrl, SsrfError } from "../lib/ssrf.js";
import { listByItem } from "./attachments.js";

// 用真实浏览器 UA：部分站点（B站/公众号等）对非浏览器 UA 返回精简页或拦截。
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const ACCEPT_LANG = "zh-CN,zh;q=0.9,en;q=0.8";

/** 抓取并解析链接预览；失败不抛，返回带 status 的结果（SPEC §7 抓取失败仍保存）。 */
export async function fetchPreview(rawUrl: string): Promise<LinkPreview> {
  const base: LinkPreview = {
    url: rawUrl,
    domain: safeDomain(rawUrl),
    status: "error",
    fetchedAt: new Date().toISOString(),
  };
  try {
    const { html, finalUrl } = await safeFetchHtml(rawUrl);
    const meta = parseHtml(html, finalUrl);
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
export async function fetchPreviewInto(itemId: string, rawUrl: string): Promise<Item | null> {
  const preview = await fetchPreview(rawUrl);
  const row = db.select().from(items).where(eq(items.id, itemId)).get();
  if (!row) return null;
  const meta = row.meta ? JSON.parse(row.meta) : {};
  meta.preview = preview;
  db.update(items).set({ meta: JSON.stringify(meta) }).where(eq(items.id, itemId)).run();
  const updated = db.select().from(items).where(eq(items.id, itemId)).get()!;
  return rowToItem(updated, listByItem(itemId));
}

/** 手动跟随重定向，每跳都过 SSRF 校验；限大小、超时、跳数、Content-Type 白名单。 */
async function safeFetchHtml(startUrl: string): Promise<{ html: string; finalUrl: string }> {
  let current = startUrl;
  for (let hop = 0; hop <= env.previewMaxRedirects; hop++) {
    await assertSafeUrl(current); // 每跳重新校验解析地址
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), env.previewTimeoutMs);
    try {
      const res = await fetch(current, {
        method: "GET",
        redirect: "manual",
        signal: ctrl.signal,
        headers: {
          "user-agent": UA,
          accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "accept-language": ACCEPT_LANG,
        },
      });

      // 重定向：取 location 继续（下一轮再校验）
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get("location");
        if (!loc) throw new SsrfError("redirect without location");
        current = new URL(loc, current).toString();
        continue;
      }
      if (!res.ok) throw new Error(`http ${res.status}`);

      const ct = res.headers.get("content-type") ?? "";
      if (!/text\/html|application\/xhtml\+xml/i.test(ct)) {
        throw new Error("unsupported content-type");
      }
      const html = await readCapped(res, env.previewMaxBytes);
      return { html, finalUrl: res.url || current };
    } finally {
      clearTimeout(timer);
    }
  }
  throw new SsrfError("too many redirects");
}

// —— 图片代理（解决图床防盗链 / 混合内容，SPEC §7）——

/** 已知图床的防盗链 Referer 映射；命中则用站点首页做 Referer，否则用图床自身 origin。 */
const IMG_REFERER: Array<[string, string]> = [
  ["hdslb.com", "https://www.bilibili.com/"], // B 站图床校验 bilibili.com Referer
];

function imageReferer(host: string): string {
  for (const [suffix, ref] of IMG_REFERER) {
    if (host === suffix || host.endsWith("." + suffix)) return ref;
  }
  return `https://${host}/`;
}

/**
 * 服务端取图：带浏览器 UA + 正确 Referer 绕过图床防盗链，手动跟随重定向并逐跳 SSRF 校验，
 * 限大小/超时。返回二进制 + content-type；任何失败返回 null（前端显示裂图占位）。
 */
export async function fetchImage(
  rawUrl: string,
): Promise<{ data: Buffer; contentType: string } | null> {
  try {
    let current = rawUrl;
    for (let hop = 0; hop <= env.previewMaxRedirects; hop++) {
      await assertSafeUrl(current);
      const host = new URL(current).hostname;
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), env.previewTimeoutMs);
      try {
        const res = await fetch(current, {
          method: "GET",
          redirect: "manual",
          signal: ctrl.signal,
          headers: {
            "user-agent": UA,
            referer: imageReferer(host),
            accept: "image/avif,image/webp,image/*,*/*;q=0.8",
            "accept-language": ACCEPT_LANG,
          },
        });
        if (res.status >= 300 && res.status < 400) {
          const loc = res.headers.get("location");
          if (!loc) return null;
          current = new URL(loc, current).toString();
          continue;
        }
        if (!res.ok) return null;
        const ct = res.headers.get("content-type") ?? "";
        if (!/^image\//i.test(ct)) return null;
        const data = await readCappedBytes(res, env.previewMaxBytes);
        return data ? { data, contentType: ct } : null;
      } finally {
        clearTimeout(timer);
      }
    }
    return null;
  } catch {
    return null;
  }
}

/** 读取二进制响应体，超过上限直接放弃（防大图耗内存）。 */
async function readCappedBytes(res: Response, maxBytes: number): Promise<Buffer | null> {
  const reader = res.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      total += value.length;
      if (total > maxBytes) {
        await reader.cancel();
        return null;
      }
    }
  }
  return Buffer.concat(chunks);
}

/** 读取响应体，超过上限即截断停止（防大响应耗内存）。 */
async function readCapped(res: Response, maxBytes: number): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      total += value.length;
      if (total >= maxBytes) {
        await reader.cancel();
        break;
      }
    }
  }
  return Buffer.concat(chunks).toString("utf8");
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
