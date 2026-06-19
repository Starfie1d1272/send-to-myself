import { putBuffer } from "./storage.js";

/**
 * 服务端缩略图生成（SPEC §8：避免移动端时间线加载原图卡顿）。
 * sharp 为可选/best-effort：不可用或失败时返回 null，回退到原图展示。
 */

const THUMB_MAX = 480; // 缩略图最长边

export function isImageMime(mime: string): boolean {
  return /^image\/(png|jpe?g|webp|gif|avif|bmp|tiff)$/i.test(mime);
}

/** 缩略图存储键：thumbs/ 前缀 + 原键改 .webp。 */
export function thumbKey(storageKey: string): string {
  return `thumbs/${storageKey.replace(/\.[^./]+$/, "")}.webp`;
}

/**
 * 为图片生成缩略图并写入 thumbKey(storageKey)。
 * 成功返回缩略图键，失败/不支持返回 null（调用方回退原图）。
 */
export async function makeThumbnail(
  storageKey: string,
  data: Buffer,
): Promise<string | null> {
  try {
    const { default: sharp } = await import("sharp");
    const out = await sharp(data, { failOn: "none", animated: false })
      .rotate() // 依 EXIF 摆正
      .resize(THUMB_MAX, THUMB_MAX, { fit: "inside", withoutEnlargement: true })
      .webp({ quality: 78 })
      .toBuffer();
    const key = thumbKey(storageKey);
    await putBuffer(key, out);
    return key;
  } catch {
    return null;
  }
}
