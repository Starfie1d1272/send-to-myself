import type { Attachment } from "@sendtomyself/shared";
import {
  attachmentDownloadUrl,
  attachmentRawUrl,
  attachmentThumbUrl,
} from "../lib/api";
import { formatSize } from "../lib/format";
import { IconDownload, IconFile, IconShare } from "./icons";

const isImage = (a: Attachment) => a.mimeType.startsWith("image/");

/** 移动端系统分享：优先分享文件本体，回退分享链接（SPEC §8）。 */
async function share(a: Attachment) {
  const url = new URL(attachmentRawUrl(a.id), location.origin).toString();
  try {
    const nav = navigator as Navigator & {
      canShare?: (d: unknown) => boolean;
    };
    if (nav.share) {
      const res = await fetch(attachmentRawUrl(a.id), { credentials: "include" });
      const blob = await res.blob();
      const file = new File([blob], a.filename, { type: a.mimeType });
      if (nav.canShare?.({ files: [file] })) {
        await nav.share({ files: [file], title: a.filename });
        return;
      }
      await nav.share({ url, title: a.filename });
      return;
    }
  } catch {
    /* 用户取消或不支持，忽略 */
  }
  window.open(attachmentDownloadUrl(a.id), "_blank");
}

export function Attachments({ items }: { items: Attachment[] }) {
  if (items.length === 0) return null;
  const images = items.filter(isImage);
  const files = items.filter((a) => !isImage(a));

  return (
    <div className="att">
      {images.length > 0 && (
        <div className={`att__grid att__grid--${Math.min(images.length, 3)}`}>
          {images.map((a) => (
            <a
              key={a.id}
              className="att__img"
              href={attachmentRawUrl(a.id)}
              target="_blank"
              rel="noreferrer"
            >
              <img src={attachmentThumbUrl(a.id)} alt={a.filename} loading="lazy" />
            </a>
          ))}
        </div>
      )}

      {files.map((a) => (
        <div className="att__file" key={a.id}>
          <span className="att__file-icon">
            <IconFile width={18} height={18} />
          </span>
          <div className="att__file-info">
            <span className="att__file-name">{a.filename}</span>
            <span className="att__file-size">{formatSize(a.size)}</span>
          </div>
          <div className="att__file-actions">
            <a
              className="icon-btn"
              href={attachmentDownloadUrl(a.id)}
              title="下载"
              download={a.filename}
            >
              <IconDownload width={17} height={17} />
            </a>
            <button className="icon-btn" title="分享" onClick={() => share(a)}>
              <IconShare width={17} height={17} />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
