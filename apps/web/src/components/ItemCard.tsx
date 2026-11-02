import { useRef, useState } from "react";
import { motion } from "motion/react";
import type { Item } from "@sendtomyself/shared";
import {
  dueBucket,
  dueLabel,
  formatDue,
  formatTime,
  hostnameOf,
  itemDueSuggestion,
  itemPreview,
  itemUrls,
  quickDue,
} from "../lib/format";
import { extractUrlSpans } from "@sendtomyself/shared/detect";
import { findSecretSpans } from "@sendtomyself/shared/detect/secret";
import { copyText, copyImage } from "../lib/clipboard";
import { ApiError, attachmentRawUrl } from "../lib/api";
import { clearEditDraft, loadEditDraft, saveEditDraft, type EditSnapshot } from "../lib/draft";
import { mutationErrorMessage } from "../lib/mutation-error";
import { useItemMutations } from "../hooks/useItems";
import { Attachments } from "./Attachments";
import { LinkPreviewCard } from "./LinkPreviewCard";
import { SensitiveText } from "./SensitiveText";
import {
  IconCheck,
  IconClock,
  IconCopy,
  IconEye,
  IconEdit,
  IconLock,
  IconPin,
  IconRestore,
  IconTag,
  IconTrash,
} from "./icons";

function LinkifiedText({ text }: { text: string }) {
  let offset = 0;
  const parts = extractUrlSpans(text).map((span) => {
    const before = text.slice(offset, span.start);
    offset = span.end;
    return <span key={span.start}>{before}<a href={span.url} target="_blank" rel="noreferrer" className="inline-link">{span.url}</a></span>;
  });
  return <>{parts}{text.slice(offset)}</>;
}

export function ItemCard({
  item,
  trash,
  gap = "normal",
}: {
  item: Item;
  trash?: boolean;
  gap?: "first" | "cont" | "normal";
}) {
  const { update, remove, restore, refetchPreview } = useItemMutations();
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState("");
  const [dueOpen, setDueOpen] = useState(false);
  const [tagOpen, setTagOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  const [error, setError] = useState("");
  const [draftStatus, setDraftStatus] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const snapshot = useRef<EditSnapshot | undefined>(undefined);
  const lastWrite = useRef<Promise<void>>(Promise.resolve());
  const retry = useRef<(() => Promise<unknown>) | null>(null);
  const run = async (operation: () => Promise<unknown>) => {
    if (lock.current) return false;
    lock.current = true; setBusy(true); setError(""); setNotice(""); retry.current = operation;
    try { await operation(); retry.current = null; setNotice("已保存"); return true; }
    catch (err) {
      setError(mutationErrorMessage(err));
      if (err instanceof ApiError && err.status === 404 && editing) {
        await lastWrite.current; await clearEditDraft(item.id).catch(() => {});
      }
      return false;
    } finally { lock.current = false; setBusy(false); }
  };
  const patch = (p: Parameters<typeof update.mutate>[0]["patch"]) => { void run(() => update.mutateAsync({ id: item.id, patch: p })); };

  const copy = async () => {
    setCopyError("");
    // Text and images remain different clipboard payloads.
    const firstImg = (item.attachments ?? []).find((a) => a.mimeType.startsWith("image/"));
    const ok =
      item.content.trim().length > 0
        ? await copyText(item.content)
        : firstImg
          ? await copyImage(attachmentRawUrl(firstImg.id))
          : false;
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } else {
      setCopyError(firstImg && !item.content.trim() ? "图片复制不可用，请下载图片后发送。" : "复制失败，请重试。");
    }
  };

  const startEdit = async () => {
    if (lock.current || editing) return;
    lock.current = true; setBusy(true);
    setDraft(item.content); setEditing(true); setDraftStatus(""); snapshot.current = undefined;
    try {
      const saved = await loadEditDraft(item.id);
      if (saved) { setDraft(saved.content); snapshot.current = saved; setDraftStatus("已恢复未保存的修改"); }
    } catch { setDraftStatus("修改尚未保存到本机，请勿关闭窗口"); }
    finally { lock.current = false; setBusy(false); }
  };
  const changeDraft = (value: string) => {
    setDraft(value); setError("");
    lastWrite.current = saveEditDraft(item.id, value).then(saved => { snapshot.current = saved; setDraftStatus(""); }).catch(err => {
      setDraftStatus(err instanceof Error && err.message === "draft_full" ? "本机编辑草稿已满，本次修改仅保留在当前页面；请保存到 NAS 后再关闭。" : "修改尚未保存到本机，请勿关闭窗口");
    });
  };
  const clearSnapshot = async () => {
    await lastWrite.current;
    if (snapshot.current) await clearEditDraft(item.id, snapshot.current).catch(() => setDraftStatus("修改尚未保存到本机，请勿关闭窗口"));
  };
  const saveEdit = async () => {
    if (!draft.trim() && !item.attachments?.length) { setError("请输入文字"); return; }
    if (await run(() => update.mutateAsync({ id: item.id, patch: { content: draft } }))) { await clearSnapshot(); setEditing(false); }
  };
  const cancelEdit = async () => { await clearSnapshot(); setEditing(false); setError(""); };

  const urls = itemUrls(item);
  const preview = itemPreview(item);
  const suggestion = itemDueSuggestion(item);
  const bucket = dueBucket(item.dueAt);
  const showSuggestion = !trash && suggestion && !item.dueAt && !item.isTodo;
  const attachments = item.attachments ?? [];
  // 命中具体密钥 → 只遮罩密钥本身；手动标敏感但无命中 → 整条遮罩
  const secretSpans = item.sensitive ? findSecretSpans(item.content) : [];
  const partialMask = item.sensitive && secretSpans.length > 0;

  return (
    <motion.li
      layout
      initial={{ opacity: 0, y: -12, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.96, transition: { duration: 0.18 } }}
      transition={{ type: "spring", stiffness: 520, damping: 38 }}
      className={`item item--gap-${gap}${item.pinned ? " item--pinned" : ""}${
        item.completed ? " item--done" : ""
      }`}
    >
      <div className="item__row">
        {item.isTodo && !trash && (
          <button
            disabled={busy || editing}
            className={`check${item.completed ? " check--on" : ""}`}
            onClick={() => patch({ completed: !item.completed })}
            aria-label="完成"
            title={item.completed ? "标记未完成" : "标记完成"}
          >
            {item.completed && <IconCheck width={14} height={14} />}
          </button>
        )}

        <div className="item__body">
          {editing ? (
            <div className="item__edit">
              <textarea
                className="item__edit-input"
                value={draft}
                autoFocus
                maxLength={100000}
                disabled={busy}
                onChange={(e) => changeDraft(e.target.value)}
              />
              <div className="item__edit-actions">
                <button
                  className="item__edit-save"
                  onClick={() => void saveEdit()}
                  disabled={busy}
                >
                  {busy ? "保存中…" : "保存"}
                </button>
                <button className="item__edit-cancel" disabled={busy} onClick={() => void cancelEdit()}>
                  取消
                </button>
              </div>
              {draftStatus && <p role="status">{draftStatus}</p>}
            </div>
          ) : partialMask ? (
            <SensitiveText content={item.content} spans={secretSpans} />
          ) : item.sensitive && !revealed ? (
            <button className="redacted" onClick={() => setRevealed(true)}>
              <span className="redacted__bars" aria-hidden>
                ▮▮▮▮▮▮▮▮▮▮
              </span>
              <span className="redacted__hint">
                <IconEye width={14} height={14} /> 已隐藏敏感内容 · 点击显示
              </span>
            </button>
          ) : (
            item.content.trim().length > 0 && (
              <p className={`item__content${item.sensitive ? " item__content--mono" : ""}`}>
                {item.sensitive ? item.content : <LinkifiedText text={item.content} />}
              </p>
            )
          )}

          {attachments.length > 0 && !item.sensitive && (
            <Attachments items={attachments} />
          )}

          {preview && !item.sensitive && <LinkPreviewCard preview={preview} />}

          {urls.length > 0 && !item.sensitive && !preview && (
            <div className="chips">
              {urls.slice(0, 3).map((u) => (
                <a key={u} className="link-chip" href={u} target="_blank" rel="noreferrer">
                  <span className="link-chip__dot" />
                  {hostnameOf(u)}
                </a>
              ))}
              {!trash && (
                <button
                  className="link-chip link-chip--action"
                  title="重新抓取预览"
                  disabled={busy}
                  onClick={() => void run(async () => { const result = await refetchPreview.mutateAsync(item.id); if (result.meta?.preview?.status === "error") throw new Error("preview failed"); })}
                >
                  {refetchPreview.isPending ? "抓取中…" : "抓取预览"}
                </button>
              )}
            </div>
          )}

          {showSuggestion && (
            <button
              className="suggest"
              disabled={busy || editing}
              onClick={() => patch({ isTodo: true, dueAt: suggestion!.dueAt })}
            >
              <IconClock width={14} height={14} />
              识别到截止「{suggestion!.matchedText}」· 设为待办
            </button>
          )}

          <div className="item__meta">
            {item.dueAt && bucket !== "none" && (
              <span className={`due due--${bucket}`}>
                <IconClock width={12} height={12} />
                {dueLabel[bucket]} · {formatDue(item.dueAt)}
              </span>
            )}
            {item.category !== "none" && (
              <span className="tag">{item.category === "idea" ? "想法" : "稍后看"}</span>
            )}
            <time className="item__time">{formatTime(item.createdAt)}</time>
          </div>
        </div>
      </div>

      {notice && <p role="status">{notice}</p>}
      {error && <p className="composer__error" role="alert">{error} {editing ? <><button disabled={busy} onClick={() => void saveEdit()}>重试保存</button><button onClick={() => void copyText(draft)}>复制未保存内容</button></> : <button disabled={busy} onClick={() => { if (retry.current) void run(retry.current); }}>重试</button>}</p>}
      {copyError && <p className="composer__error" role="alert">{copyError}</p>}
      <fieldset className="actions" disabled={busy || editing} style={{ border: 0, padding: 0, margin: 0 }}>
        {trash ? (
          <button className="icon-btn" title="恢复" onClick={() => void run(() => restore.mutateAsync(item.id))}>
            <IconRestore />
          </button>
        ) : (
          <>
            <button className="icon-btn" title={copied ? "已复制" : "复制"} onClick={copy}>
              {copied ? <IconCheck /> : <IconCopy />}
            </button>
            <button className="icon-btn" title="编辑" onClick={() => void startEdit()}>
              <IconEdit />
            </button>
            <button
              className={`icon-btn${item.sensitive ? " icon-btn--on" : ""}`}
              title={item.sensitive ? "取消敏感遮罩" : "标记为敏感"}
              onClick={() => patch({ sensitive: !item.sensitive })}
            >
              <IconLock />
            </button>
            <button
              className={`icon-btn${item.pinned ? " icon-btn--on" : ""}`}
              title={item.pinned ? "取消置顶" : "置顶"}
              onClick={() => patch({ pinned: !item.pinned })}
            >
              <IconPin />
            </button>
            <button
              className={`icon-btn${item.isTodo ? " icon-btn--on" : ""}`}
              title={item.isTodo ? "取消待办" : "设为待办"}
              onClick={() => patch({ isTodo: !item.isTodo })}
            >
              <IconCheck />
            </button>
            <div className="due-wrap">
              <button
                className={`icon-btn${item.category !== "none" ? " icon-btn--on" : ""}`}
                title="标签：想法 / 稍后看"
                onClick={() => setTagOpen((v) => !v)}
              >
                <IconTag />
              </button>
              {tagOpen && (
                <div className="due-menu" onMouseLeave={() => setTagOpen(false)}>
                  <button
                    onClick={() => {
                      patch({ category: "idea" });
                      setTagOpen(false);
                    }}
                  >
                    想法
                  </button>
                  <button
                    onClick={() => {
                      patch({ category: "read_later" });
                      setTagOpen(false);
                    }}
                  >
                    稍后看
                  </button>
                  {item.category !== "none" && (
                    <button
                      className="due-menu__clear"
                      onClick={() => {
                        patch({ category: "none" });
                        setTagOpen(false);
                      }}
                    >
                      清除标签
                    </button>
                  )}
                </div>
              )}
            </div>
            <div className="due-wrap">
              <button
                className={`icon-btn${item.dueAt ? " icon-btn--on" : ""}`}
                title="截止时间"
                onClick={() => setDueOpen((v) => !v)}
              >
                <IconClock />
              </button>
              {dueOpen && (
                <div className="due-menu" onMouseLeave={() => setDueOpen(false)}>
                  {(["today", "tomorrow", "sunday"] as const).map((k) => (
                    <button
                      key={k}
                      onClick={() => {
                        patch({ isTodo: true, dueAt: quickDue(k) });
                        setDueOpen(false);
                      }}
                    >
                      {k === "today" ? "今天" : k === "tomorrow" ? "明天" : "本周日"}
                    </button>
                  ))}
                  <label className="due-menu__custom">
                    自定义…
                    <input
                      type="datetime-local"
                      onChange={(e) => {
                        if (e.target.value) {
                          patch({ isTodo: true, dueAt: new Date(e.target.value).toISOString() });
                          setDueOpen(false);
                        }
                      }}
                    />
                  </label>
                  {item.dueAt && (
                    <button
                      className="due-menu__clear"
                      onClick={() => {
                        patch({ dueAt: null });
                        setDueOpen(false);
                      }}
                    >
                      清除
                    </button>
                  )}
                </div>
              )}
            </div>
            <button className="icon-btn icon-btn--danger" title="删除" onClick={() => void run(() => remove.mutateAsync(item.id))}>
              <IconTrash />
            </button>
          </>
        )}
      </fieldset>
    </motion.li>
  );
}
