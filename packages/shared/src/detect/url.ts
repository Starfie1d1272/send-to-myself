/** URL 识别（SPEC §6）。纯规则，无网络请求。 */

// 匹配 http(s) 链接，尽量贪婪但剔除常见尾随标点。
const URL_RE = /\bhttps?:\/\/[^\s<>"')\]}，。、；！？]+/gi;

export function extractUrlSpans(text: string): Array<{ start: number; end: number; url: string }> {
  return [...text.matchAll(URL_RE)]
    .map((match) => {
      const url = match[0].replace(/[.,;:!?)]+$/, "");
      return { start: match.index!, end: match.index! + url.length, url };
    })
    .filter((span) => span.url.length > 0);
}

export function detectUrls(text: string): string[] {
  return [...new Set(extractUrlSpans(text).map((span) => span.url))];
}

/** 内容去掉首尾空白后是否「就是一个链接」。 */
export function isPureLink(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  const urls = detectUrls(t);
  return urls.length === 1 && urls[0] === t;
}

/** 解析域名（失败返回 undefined）。 */
export function hostnameOf(url: string): string | undefined {
  try {
    return new URL(url).hostname;
  } catch {
    return undefined;
  }
}
