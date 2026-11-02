import { Dialog } from "./ui/Dialog";
import { captureDetectionContext } from "../lib/detectionContext";
import { useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
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
import { copyText } from "../lib/clipboard";
import { ApiError } from "../lib/api";
import { clearEditDraft, draftGeneration, draftIsWritable, loadEditDraft, prepareEditDraft, saveEditDraft, type EditSnapshot } from "../lib/draft";
import { mutationErrorMessage } from "../lib/mutation-error";
import { useItemMutations } from "../hooks/useItems";
import { Attachments } from "./Attachments";
import { LinkPreviewCard } from "./LinkPreviewCard";
import { SensitiveText } from "./SensitiveText";
import {
  IconCheck,
  IconClock,
  IconEye,
  IconRestore,
} from "./icons";

class EditDraftConflict extends Error {}
class EditDraftFrozen extends Error {}

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
  revealEpoch,
}: {
  item: Item;
  trash?: boolean;
  gap?: "first" | "cont" | "normal";
  revealEpoch: string;
}) {
  const { update, remove, restore, permanent, refetchPreview } = useItemMutations();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState("");
  const [dueOpen, setDueOpen] = useState(false);
  const [tagOpen, setTagOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [customDue, setCustomDue] = useState("");
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const editRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { setRevealed(false); }, [item.content, item.sensitive, revealEpoch]);
  useEffect(() => { const hide = () => { if (document.visibilityState === "hidden") setRevealed(false); }; document.addEventListener("visibilitychange", hide); return () => document.removeEventListener("visibilitychange", hide); }, []);
  useEffect(() => { if (!menuOpen) return; const key = (e: KeyboardEvent) => { if (e.key === "Escape") { setMenuOpen(false); triggerRef.current?.focus(); } }; const outside = (e: MouseEvent) => { if (!menuRef.current?.contains(e.target as Node)) { setMenuOpen(false); triggerRef.current?.focus(); } }; document.addEventListener("keydown", key); document.addEventListener("mousedown", outside); return () => { document.removeEventListener("keydown", key); document.removeEventListener("mousedown", outside); }; }, [menuOpen]);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  const [error, setError] = useState("");
  const [draftStatus, setDraftStatus] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const snapshot = useRef<EditSnapshot | undefined>(undefined);
  const memoryAttempt = useRef<{ content: string; detectionContext: ReturnType<typeof captureDetectionContext> } | undefined>(undefined);
  const lastWrite = useRef<Promise<void>>(Promise.resolve());
  const retry = useRef<{ operation: () => Promise<unknown>; preview: boolean; missingSnapshot?: () => EditSnapshot | undefined; successMessage?: () => string } | null>(null);
  const run = async (operation: () => Promise<unknown>, preview = false, missingSnapshot?: () => EditSnapshot | undefined, successMessage?: () => string) => {
    if (lock.current) return false;
    lock.current = true; setBusy(true); setError(""); setNotice(""); retry.current = { operation, preview, missingSnapshot, successMessage };
    try { await operation(); retry.current = null; setNotice(successMessage?.() ?? "已保存"); return true; }
    catch (err) {
      setError(err instanceof EditDraftFrozen ? "当前会话正在退出，本次未提交。" : err instanceof EditDraftConflict ? "另一窗口已修改草稿，本次未提交。请复制当前内容后重新打开编辑，或在另一窗口处理。" : preview ? "预览抓取失败，原链接仍保留，请重试。" : err instanceof ApiError && err.code === "cleanup_failed" ? "永久删除未完成，请检查 NAS 存储后重试" : mutationErrorMessage(err));
      if (err instanceof ApiError && err.status === 404 && editing) {
        const expected = missingSnapshot?.();
        if (expected) await clearEditDraft(item.id, expected).catch(() => {});
      }
      return false;
    } finally { lock.current = false; setBusy(false); }
  };
  const menuAction = async (operation: () => Promise<unknown>, preview = false) => {
    if (await run(operation, preview)) {
      setMenuOpen(false); setDueOpen(false); setTagOpen(false);
      requestAnimationFrame(() => triggerRef.current?.focus());
    }
  };
  const patch = (p: Parameters<typeof update.mutate>[0]["patch"]) => { void run(() => update.mutateAsync({ id: item.id, patch: p })); };

  const copy = async () => {
    setCopyError("");
    const ok = await copyText(item.content);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } else {
      setCopyError("复制失败，请重试。");
    }
  };

  const startEdit = async () => {
    if (lock.current || editing) return;
    lock.current = true; setBusy(true);
    setDraft(item.content); setEditing(true); setDraftStatus(""); snapshot.current = undefined; memoryAttempt.current = undefined;
    try {
      const saved = await loadEditDraft(item.id);
      if (saved) { setDraft(saved.content); snapshot.current = saved; setDraftStatus("已恢复未保存的修改"); }
    } catch { setDraftStatus("修改尚未保存到本机，请勿关闭窗口"); }
    finally { lock.current = false; setBusy(false); }
  };
  useEffect(() => { if (editing && !busy && (!item.sensitive || revealed)) editRef.current?.focus(); }, [editing, busy, item.sensitive, revealed]);
  const changeDraft = (value: string) => {
    if (lock.current) return;
    memoryAttempt.current = undefined;
    setDraft(value); setError("");
    lastWrite.current = saveEditDraft(item.id, value).then(saved => { snapshot.current = saved; setDraftStatus(""); }).catch(err => {
      setDraftStatus(err instanceof Error && err.message === "draft_full" ? "本机编辑草稿已满，本次修改仅保留在当前页面；请保存到 NAS 后再关闭。" : "修改尚未保存到本机，请勿关闭窗口");
    });
  };
  const saveEdit = async () => {
    if (!draft.trim() && !item.attachments?.length) { setError("请输入文字"); return; }
    const content = draft;
    const startedContext = captureDetectionContext();
    const generation = draftGeneration();
    const ensureWritable = () => { if (!draftIsWritable() || draftGeneration() !== generation) throw new EditDraftFrozen(); };
    let attemptSnapshot: EditSnapshot | undefined;
    let storageUnavailable = false;
    await run(async () => {
      attemptSnapshot = undefined;
      storageUnavailable = false;
      await lastWrite.current;
      ensureWritable();
      const saved = snapshot.current;
      const context = memoryAttempt.current?.content === content ? memoryAttempt.current.detectionContext
        : saved?.content === content ? saved.detectionContext ?? startedContext : startedContext;
      try { attemptSnapshot = await prepareEditDraft(item.id, saved?.content === content ? saved : undefined, content, context); }
      catch (error) {
        ensureWritable();
        storageUnavailable = true;
        memoryAttempt.current = { content, detectionContext: context };
        setDraftStatus(error instanceof Error && error.message === "draft_full" ? "本机编辑草稿已满，本次修改仅保留在当前页面；请保存到 NAS 后再关闭。" : "修改尚未保存到本机，请勿关闭窗口。");
      }
      ensureWritable();
      if (!storageUnavailable && !attemptSnapshot) throw new EditDraftConflict();
      if (attemptSnapshot) { snapshot.current = attemptSnapshot; memoryAttempt.current = undefined; }
      await update.mutateAsync({ id: item.id, patch: { content, detectionContext: context } });
      if (attemptSnapshot) await clearEditDraft(item.id, attemptSnapshot).catch(() => { storageUnavailable = true; });
      setEditing(false);
    }, false, () => attemptSnapshot, () => storageUnavailable ? "已保存到 NAS；本机草稿未能确认或清理。" : "已保存");
  };
  const cancelEdit = async () => {
    if (lock.current) return;
    lock.current = true; setBusy(true);
    try {
      await lastWrite.current;
      const expected = snapshot.current;
      if (expected) await clearEditDraft(item.id, expected).catch(() => setDraftStatus("修改尚未保存到本机，请勿关闭窗口"));
      setEditing(false); setError("");
    } finally { lock.current = false; setBusy(false); }
  };

  const urls = itemUrls(item);
  const preview = itemPreview(item);
  const reducedMotion = useReducedMotion();
  const suggestion = itemDueSuggestion(item);
  const bucket = dueBucket(item.dueAt);
  const showSuggestion = !trash && (!item.sensitive || revealed) && suggestion && !item.dueAt && !item.isTodo;
  const attachments = item.attachments ?? [];
  // 命中具体密钥 → 只遮罩密钥本身；手动标敏感但无命中 → 整条遮罩
  const secretSpans = item.sensitive ? findSecretSpans(item.content) : [];
  const partialMask = item.sensitive && secretSpans.length > 0;

  return (
    <motion.li
      layout={!reducedMotion}
      initial={reducedMotion ? false : { opacity: 0, y: -12, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={reducedMotion ? { opacity: 0 } : { opacity: 0, scale: 0.96, transition: { duration: 0.18 } }}
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
            aria-label={item.completed ? "标记未完成" : "标记完成"}
            title={item.completed ? "标记未完成" : "标记完成"}
          >
            {item.completed && <IconCheck width={14} height={14} />}
          </button>
        )}

        <div className="item__body">
          {editing && (!item.sensitive || revealed) ? (
            <div className="item__edit">
              <textarea
                ref={editRef}
                className="item__edit-input"
                value={draft}
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
          ) : partialMask && !revealed ? (
            <SensitiveText content={item.content} spans={secretSpans} onReveal={() => setRevealed(true)} />
          ) : item.sensitive && !revealed ? (
            <button className="redacted" onClick={() => setRevealed(true)}>
              <span className="redacted__bars" aria-hidden>
                ▮▮▮▮▮▮▮▮▮▮
              </span>
              <span className="redacted__hint">
                <IconEye width={14} height={14} /> 已隐藏敏感内容 · 查看内容
              </span>
            </button>
          ) : (
            item.content.trim().length > 0 && (
              <p className={`item__content${item.sensitive ? " item__content--mono" : ""}`}>
                <LinkifiedText text={item.content} />
              </p>
            )
          )}

          {item.sensitive && <button onClick={() => setRevealed(!revealed)}>{revealed ? "隐藏内容" : "查看内容"}</button>}
          {attachments.length > 0 && (!item.sensitive || revealed) && !item.purgeStartedAt && (
            <Attachments items={attachments} />
          )}

          {preview && (!item.sensitive || revealed) && <LinkPreviewCard preview={preview} />}

          {urls.length > 0 && (!item.sensitive || revealed) && !preview && (
            <div className="chips">
              {urls.map((u) => (
                <a key={u} className="link-chip" href={u} target="_blank" rel="noreferrer">
                  <span className="link-chip__dot" />
                  {hostnameOf(u)}
                </a>
              ))}

            </div>
          )}

          {showSuggestion && (
            <button
              className="suggest"
              disabled={busy || editing}
              onClick={() => patch({ isTodo: true, dueAt: suggestion!.dueAt })}
            >
              <IconClock width={14} height={14} />
              识别到截止「{suggestion!.matchedText}」：{formatDue(suggestion!.dueAt)}（本机时间）· 设为待办
            </button>
          )}

          {trash && <p>{item.purgeStartedAt ? "永久删除尚未完成" : `删除于 ${item.deletedAt ? new Date(item.deletedAt).toLocaleString() : ""}`}{!item.purgeStartedAt && item.trashExpiresAt && ` · 预计 ${new Date(item.trashExpiresAt).toLocaleString()} 后自动清理`}</p>}
          <div className="item__meta">
            {item.dueAt && bucket !== "none" && (
              <span className={`due due--${item.completed ? "later" : bucket}`}>
                <IconClock width={12} height={12} />
                {item.completed ? "已完成 · 截止" : dueLabel[bucket]} · {formatDue(item.dueAt)}
              </span>
            )}
            {item.category !== "none" && (
              <span className="tag">{item.category === "idea" ? "想法" : "稍后看"}</span>
            )}
            <time className="item__time">{formatTime(item.createdAt)}</time>
          </div>
        </div>
      </div>

      {confirmDelete && <Dialog onClose={() => setConfirmDelete(false)} labelledBy={`purge-${item.id}`}><h2 id={`purge-${item.id}`}>永久删除这条内容？</h2><p>正文和 {attachments.length} 个附件将从 NAS 删除，无法从回收站恢复。</p><button onClick={() => setConfirmDelete(false)}>取消</button><button className="button button--danger" onClick={() => { setConfirmDelete(false); void run(async () => { await permanent.mutateAsync(item.id); await clearEditDraft(item.id); }); }}>永久删除</button></Dialog>}
      {notice && <p role="status">{notice}</p>}
      {error && <p className="composer__error" role="alert">{error} {editing ? <><button className="button button--secondary" disabled={busy} onClick={() => void saveEdit()}>重试保存</button><button className="button button--secondary" onClick={() => void copyText(draft)}>复制未保存内容</button></> : <button className="button button--secondary" disabled={busy} onClick={() => { if (retry.current) void (menuOpen ? menuAction(retry.current.operation, retry.current.preview) : run(retry.current.operation, retry.current.preview, retry.current.missingSnapshot, retry.current.successMessage)); }}>重试</button>}</p>}
      {copyError && <p className="composer__error" role="alert">{copyError}</p>}
      <fieldset className="actions" disabled={busy || editing} style={{ border: 0, padding: 0, margin: 0 }}>
        {trash ? (
          <>
            <button className="icon-btn" aria-label="恢复" title="恢复" disabled={!!item.purgeStartedAt} onClick={() => void run(() => restore.mutateAsync(item.id))}><IconRestore /></button>
            <button className="button button--danger" onClick={() => item.purgeStartedAt ? void run(async () => { await permanent.mutateAsync(item.id); await clearEditDraft(item.id); }) : setConfirmDelete(true)}>{busy ? "正在清理…" : item.purgeStartedAt ? "重试清理" : "永久删除"}</button>
          </>
        ) : (
          <>
            {item.content.trim() && (!item.sensitive || revealed) && <button onClick={copy}>{copied ? "已复制" : "复制文字"}</button>}
            <div className="due-wrap" ref={menuRef}>
              <button ref={triggerRef} aria-expanded={menuOpen} onClick={() => setMenuOpen(!menuOpen)}>更多</button>
              {menuOpen && <div className="due-menu">
                <button onClick={() => void menuAction(() => update.mutateAsync({id:item.id,patch:{pinned:!item.pinned}}))}>{item.pinned ? "取消收藏" : "收藏"}</button>
                <button onClick={() => void menuAction(() => update.mutateAsync({id:item.id,patch:{isTodo:!item.isTodo}}))}>{item.isTodo ? "取消待办" : "设为待办"}</button>
                <button onClick={() => setDueOpen(!dueOpen)}>截止日期</button>
                {dueOpen && <div>{(["today","tomorrow","sunday"] as const).map(k => <button key={k} onClick={() => void menuAction(() => update.mutateAsync({id:item.id,patch:{dueAt:quickDue(k)}}))}>{k === "today" ? "今天" : k === "tomorrow" ? "明天" : "本周日"} 23:59</button>)}<form onSubmit={e => { e.preventDefault(); if (customDue) void menuAction(() => update.mutateAsync({id:item.id,patch:{dueAt:new Date(customDue).toISOString()}})); }}><label>自定义 <input type="datetime-local" value={customDue} onChange={e => setCustomDue(e.target.value)} /></label><button type="submit">确定</button></form>{item.dueAt && <button onClick={() => void menuAction(() => update.mutateAsync({id:item.id,patch:{dueAt:null}}))}>清除截止日期</button>}</div>}
                <button onClick={() => setTagOpen(!tagOpen)}>标记</button>
                {tagOpen && ([['none','无'],['idea','想法'],['read_later','稍后看']] as const).map(([value,label]) => <button key={value} onClick={() => void menuAction(() => update.mutateAsync({id:item.id,patch:{category:value}}))}>{label}</button>)}
                <button onClick={() => { setMenuOpen(false); void startEdit(); }}>编辑</button>
                <button onClick={() => void menuAction(() => update.mutateAsync({id:item.id,patch:{sensitive:!item.sensitive}}))}>{item.sensitive ? "取消敏感遮罩" : "标记为敏感"}</button>
                {item.sensitiveOverride !== null && <button onClick={() => void menuAction(() => update.mutateAsync({id:item.id,patch:{sensitive:null}}))}>恢复自动识别</button>}
                {urls.length > 0 && <button onClick={() => void menuAction(async () => { const result = await refetchPreview.mutateAsync(item.id); if (result.meta?.preview?.status === "error") throw new Error("preview failed"); }, true)}>刷新链接预览</button>}
                <button onClick={() => void menuAction(() => remove.mutateAsync(item.id))}>移至回收站</button>
              </div>}
            </div>
          </>
        )}
      </fieldset>
    </motion.li>
  );
}
