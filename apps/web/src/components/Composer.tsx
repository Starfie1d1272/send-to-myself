import { useEffect, useRef, useState } from "react";
import { useComposer } from "../hooks/useComposer";
import { canOpenNativeTransfers, openNativeTransfers } from "../lib/nativeTransfers";
import { formatSize } from "../lib/format";
import { IconFile, IconPaperclip, IconX } from "./icons";
import { InlineStatus } from "./ui/InlineStatus";

export function Composer() {
  const {
    draft,
    change,
    send,
    canSend,
    overLimit,
    ready,
    pending,
    draftError,
    error,
    notice,
    progress,
    info,
    badFilename,
    deleted,
    pendingAttempts,
    selectedAttempt,
    refreshAttempts,
    restoreAttempt,
    restoreShared,
    removeAttempt,
    clearAttempts,
    sendAsNew,
    stop,
  } = useComposer();
  const value = draft.content;
  const files = draft.files;
  const [dragging, setDragging] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [previews, setPreviews] = useState<Map<File, string>>(new Map());
  useEffect(() => {
    const urls = new Map<File, string>();
    for (const file of files) {
      if (file.type.startsWith("image/") && !urls.has(file))
        urls.set(file, URL.createObjectURL(file));
    }
    setPreviews(urls);
    return () => {
      for (const url of urls.values()) URL.revokeObjectURL(url);
    };
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
  const removeAt = (i: number) =>
    change(
      value,
      files.filter((_, index) => index !== i),
    );

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
        aria-label="写点什么，发给自己"
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
          if (
            e.key === "Enter" &&
            !e.shiftKey &&
            !e.nativeEvent.isComposing &&
            e.nativeEvent.keyCode !== 229
          ) {
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
                {((info && f.size > info.maxUploadBytes) || badFilename === f.name) && (
                  <span className="tray__error" role="alert">
                    {info ? `超过单文件上限 ${formatSize(info.maxUploadBytes)}` : "超过单文件上限"}
                  </span>
                )}
              </div>
              <button
                type="button"
                className="tray__x"
                disabled={pending}
                onClick={() => removeAt(i)}
                aria-label="移除"
              >
                <IconX width={13} height={13} />
              </button>
            </div>
          ))}
        </div>
      )}

      {draftError && (
        <div className="composer__status">
          <InlineStatus tone="error">草稿未能保存到本机，请勿关闭窗口。</InlineStatus>
        </div>
      )}
      {selectedAttempt && (
        <div className="composer__status">
          <button
            type="button"
            className="button button--secondary button--sm"
            disabled={pending}
            onClick={() => void restoreShared()}
          >
            返回当前草稿
          </button>
        </div>
      )}
      {pendingAttempts.length > 0 && (
        <details
          className="composer__attempts"
          onToggle={(event) => {
            if (event.currentTarget.open) void refreshAttempts();
          }}
        >
          <summary>待确认发送（{pendingAttempts.length}）</summary>
          <div className="composer__attempts-head">
            <p>
              恢复后可检查或重试，不会自动发送；删除仅清理本机记录，不撤回 NAS 内容或取消后台传输。
            </p>
            <button
              type="button"
              className="button button--quiet button--sm"
              disabled={pending || !ready}
              onClick={() => void clearAttempts()}
            >
              清空全部
            </button>
          </div>
          <ul>
            {pendingAttempts.map((item, index) => (
              <li key={item.key}>
                <button
                  type="button"
                  className="button button--secondary button--sm composer__attempt-restore"
                  disabled={pending || !ready}
                  onClick={() => void restoreAttempt(item.key)}
                >
                  恢复第 {index + 1} 笔 ·{" "}
                  {item.capturedAt ? new Date(item.capturedAt).toLocaleString() : "时间未知"} ·{" "}
                  {item.hasText ? "文字" : "无文字"} · {item.fileCount} 个附件
                  {item.native ? " · 原生交接" : ""}
                </button>
                <button
                  type="button"
                  className="button button--danger button--sm"
                  disabled={pending || !ready}
                  aria-label={`删除第 ${index + 1} 笔待确认发送`}
                  onClick={() => void removeAttempt(item.key)}
                >
                  删除
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
      {error && (
        <div className="composer__status">
          <InlineStatus tone="error">
            <span>{error}</span>
            {(deleted || draft.webSendAttempted) && (
              <>
                <span>
                  {deleted
                    ? "原内容已永久删除；如需保留，可作为新内容发送。"
                    : "旧任务可能仍在发送，重新发送可能重复。"}
                </span>
                <button
                  type="button"
                  className="button button--secondary button--sm"
                  onClick={sendAsNew}
                >
                  再发一份
                </button>
              </>
            )}
          </InlineStatus>
        </div>
      )}
      {notice && (
        <div className="composer__status">
          <InlineStatus>
            <span>{notice}</span>
            {draft.restoredFromNative && canOpenNativeTransfers() && (
              <button
                type="button"
                className="button button--secondary button--sm"
                onClick={() => void openNativeTransfers()}
              >
                查看传输任务
              </button>
            )}
          </InlineStatus>
        </div>
      )}
      {files.length > 0 && (
        <p className="composer__hint">
          {info
            ? `单文件 ${formatSize(info.maxUploadBytes)}，总计 ${formatSize(info.maxUploadTotalBytes)}，最多 ${info.maxUploadFiles} 件`
            : "上传大小以 NAS 设置为准"}
        </p>
      )}
      {overLimit && (
        <div className="composer__status">
          <InlineStatus tone="error">附件数量或总大小超过 NAS 上限，请移除部分附件。</InlineStatus>
        </div>
      )}
      {pending && files.length > 0 && (
        <div className="composer__status">
          <InlineStatus>
            <span>
              {progress?.total && progress.loaded >= progress.total
                ? "上传完成，正在保存…"
                : progress?.total
                  ? `上传中 ${Math.round((progress.loaded / progress.total) * 100)}%`
                  : "上传中…"}
            </span>
            <button type="button" className="button button--danger button--sm" onClick={stop}>
              停止上传
            </button>
          </InlineStatus>
        </div>
      )}
      <div className="composer__bar">
        <div className="composer__left">
          <button
            type="button"
            disabled={pending || !ready}
            className="attach-btn"
            onClick={() => fileInput.current?.click()}
            title="添加图片或文件"
            aria-label="添加图片或文件"
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
        <button type="button" className="send" onClick={() => void send()} disabled={!canSend}>
          {pending ? "发送中…" : "发送"}
        </button>
      </div>
    </div>
  );
}
