import http, { type IncomingMessage } from "node:http";
import https from "node:https";
import type { LookupFunction } from "node:net";
import { env } from "../env.js";
import { assertSafeUrl } from "./ssrf.js";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const redirects = new Set([301, 302, 303, 307, 308]);
const referers: Array<[string, string]> = [
  ["hdslb.com", "https://www.bilibili.com/"],
  ["qpic.cn", "https://mp.weixin.qq.com/"],
];

type PreviewResource = { finalUrl: string; contentType: string; data: Buffer };

/** A single deadline covers DNS, every redirect, and the response body. */
export async function readPreviewResource(
  rawUrl: string,
  kind: "html" | "image",
): Promise<PreviewResource> {
  const controller = new AbortController();
  const deadline = performance.now() + env.previewTimeoutMs;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const scheduleDeadline = () => {
    const remaining = deadline - performance.now();
    if (remaining <= 0) controller.abort();
    else timer = setTimeout(scheduleDeadline, Math.min(remaining, 2_147_483_647));
  };
  scheduleDeadline();
  const signal = controller.signal;
  try {
    let current = rawUrl;
    for (let hop = 0; ; hop++) {
      // DNS cannot be cancelled, so race it and never continue after the deadline.
      const target = await abortable(assertSafeUrl(current), signal);
      if (signal.aborted) throw new Error("preview timeout");
      const result = await requestHop(target, kind, signal);
      if ("location" in result) {
        if (hop >= env.previewMaxRedirects) throw new Error("too many redirects");
        current = new URL(result.location, target.url).toString();
        continue;
      }
      return { ...result, finalUrl: target.url.toString() };
    }
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(new Error("preview timeout"));
    if (signal.aborted) return abort();
    signal.addEventListener("abort", abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

function requestHop(
  target: Awaited<ReturnType<typeof assertSafeUrl>>,
  kind: "html" | "image",
  signal: AbortSignal,
): Promise<{ location: string } | { contentType: string; data: Buffer }> {
  const lookup: LookupFunction = (_hostname, options, callback) => {
    const family = typeof options === "number" ? options : options.family;
    const addresses = target.addresses.filter((entry) => !family || entry.family === family);
    if (!addresses.length) {
      callback(new Error("no validated address"), "", 0);
      return;
    }
    if (typeof options !== "number" && options.all) {
      (callback as (err: NodeJS.ErrnoException | null, addresses: typeof target.addresses) => void)(
        null,
        addresses,
      );
    } else {
      callback(null, addresses[0]!.address, addresses[0]!.family);
    }
  };
  const secure = target.url.protocol === "https:";
  const agent = secure
    ? new https.Agent({ keepAlive: false, lookup })
    : new http.Agent({ keepAlive: false, lookup });
  const host = target.url.hostname;
  const ref =
    kind === "image"
      ? referers.find(([suffix]) => host === suffix || host.endsWith(`.${suffix}`))?.[1]
      : undefined;
  return new Promise((resolve, reject) => {
    let response: IncomingMessage | undefined;
    let settled = false;
    const finish = (
      error?: Error,
      value?: { location: string } | { contentType: string; data: Buffer },
    ) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      response?.destroy();
      req.destroy();
      agent.destroy();
      if (error) reject(error);
      else resolve(value!);
    };
    const onAbort = () => finish(new Error("preview timeout"));
    const req = (secure ? https : http).request(
      target.url,
      {
        method: "GET",
        agent,
        maxHeaderSize: 16 * 1024,
        headers: {
          "user-agent": UA,
          "accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
          "accept-encoding": "identity",
          accept:
            kind === "html"
              ? "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
              : "image/avif,image/webp,image/*,*/*;q=0.8",
          ...(ref ? { referer: ref } : {}),
        },
      },
      (res) => {
        response = res;
        res.on("error", (error) => finish(error));
        const status = res.statusCode ?? 0;
        if (redirects.has(status)) {
          if (!res.headers.location) return finish(new Error("missing location"));
          return finish(undefined, { location: res.headers.location });
        }
        if (status < 200 || status >= 300) return finish(new Error("http status"));
        const encoding = res.headers["content-encoding"]?.trim().toLowerCase();
        if (encoding && encoding !== "identity") return finish(new Error("unsupported encoding"));
        const contentType = res.headers["content-type"] ?? "";
        const mime = contentType.split(";", 1)[0]!.trim().toLowerCase();
        if (
          kind === "html"
            ? !["text/html", "application/xhtml+xml"].includes(mime)
            : !/^image\/[a-z0-9!#$&^_.+-]+$/.test(mime)
        )
          return finish(new Error("unsupported content type"));
        const length = Number(res.headers["content-length"]);
        if (kind === "image" && Number.isFinite(length) && length > env.previewMaxBytes)
          return finish(new Error("image too large"));
        const chunks: Buffer[] = [];
        let total = 0;
        res.on("data", (chunk: Buffer) => {
          const remaining = env.previewMaxBytes - total;
          if (kind === "image" && chunk.length > remaining)
            return finish(new Error("image too large"));
          chunks.push(chunk.subarray(0, remaining));
          total += Math.min(chunk.length, remaining);
          if (kind === "html" && total >= env.previewMaxBytes)
            finish(undefined, { contentType, data: Buffer.concat(chunks, total) });
        });
        res.on("end", () => finish(undefined, { contentType, data: Buffer.concat(chunks, total) }));
        res.on("aborted", () => finish(new Error("response aborted")));
        res.on("close", () => {
          if (!res.complete) finish(new Error("response incomplete"));
        });
      },
    );
    req.on("error", (error) => finish(error));
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) onAbort();
    else req.end();
  });
}
