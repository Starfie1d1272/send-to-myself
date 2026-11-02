import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "../lib/api";
import { clearDraftIfKey, clearNativeHandoffIfKey, draftGeneration, draftIsWritable, loadDraft, newDedupeKey, saveDraft, type ComposerDraft } from "../lib/draft";
import { canOpenNativeUpload, openNativeUpload, readNativeUploadReceipt } from "../lib/nativeTransfers";
import { mutationErrorMessage } from "../lib/mutation-error";
import { useAuthAccess } from "./useAuth";
import { useItemMutations } from "./useItems";

export function useComposer() {
  const { create, upload } = useItemMutations();
  const qc = useQueryClient();
  const access = useAuthAccess();
  const info = useQuery({ queryKey: ["server", "info"], queryFn: api.info, enabled: access.authenticated && !access.reauthRequired && !access.exiting, retry: false }).data;
  const [draft, setDraft] = useState<ComposerDraft>({ content: "", files: [], dedupeKey: newDedupeKey() });
  const current = useRef(draft);
  const [ready, setReady] = useState(false);
  const [draftError, setDraftError] = useState(false);
  const [error, setError] = useState("");
  const [badFilename, setBadFilename] = useState<string>();
  const [deleted, setDeleted] = useState(false);
  const [notice, setNotice] = useState("");
  const [progress, setProgress] = useState<{ loaded: number; total?: number }>();
  const [pending, setPending] = useState(false);
  const [webFallback, setWebFallback] = useState(false);
  const [newRequired, setNewRequired] = useState(false);
  const attempt = useRef<AbortController | null>(null);
  const handoffBusy = useRef(false);
  useEffect(() => {
    let active = true;
    void loadDraft().then(saved => {
      if (!active) return;
      const next = { ...saved, dedupeKey: saved.dedupeKey ?? newDedupeKey() };
      current.current = next; setDraft(next);
    }).catch(() => { if (active) setDraftError(true); }).finally(() => { if (active) setReady(true); });
    return () => { active = false; };
  }, []);
  const change = (content: string, files: File[]) => {
    if (attempt.current || handoffBusy.current || !ready) return;
    if (current.current.nativeHandoffPending && content === current.current.content) { setError("交接结果尚未确认，请查看传输任务或重新检查"); return; }
    if (current.current.webSendAttempted || current.current.nativeHandoffPending) setNotice("将作为新内容发送；上一笔发送结果可能尚未确认");
    const next = { content, files, dedupeKey: newDedupeKey(), webSendAttempted: false };
    current.current = next; setDraft(next); setError(""); setBadFilename(undefined); setDeleted(false);
    void saveDraft(next).then(() => setDraftError(false)).catch(() => setDraftError(true));
  };
  const exceedsLimit = (files: File[]) => !!info && (files.some(file => file.size > info.maxUploadBytes) || files.length > info.maxUploadFiles || files.reduce((sum, file) => sum + file.size, 0) > info.maxUploadTotalBytes);
  const overLimit = exceedsLimit(draft.files);
  const allowed = (value: ComposerDraft) => (value.content.trim().length > 0 || value.files.length > 0) && !pending && ready && !exceedsLimit(value.files) && !badFilename && !deleted && !value.nativeHandoffPending;
  const canSend = allowed(draft);
  const accepted = async (key: string, generation: number) => {
    if (!draftIsWritable() || generation !== draftGeneration()) return;
    try { await clearDraftIfKey(key, generation); if (generation === draftGeneration()) setDraftError(false); }
    catch { if (generation === draftGeneration()) setDraftError(true); }
    if (generation === draftGeneration() && current.current.dedupeKey === key) {
      const next = { content: "", files: [], dedupeKey: newDedupeKey(), webSendAttempted: false };
      current.current = next; setDraft(next); setError(""); setNotice("已保存在本机，等待发送");
    }
  };
  const checkReceipt = async () => {
    const snapshot = current.current;
    const generation = draftGeneration();
    if (!draftIsWritable() || !snapshot.nativeHandoffPending || !snapshot.dedupeKey) return;
    try {
      if ((await readNativeUploadReceipt(snapshot.dedupeKey)).status === "accepted") await accepted(snapshot.dedupeKey, generation);
      else if (generation === draftGeneration() && current.current.dedupeKey === snapshot.dedupeKey) setError("交接结果尚未确认，请查看传输任务或重新检查");
    } catch { if (generation === draftGeneration() && current.current.dedupeKey === snapshot.dedupeKey) setError("交接结果尚未确认，请查看传输任务或重新检查"); }
  };
  useEffect(() => { if (ready && current.current.nativeHandoffPending) void checkReceipt(); }, [ready]);
  useEffect(() => {
    const refresh = () => { void qc.invalidateQueries({ queryKey: ["items"] }); void checkReceipt(); };
    window.addEventListener("send-to-myself:transfer-updated", refresh);
    return () => window.removeEventListener("send-to-myself:transfer-updated", refresh);
  }, [qc]);
  const addNative = async (): Promise<boolean> => {
    const snapshot = current.current;
    if (!ready || pending || attempt.current || handoffBusy.current || snapshot.nativeHandoffPending) return true;
    if (!canOpenNativeUpload() || snapshot.files.length) return false;
    if (snapshot.webSendAttempted) { setNewRequired(true); setError("原发送可能已到达 NAS，添加附件将作为新内容发送"); return true; }
    handoffBusy.current = true; setPending(true);
    const generation = draftGeneration();
    const marked: ComposerDraft = { ...snapshot, nativeHandoffPending: true };
    try { await saveDraft(marked); if (generation === draftGeneration()) setDraftError(false); }
    catch { if (generation === draftGeneration()) { setDraftError(true); setWebFallback(true); setPending(false); } handoffBusy.current = false; return true; }
    if (generation !== draftGeneration()) { handoffBusy.current = false; return true; }
    current.current = marked; setDraft(marked); setPending(true); setError(""); setWebFallback(false);
    try {
      const result = await openNativeUpload(marked.content, marked.dedupeKey!);
      if (result.status === "queued") await accepted(marked.dedupeKey!, generation);
      else if (result.status === "cancelled" || result.status === "not_queued") {
        await clearNativeHandoffIfKey(marked.dedupeKey!, generation);
        if (generation === draftGeneration() && current.current.dedupeKey === marked.dedupeKey) {
          const next = { ...marked, nativeHandoffPending: undefined };
          current.current = next; setDraft(next);
          if (result.status === "not_queued") setError("附件准备失败，草稿已保留");
        }
      } else if (generation === draftGeneration() && current.current.dedupeKey === marked.dedupeKey) setError("交接结果尚未确认，请查看传输任务或重新检查");
    } catch { if (generation === draftGeneration() && current.current.dedupeKey === marked.dedupeKey) setError("交接结果尚未确认，请查看传输任务或重新检查"); }
    finally { handoffBusy.current = false; if (generation === draftGeneration()) setPending(false); }
    return true;
  };
  const send = async () => {
    if (attempt.current || handoffBusy.current || !allowed(current.current)) return;
    const controller = new AbortController(); attempt.current = controller; setPending(true); setError(""); setNotice(""); setProgress(undefined);
    const snapshot = { ...current.current, files: [...current.current.files], webSendAttempted: true };
    const generation = draftGeneration();
    current.current = snapshot; setDraft(snapshot);
    try { await saveDraft(snapshot); setDraftError(false); } catch { setDraftError(true); }
    try {
      if (snapshot.files.length) await upload.mutateAsync({ content: snapshot.content, files: snapshot.files, dedupeKey: snapshot.dedupeKey, options: { signal: controller.signal, onProgress: setProgress } });
      else await create.mutateAsync({ content: snapshot.content, dedupeKey: snapshot.dedupeKey });
      if (generation === draftGeneration() && attempt.current === controller) {
        await clearDraftIfKey(snapshot.dedupeKey!).catch(() => setDraftError(true));
        const next = { content: "", files: [], dedupeKey: newDedupeKey(), webSendAttempted: false };
        current.current = next; setDraft(next); setNotice("已发送");
      }
    } catch (err) {
      if (generation === draftGeneration()) {
        if (err instanceof DOMException && err.name === "AbortError") {
          setError("已停止本机上传，NAS 是否已保存尚未确认。内容已保留，可原样重试。");
          void qc.invalidateQueries({ queryKey: ["items"] });
        } else {
          setError(mutationErrorMessage(err, "发送"));
          if (err instanceof ApiError && err.code === "file_too_large" && typeof err.details?.filename === "string") setBadFilename(err.details.filename);
          if (err instanceof ApiError && err.code === "already_deleted") setDeleted(true);
        }
      }
    } finally { if (attempt.current === controller) { attempt.current = null; setPending(false); } }
  };
  return { draft, change, send, addNative, checkReceipt, webFallback, newRequired, canSend, overLimit, ready, pending, draftError, error, notice, progress, info, badFilename, deleted, sendAsNew: () => {
    if (attempt.current || handoffBusy.current || !ready) return;
    const next = { content: current.current.content, files: current.current.files, dedupeKey: newDedupeKey(), webSendAttempted: false };
    current.current = next; setDraft(next); setNewRequired(false); setError(""); setDeleted(false);
    setNotice("旧任务可能仍在发送，重新发送可能重复");
    void saveDraft(next).then(() => setDraftError(false)).catch(() => setDraftError(true));
  }, stop: () => attempt.current?.abort() };
}
