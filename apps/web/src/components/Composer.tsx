import { useEffect, useRef, useState } from "react";
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
  const [dragging, setDragging] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const pending = create.isPending || upload.isPending;

  // 释放 objectURL，防内存泄漏
  useEffect(
    () => () => {
      for (const f of files) if (f.url) URL.revokeObjectURL(f.url);
    },
    [files],
  );

  const grow = () => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
  };

  const addFiles = (list: FileList | File[]) => {
    const next: Pending[] = [];
    for (const file of Array.from(list)) {
      next.push({
        file,
        url: file.type.startsWith("image/") ? URL.createObjectURL(file) : undefined,
      });
    }
    if (next.length) setFiles((prev) => [...prev, ...next]);
  };

  const removeAt = (i: number) =>
    setFiles((prev) => {
      const f = prev[i];
      if (f?.url) URL.revokeObjectURL(f.url);
      return prev.filter((_, idx) => idx !== i);
    });

  const reset = () => {
    setValue("");
    setFiles([]);
    requestAnimationFrame(grow);
  };

  const send = () => {
    const content = value.trim();
    if (pending) return;
    if (files.length === 0) {
      if (!content) return;
      create.mutate({ content }, { onSuccess: reset });
    } else {
      upload.mutate({ content, files: files.map((f) => f.file) }, { onSuccess: reset });
    }
  };

  const canSend = (value.trim().length > 0 || files.length > 0) && !pending;

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
        onChange={(e) => {
          setValue(e.target.value);
          grow();
        }}
        onPaste={(e) => {
          if (e.clipboardData.files.length) {
            e.preventDefault();
            addFiles(e.clipboardData.files);
          }
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
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
              <button className="tray__x" onClick={() => removeAt(i)} aria-label="移除">
                <IconX width={13} height={13} />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="composer__bar">
        <div className="composer__left">
          <button
            className="attach-btn"
            onClick={() => fileInput.current?.click()}
            title="添加图片 / 文件"
          >
            <IconPaperclip width={17} height={17} />
          </button>
          <button
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
