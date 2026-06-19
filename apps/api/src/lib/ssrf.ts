import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/**
 * SSRF 防护（SPEC §7）：服务端代抓任意 URL 是经典攻击面。
 * 禁止解析到内网/保留地址，仅允许 http/https。
 */

/** 私有/保留 IPv4 段判断。 */
function isPrivateV4(ip: string): boolean {
  const p = ip.split(".").map(Number);
  if (p.length !== 4 || p.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return true;
  const [a = 0, b = 0] = p;
  if (a === 0) return true; // 0.0.0.0/8
  if (a === 10) return true; // 10/8
  if (a === 127) return true; // loopback
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64/10
  if (a === 169 && b === 254) return true; // link-local
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16/12
  if (a === 192 && b === 168) return true; // 192.168/16
  if (a === 192 && b === 0) return true; // 192.0.0/24 等
  if (a >= 224) return true; // 组播/保留
  return false;
}

/** 私有/保留 IPv6 段判断（含 IPv4-mapped）。 */
function isPrivateV6(ip: string): boolean {
  const s = ip.toLowerCase();
  if (s === "::1" || s === "::") return true;
  if (s.startsWith("fe80")) return true; // link-local
  if (s.startsWith("fc") || s.startsWith("fd")) return true; // unique-local fc00::/7
  if (s.startsWith("::ffff:")) {
    const v4 = s.slice(7);
    if (isIP(v4) === 4) return isPrivateV4(v4);
  }
  return false;
}

function isBlockedIp(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) return isPrivateV4(ip);
  if (v === 6) return isPrivateV6(ip);
  return true; // 非法 IP，保守拒绝
}

export class SsrfError extends Error {}

/**
 * 校验单个 URL 安全：协议白名单 + DNS 解析后逐地址校验。
 * 通过返回解析后的 URL 对象；不通过抛 SsrfError。
 */
export async function assertSafeUrl(raw: string): Promise<URL> {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new SsrfError("invalid url");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new SsrfError("protocol not allowed");
  }
  const host = u.hostname;
  // 字面量 IP 直接判
  if (isIP(host)) {
    if (isBlockedIp(host)) throw new SsrfError("blocked ip");
    return u;
  }
  // 域名：解析全部地址，任一命中内网即拒（防 DNS rebinding 部分场景）
  const addrs = await lookup(host, { all: true });
  if (addrs.length === 0) throw new SsrfError("dns empty");
  for (const a of addrs) {
    if (isBlockedIp(a.address)) throw new SsrfError("resolves to private");
  }
  return u;
}

export const __test = { isPrivateV4, isPrivateV6, isBlockedIp };
