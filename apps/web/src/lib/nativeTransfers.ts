import { getNativeBridge } from "./nativeBridge";

export function canOpenNativeTransfers() {
  const b = getNativeBridge();
  return typeof b?.openTransfers === "function" || typeof b?.openTools === "function";
}
export async function openNativeTransfers() {
  const b = getNativeBridge();
  if (b?.openTransfers) await b.openTransfers();
  else if (b?.openTools) await b.openTools();
  else throw new Error("unavailable");
}
