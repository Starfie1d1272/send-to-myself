import { useEffect, useRef, useState } from "react";
import { useComposer } from "../hooks/useComposer";
import { canOpenNativeTransfers, openNativeTransfers } from "../lib/nativeTransfers";
import { formatSize } from "../lib/format";
import { IconFile, IconPaperclip, IconX } from "./icons";

export function Composer() {
  const { draft, change, send, addNative, checkReceipt, webFallback, newRequired, canSend, overLimit, ready, pending, draftError, error, notice, progress, info, badFilename, deleted, sendAsNew, stop } = useComposer();
  const value = draft.content;
  const files = draft.files;
  const [dragging, setDragging] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [previews, setPreviews] = useState<Map<File, string>>(new Map());
  useEffect(() => {
    const urls = new Map<File, string>();
    for (const file of files) {
      if (file.type.startsWith("image/") && !urls.has(file)) urls.set(file, URL.createObjectURL(file));
    }
    setPreviews(urls);
    return () => { for (const url of urls.values()) URL.revokeObjectURL(url); };
  }, [files]);
  useEffect(() => {
    const focus = () => ref.current?.focus();
    window.addEventListener("send-to-myself:focus-composer", focus);
    return () => window.removeEventListener("send-to-myself:focus-composer", focus);
  }, []);
  const grow = () => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
  };

  useEffect(grow, [value]);

  const addFiles = (list: FileList | File[]) => change(value, [...files, ...Array.from(list)]);
  const removeAt = (i: number) => change(value, files.filter((_, index) => index !== i));

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
              {previews.has(f) ? (
                <img src={previews.get(f)} alt="" className="tray__thumb" />
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
      {error && <p className="composer__error" role="alert">{error} {(deleted || newRequired || draft.nativeHandoffPending) && <> 旧任务可能仍在发送，重新发送可能重复。 <button onClick={sendAsNew}>作为新内容重新发送</button></>} {draft.nativeHandoffPending && <button onClick={() => void checkReceipt()}>重新检查</button>}</p>}
      {webFallback && <button onClick={() => fileInput.current?.click()}>改用当前页面上传</button>}
      {files.length > 0 && <p>此批附件将在当前页面发送，请保持页面开启</p>}
      {notice && <p role="status">{notice} {notice === "已保存在本机，等待发送" && canOpenNativeTransfers() && <button onClick={() => void openNativeTransfers()}>查看传输任务</button>}</p>}
      <p className="composer__hint">{info ? `单文件 ${formatSize(info.maxUploadBytes)}，总计 ${formatSize(info.maxUploadTotalBytes)}，最多 ${info.maxUploadFiles} 件` : "上传大小以 NAS 设置为准"}</p>
      {overLimit && <p className="composer__error" role="alert">附件数量或总大小超过 NAS 上限，请移除部分附件。</p>}
      {pending && files.length > 0 && <div role="status">{progress?.total && progress.loaded >= progress.total ? "上传完成，正在保存…" : progress?.total ? `上传中 ${Math.round(progress.loaded / progress.total * 100)}%` : "上传中…"} <button onClick={stop}>停止上传</button></div>}
      <div className="composer__bar">
        <div className="composer__left">
          <button
            disabled={pending || !ready}
            className="attach-btn"
            onClick={() => { void addNative().then(handled => { if (!handled) fileInput.current?.click(); }); }}
            title="添加图片或文件" aria-label="添加图片或文件"
          >
            <IconPaperclip width={17} height={17} />
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
