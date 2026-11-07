export interface NativeBridge {
  openUpload?: (
    content: string,
    dedupeKey: string,
    detectionContextJson?: string,
  ) => Promise<string>;
  getUploadReceipt?: (dedupeKey: string) => Promise<string>;
  openTransfers?: () => Promise<string>;
  openTools?: () => Promise<string>;
  reauthenticate?: () => Promise<string>;
  logout?: () => Promise<string>;
  shareAttachment?: (
    id: string,
    filename: string,
    mimeType: string,
    size: number,
  ) => Promise<string>;
  saveAttachment?: (
    id: string,
    filename: string,
    mimeType: string,
    size: number,
  ) => Promise<string>;
}
export function getNativeBridge(): NativeBridge | undefined {
  return (window as Window & { stmNative?: NativeBridge }).stmNative;
}
export function hasNativeAuth(): boolean {
  const bridge = getNativeBridge();
  return typeof bridge?.reauthenticate === "function" && typeof bridge.logout === "function";
}
