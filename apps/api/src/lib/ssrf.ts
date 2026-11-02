import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import ipaddr from "ipaddr.js";

export class SsrfError extends Error {}

export function isBlockedIp(address: string): boolean {
  try {
    return ipaddr.process(address).range() !== "unicast";
  } catch {
    return true;
  }
}

/** Resolve and validate the complete address set for one request hop. */
export async function assertSafeUrl(raw: string): Promise<{ url: URL; addresses: Array<{ address: string; family: number }> }> {
  let url: URL;
  try { url = new URL(raw); } catch { throw new SsrfError("invalid url"); }
  if ((url.protocol !== "http:" && url.protocol !== "https:") || !url.hostname || url.username || url.password || url.hostname.includes("%")) {
    throw new SsrfError("invalid target");
  }
  url.hash = "";
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const family = isIP(host);
  const addresses = family ? [{ address: host, family }] : await lookup(host, { all: true });
  if (!addresses.length || addresses.some(({ address }) => isBlockedIp(address))) throw new SsrfError("blocked address");
  return { url, addresses };
}
