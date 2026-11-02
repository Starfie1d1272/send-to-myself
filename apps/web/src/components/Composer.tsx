import { useEffect, useRef, useState } from "react";
import { useComposer } from "../hooks/useComposer";
import { formatSize } from "../lib/format";
import { IconFile, IconImage, IconPaperclip, IconX } from "./icons";

export function Composer() {
  const { draft, change, send, ready, pending, draftError, error, notice, progress, info, badFilename, deleted, sendAsNew, stop } = useComposer();
  const value = draft.content;
  const files = draft.files;
  const [dragging, setDragging] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const previews = useRef(new Map<File, string>());
  useEffect(() => () => { for (const url of previews.current.values()) URL.revokeObjectURL(url); }, []);
  useEffect(() => {
    const focus = () => ref.current?.focus();
    window.addEventListener("send-to-myself:focus-composer", focus);
    return () => window.removeEventListener("send-to-myself:focus-composer", focus);
  }, []);
  const preview = (file: File) => {
    if (!file.type.startsWith("image/")) return undefined;
    let url = previews.current.get(file);
    if (!url) { url = URL.createObjectURL(file); previews.current.set(file, url); }
    return url;
  };
  const grow = () => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
  };

  useEffect(grow, [value]);

  const addFiles = (list: FileList | File[]) => change(value, [...files, ...Array.from(list)]);
  const removeAt = (i: number) => {
    const file = files[i]; const url = file && previews.current.get(file);
    if (url && file) { URL.revokeObjectURL(url); previews.current.delete(file); }
    change(value, files.filter((_, index) => index !== i));
  };
  const overLimit = !!info && (files.some(file => file.size > info.maxUploadBytes) || files.length > info.maxUploadFiles || files.reduce((sum, file) => sum + file.size, 0) > info.maxUploadTotalBytes);
  const canSend = (value.trim().length > 0 || files.length > 0) && !pending && ready && !overLimit && !badFilename && !deleted;

  return (
    <div
      className={`composer${dragging ? " composer--drag" : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDragging(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
      }}
    >
      <textarea
        ref={ref}
        className="composer__input"
        placeholder="写点什么，发给自己…"
        value={value}
        rows={1}
        disabled={pending || !ready}
        onChange={(e) => {
          change(e.target.value, files);
          grow();
        }}
        onPaste={(e) => {
          if (e.clipboardData.files.length) {
            e.preventDefault();
            addFiles(e.clipboardData.files);
          }
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && e.nativeEvent.keyCode !== 229) {
            e.preventDefault();
            void send();
          }
        }}
      />

      {files.length > 0 && (
        <div className="tray">
          {files.map((f, i) => (
            <div className="tray__item" key={i}>
              {preview(f) ? (
                <img src={preview(f)} alt="" className="tray__thumb" />
              ) : (
                <span className="tray__file">
                  <IconFile width={16} height={16} />
                </span>
              )}
              <div className="tray__info">
                <span className="tray__name">{f.name}</span>
                <span className="tray__size">{formatSize(f.size)}</span>
                {((info && f.size > info.maxUploadBytes) || badFilename === f.name) && <span role="alert">{info ? `超过单文件上限 ${formatSize(info.maxUploadBytes)}` : "超过单文件上限"}</span>}
              </div>
              <button className="tray__x" disabled={pending} onClick={() => removeAt(i)} aria-label="移除">
                <IconX width={13} height={13} />
              </button>
            </div>
          ))}
        </div>
      )}

      {draftError && <p className="composer__error" role="alert">草稿未能保存到本机，请勿关闭窗口。</p>}
      {error && <p className="composer__error" role="alert">{error} {deleted && <button onClick={sendAsNew}>作为新内容重新发送</button>}</p>}
      {notice && <p role="status">{notice}</p>}
      <p className="composer__hint">{info ? `单文件 ${formatSize(info.maxUploadBytes)}，总计 ${formatSize(info.maxUploadTotalBytes)}，最多 ${info.maxUploadFiles} 件` : "上传大小以 NAS 设置为准"}</p>
      {overLimit && <p className="composer__error" role="alert">附件数量或总大小超过 NAS 上限，请移除部分附件。</p>}
      {pending && files.length > 0 && <div role="status">{progress?.total && progress.loaded >= progress.total ? "上传完成，正在保存…" : progress?.total ? `上传中 ${Math.round(progress.loaded / progress.total * 100)}%` : "上传中…"} <button onClick={stop}>停止上传</button></div>}
      <div className="composer__bar">
        <div className="composer__left">
          <button
            disabled={pending || !ready}
            className="attach-btn"
            onClick={() => fileInput.current?.click()}
            title="添加图片 / 文件"
          >
            <IconPaperclip width={17} height={17} />
          </button>
          <button
            disabled={pending || !ready}
            className="attach-btn"
            onClick={() => fileInput.current?.click()}
            title="添加图片"
          >
            <IconImage width={17} height={17} />
          </button>
          <span className="composer__hint">Enter 发送 · Shift+Enter 换行</span>
          <input
            ref={fileInput}
            type="file"
            multiple
            hidden
            onChange={(e) => {
              if (e.target.files) addFiles(e.target.files);
              e.target.value = "";
            }}
          />
        </div>
        <button className="send" onClick={() => void send()} disabled={!canSend}>
          {pending ? "发送中…" : "发送"}
        </button>
      </div>
    </div>
  );
}
