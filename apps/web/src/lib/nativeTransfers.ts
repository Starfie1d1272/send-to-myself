import type { DetectionContext } from "@sendtomyself/shared";
import { getNativeBridge } from "./nativeBridge";

type UploadStatus = "queued" | "cancelled" | "not_queued" | "unknown" | "accepted";
interface Result { status: UploadStatus; dedupeKey: string; serverOrigin: string; reason?: string }
function parse(value: string, key: string, allowed: UploadStatus[]): Result {
  const result: unknown = JSON.parse(value);
  if (!result || typeof result !== "object") throw new Error("invalid receipt");
  const data = result as Result;
  if (!allowed.includes(data.status) || data.dedupeKey !== key || data.serverOrigin !== window.location.origin) throw new Error("invalid receipt");
  return data;
}
export function canOpenNativeUpload() { const b = getNativeBridge(); return typeof b?.openUpload === "function" && typeof b.getUploadReceipt === "function"; }
export async function openNativeUpload(content: string, key: string, context?: DetectionContext) {
  const bridge = getNativeBridge(); if (!bridge?.openUpload || !bridge.getUploadReceipt) throw new Error("unavailable");
  return parse(await bridge.openUpload(content, key, context ? JSON.stringify(context) : undefined), key, ["queued", "cancelled", "not_queued", "unknown"]);
}
export async function readNativeUploadReceipt(key: string) {
  const bridge = getNativeBridge(); if (!bridge?.getUploadReceipt) throw new Error("unavailable");
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const value = await Promise.race([bridge.getUploadReceipt(key), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("timeout")), 2000); })]);
    return parse(value, key, ["accepted", "unknown"]);
  } finally { clearTimeout(timer); }
}
export function canOpenNativeTransfers() { const b = getNativeBridge(); return typeof b?.openTransfers === "function" || typeof b?.openTools === "function"; }
export async function openNativeTransfers() { const b = getNativeBridge(); if (b?.openTransfers) await b.openTransfers(); else if (b?.openTools) await b.openTools(); else throw new Error("unavailable"); }
