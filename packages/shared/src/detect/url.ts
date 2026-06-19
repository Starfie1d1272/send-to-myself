/** URL 识别（SPEC §6）。纯规则，无网络请求。 */

// 匹配 http(s) 链接，尽量贪婪但剔除常见尾随标点。
const URL_RE = /\bhttps?:\/\/[^\s<>"')\]}，。、；！？]+/gi;

/** 从文本中抽取所有 URL（去重，去除尾随标点）。 */
export function detectUrls(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(URL_RE)) {
    const url = m[0].replace(/[.,;:!?)]+$/, "");
    if (url) out.add(url);
  }
  return [...out];
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
