import { useState } from "react";
import { copyImage } from "../lib/clipboard";
import { shareAttachment, saveAttachment, hasNativeDownload } from "../lib/share";
import type { Attachment } from "@sendtomyself/shared";
import {
  attachmentDownloadUrl,
  attachmentRawUrl,
  attachmentThumbUrl,
} from "../lib/api";
import { formatSize } from "../lib/format";
import { IconFile } from "./icons";
import { Lightbox } from "./Lightbox";

const isImage = (a: Attachment) => a.mimeType.startsWith("image/");

export function Attachments({ items }: { items: Attachment[] }) {
  // 当前在看大图的原图 URL；null=未打开。单 WebView 壳里 target="_blank" 打不开，故用壳内弹层。
  const [copied, setCopied] = useState<string | null>(null);
  const [shareError, setShareError] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const download = async (attachment: Attachment) => {
    if (busyId) return;
    setBusyId(attachment.id); setShareError(""); setNotice("");
    try { await saveAttachment(attachment); }
    catch { setShareError("无法开始下载，请在传输页查看或重试。"); }
    finally { setBusyId(null); }
  };
  const share = async (attachment: Attachment) => {
    if (busyId) return;
    setBusyId(attachment.id); setShareError(""); setNotice("");
    try {
      const result = await shareAttachment(attachment);
      if (result === "queued") setNotice("已加入传输，下载完成后打开系统分享。");
      if (result === "unsupported") {
        setShareError("此设备不支持直接分享文件，请下载后发送。");
      }
    } catch { setShareError("分享失败，请重试或下载后发送。"); }
    finally { setBusyId(null); }
  };
  const [viewing, setViewing] = useState<{ url: string; alt: string } | null>(null);

  if (items.length === 0) return null;
  const images = items.filter(isImage);
  const files = items.filter((a) => !isImage(a));

  return (
    <div className="att">
      {notice && <p role="status">{notice}</p>}
      {shareError && <p className="composer__error" role="alert">{shareError}</p>}
      {images.length > 0 && (
        <div className={`att__grid att__grid--${Math.min(images.length, 3)}`}>
          {images.map((a) => (
            <div key={a.id}>
            <button
              type="button"
              className="att__img"
              onClick={() => setViewing({ url: attachmentRawUrl(a.id), alt: a.filename })}
              title="查看大图"
            >
              <img src={attachmentThumbUrl(a.id)} alt={a.filename} loading="lazy" />
            </button>
            <button className="att__copy" onClick={async () => {
              setShareError(""); setCopied(null);
              if (await copyImage(attachmentRawUrl(a.id))) setCopied(a.id);
              else setShareError("图片复制失败，请更新桌面客户端或下载后使用。");
            }}>{copied === a.id ? "已复制图片" : "复制图片"}</button>
            <details><summary>更多</summary><button disabled={busyId !== null} onClick={() => share(a)}>分享图片</button></details>
            <a className="att__copy" href={attachmentDownloadUrl(a.id)} download={a.filename}
              onClick={(event) => {
                if (hasNativeDownload()) { event.preventDefault(); void download(a); }
              }}>保存图片</a>
            </div>
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
              onClick={(event) => {
                if (hasNativeDownload()) { event.preventDefault(); void download(a); }
              }}
            >
              保存
            </a>
            <details><summary>更多</summary><button disabled={busyId !== null} onClick={() => share(a)}>分享</button></details>
          </div>
        </div>
      ))}

      {viewing && (
        <Lightbox src={viewing.url} alt={viewing.alt} onClose={() => setViewing(null)} />
      )}
    </div>
  );
}
