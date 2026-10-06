import type { Attachment } from "@sendtomyself/shared";
import { attachmentRawUrl } from "./api";

export type ShareResult = "shared" | "cancelled" | "unsupported";

export async function shareAttachment(attachment: Attachment): Promise<ShareResult> {
  if (!navigator.share || !navigator.canShare) return "unsupported";
  try {
    const response = await fetch(attachmentRawUrl(attachment.id), { credentials: "include" });
    if (!response.ok) throw new Error("附件读取失败");
    const file = new File([await response.blob()], attachment.filename, { type: attachment.mimeType });
    if (!navigator.canShare({ files: [file] })) return "unsupported";
    await navigator.share({ files: [file], title: attachment.filename });
    return "shared";
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") return "cancelled";
    throw error;
  }
}
