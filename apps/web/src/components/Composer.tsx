import { useEffect, useRef, useState } from "react";
import { loadDraft, saveDraft, newDedupeKey, type ComposerDraft } from "../lib/draft";
import { useItemMutations } from "../hooks/useItems";
import { formatSize } from "../lib/format";
import { IconFile, IconImage, IconPaperclip, IconX } from "./icons";

interface Pending {
  file: File;
  url?: string; // 图片预览的 objectURL
}

export function Composer() {
  const { create, upload } = useItemMutations();
  const [value, setValue] = useState("");
  const [files, setFiles] = useState<Pending[]>([]);
  const [ready, setReady] = useState(false);
  const [draftError, setDraftError] = useState(false);
  const [saveError, setSaveError] = useState("");
  const draftRef = useRef<ComposerDraft>({ content: "", files: [] });
  const [dragging, setDragging] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const pending = create.isPending || upload.isPending;

  const previewUrls = useRef(new Set<string>());
  const wrapFile = (file: File): Pending => {
    const url = file.type.startsWith("image/") ? URL.createObjectURL(file) : undefined;
    if (url) previewUrls.current.add(url);
    return { file, url };
  };
  useEffect(() => {
    let active = true;
    void loadDraft().then((draft) => {
      if (!active) return;
      draftRef.current = { ...draft, dedupeKey: draft.dedupeKey ?? newDedupeKey() };
      setValue(draft.content);
      setFiles(draft.files.map(wrapFile));
    }).catch(() => { if (active) setDraftError(true); })
      .finally(() => { if (active) setReady(true); });
    return () => {
      active = false;
      for (const url of previewUrls.current) URL.revokeObjectURL(url);
      previewUrls.current.clear();
    };
  }, []);
  useEffect(() => {
    const focus = () => ref.current?.focus();
    window.addEventListener("send-to-myself:focus-composer", focus);
    return () => window.removeEventListener("send-to-myself:focus-composer", focus);
  }, []);

  const persist = (content: string, pendingFiles: File[]) => {
    draftRef.current = { content, files: pendingFiles, dedupeKey: newDedupeKey() };
    void saveDraft(draftRef.current).then(() => setDraftError(false)).catch(() => setDraftError(true));
  };

  const grow = () => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
  };

  useEffect(grow, [value]);

  const addFiles = (list: FileList | File[]) => {
    if (pending || !ready) return;
    const next = [...files, ...Array.from(list).map(wrapFile)];
    setFiles(next);
    persist(value, next.map((entry) => entry.file));
  };

  const removeAt = (i: number) => {
    const entry = files[i];
    if (entry?.url) {
      URL.revokeObjectURL(entry.url);
      previewUrls.current.delete(entry.url);
    }
    const next = files.filter((_, idx) => idx !== i);
    setFiles(next);
    persist(value, next.map((entry) => entry.file));
  };

  const reset = () => {
    for (const url of previewUrls.current) URL.revokeObjectURL(url);
    previewUrls.current.clear();
    setValue("");
    setFiles([]);
    persist("", []);
    setSaveError("");
    requestAnimationFrame(grow);
  };

  const send = () => {
    const content = value.trim();
    if (pending || !ready) return;
    const dedupeKey = draftRef.current.dedupeKey;
    setSaveError("");
    const onError = () => setSaveError("发送失败，内容已保留，请重试。");
    if (files.length === 0) {
      if (!content) return;
      create.mutate({ content, dedupeKey }, { onSuccess: reset, onError });
    } else {
      upload.mutate({ content, files: files.map((f) => f.file), dedupeKey }, { onSuccess: reset, onError });
    }
  };

  const canSend = (value.trim().length > 0 || files.length > 0) && !pending && ready;

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
        placeholder="写点什么，发给自己…（可粘贴 / 拖拽图片文件）"
        value={value}
        rows={1}
        disabled={pending || !ready}
        onChange={(e) => {
          setValue(e.target.value);
          persist(e.target.value, files.map((entry) => entry.file));
          grow();
        }}
        onPaste={(e) => {
          if (e.clipboardData.files.length) {
            e.preventDefault();
            addFiles(e.clipboardData.files);
          }
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            send();
          }
        }}
      />

      {files.length > 0 && (
        <div className="tray">
          {files.map((f, i) => (
            <div className="tray__item" key={i}>
              {f.url ? (
                <img src={f.url} alt="" className="tray__thumb" />
              ) : (
                <span className="tray__file">
                  <IconFile width={16} height={16} />
                </span>
              )}
              <div className="tray__info">
                <span className="tray__name">{f.file.name}</span>
                <span className="tray__size">{formatSize(f.file.size)}</span>
              </div>
              <button className="tray__x" disabled={pending} onClick={() => removeAt(i)} aria-label="移除">
                <IconX width={13} height={13} />
              </button>
            </div>
          ))}
        </div>
      )}

      {(draftError || saveError) && <p className="composer__error" role="alert">
        {draftError ? "草稿未能保存到本机，请勿关闭窗口。" : saveError}
      </p>}
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
        <button className="send" onClick={send} disabled={!canSend}>
          {pending ? "发送中…" : "发送"}
        </button>
      </div>
    </div>
  );
}
