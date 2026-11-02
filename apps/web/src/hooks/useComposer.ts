import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "../lib/api";
import { clearDraftIfKey, draftGeneration, loadDraft, newDedupeKey, saveDraft, type ComposerDraft } from "../lib/draft";
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
  const attempt = useRef<AbortController | null>(null);
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
    if (attempt.current || !ready) return;
    if (current.current.webSendAttempted) setNotice("将作为新内容发送；上一笔发送结果可能尚未确认");
    const next = { content, files, dedupeKey: newDedupeKey(), webSendAttempted: false };
    current.current = next; setDraft(next); setError(""); setBadFilename(undefined); setDeleted(false);
    void saveDraft(next).then(() => setDraftError(false)).catch(() => setDraftError(true));
  };
  const send = async () => {
    if (attempt.current || !ready || (!draft.content.trim() && !draft.files.length)) return;
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
  return { draft, change, send, ready, pending, draftError, error, notice, progress, info, badFilename, deleted, sendAsNew: () => change(current.current.content, current.current.files), stop: () => attempt.current?.abort() };
}
