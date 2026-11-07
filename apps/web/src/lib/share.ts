import type { Attachment } from "@sendtomyself/shared";
import { getNativeBridge } from "./nativeBridge";
import { attachmentRawUrl, recheckAuthOnUnauthorized } from "./api";

export type ShareResult = "shared" | "cancelled" | "unsupported" | "queued";

export function hasNativeDownload(): boolean {
  return typeof getNativeBridge()?.saveAttachment === "function";
}
export async function saveAttachment(attachment: Attachment): Promise<void> {
  const native = getNativeBridge();
  if (!native?.saveAttachment) throw new Error("原生下载不可用");
  await native.saveAttachment(
    attachment.id,
    attachment.filename,
    attachment.mimeType,
    attachment.size,
  );
}

export async function shareAttachment(attachment: Attachment): Promise<ShareResult> {
  const native = getNativeBridge();
  if (typeof native?.shareAttachment === "function") {
    await native.shareAttachment(
      attachment.id,
      attachment.filename,
      attachment.mimeType,
      attachment.size,
    );
    return "queued";
  }
  if (!navigator.share || !navigator.canShare) return "unsupported";
  try {
    const response = await fetch(attachmentRawUrl(attachment.id), { credentials: "include" });
    recheckAuthOnUnauthorized(response.status);
    if (!response.ok) throw new Error("附件读取失败");
    const file = new File([await response.blob()], attachment.filename, {
      type: attachment.mimeType,
    });
    if (!navigator.canShare({ files: [file] })) return "unsupported";
    await navigator.share({ files: [file], title: attachment.filename });
    return "shared";
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") return "cancelled";
    throw error;
  }
}
