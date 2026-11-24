import { captureDetectionContext } from "../lib/detectionContext";
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "../lib/api";
import {
  clearDraftIfKey,
  clearPendingAttempts,
  deletePendingAttempt,
  disownAttempt,
  draftGeneration,
  draftIsWritable,
  listPendingAttempts,
  loadDraft,
  loadSharedDraft,
  newDedupeKey,
  prepareComposerDraft,
  saveDraft,
  selectPendingAttempt,
  type ComposerDraft,
  type PendingAttempt,
} from "../lib/draft";
import { mutationErrorMessage } from "../lib/mutation-error";
import { useAuthAccess } from "./useAuth";
import { useItemMutations } from "./useItems";

export function useComposer() {
  const { create, upload } = useItemMutations();
  const qc = useQueryClient();
  const access = useAuthAccess();
  const infoQuery = useQuery({
    queryKey: ["server", "info"],
    queryFn: api.info,
    enabled: access.authenticated && !access.reauthRequired && !access.exiting,
    retry: false,
  });
  const info = infoQuery.data;
  const infoUpdatedAt = useRef(infoQuery.dataUpdatedAt);
  infoUpdatedAt.current = infoQuery.dataUpdatedAt;
  const [draft, setDraft] = useState<ComposerDraft>({
    content: "",
    files: [],
    dedupeKey: newDedupeKey(),
  });
  const current = useRef(draft);
  const [ready, setReady] = useState(false);
  const [draftError, setDraftError] = useState(false);
  const [error, setError] = useState("");
  const [badFile, setBadFile] = useState<{
    filename: string;
    infoUpdatedAt: number;
    message: string;
  }>();
  const badFilename = badFile?.filename;
  const [deleted, setDeleted] = useState(false);
  const [notice, setNotice] = useState("");
  const [progress, setProgress] = useState<{ loaded: number; total?: number }>();
  const [pending, setPending] = useState(false);
  const [pendingAttempts, setPendingAttempts] = useState<PendingAttempt[]>([]);
  const [selectedAttempt, setSelectedAttempt] = useState(false);
  const attempt = useRef<AbortController | null>(null);
  const busyRef = useRef(false);

  const refreshAttempts = async () => {
    const generation = draftGeneration();
    try {
      const result = await listPendingAttempts();
      if (draftIsWritable() && generation === draftGeneration()) setPendingAttempts(result);
    } catch {
      if (generation === draftGeneration()) setDraftError(true);
    }
  };
  useEffect(() => {
    let active = true;
    void loadDraft()
      .then((saved) => {
        if (!active) return;
        const next = { ...saved, dedupeKey: saved.dedupeKey ?? newDedupeKey() };
        current.current = next;
        setDraft(next);
        setSelectedAttempt(!!saved.webSendAttempted);
      })
      .catch(() => {
        if (active) setDraftError(true);
      })
      .finally(() => {
        if (active) setReady(true);
      });
    void refreshAttempts();
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    const refresh = () => void qc.invalidateQueries({ queryKey: ["items"] });
    window.addEventListener("send-to-myself:transfer-updated", refresh);
    return () => window.removeEventListener("send-to-myself:transfer-updated", refresh);
  }, [qc]);

  const change = (content: string, files: File[]) => {
    if (attempt.current || busyRef.current || !ready) return;
    if (current.current.webSendAttempted)
      setNotice(
        deleted
          ? "上一笔内容已永久删除；修改后将作为新内容发送"
          : "将作为新内容发送；上一笔发送结果可能尚未确认",
      );
    disownAttempt();
    setSelectedAttempt(false);
    const next = { content, files, dedupeKey: newDedupeKey(), webSendAttempted: false };
    current.current = next;
    setDraft(next);
    setError("");
    setBadFile(undefined);
    setDeleted(false);
    void saveDraft(next)
      .then(() => setDraftError(false))
      .catch(() => setDraftError(true));
  };
  const exceedsLimit = (files: File[]) =>
    !!info &&
    (files.some((file) => file.size > info.maxUploadBytes) ||
      files.length > info.maxUploadFiles ||
      files.reduce((sum, file) => sum + file.size, 0) > info.maxUploadTotalBytes);
  const overLimit = exceedsLimit(draft.files);
  useEffect(() => {
    if (!badFile || !info || infoQuery.dataUpdatedAt <= badFile.infoUpdatedAt) return;
    const matching = draft.files.filter((file) => file.name === badFile.filename);
    if (matching.length && matching.every((file) => file.size <= info.maxUploadBytes)) {
      setBadFile(undefined);
      setError((currentError) => (currentError === badFile.message ? "" : currentError));
    }
  }, [badFile, draft.files, info, infoQuery.dataUpdatedAt]);
  const allowed = (value: ComposerDraft, newIntent = false) =>
    (value.content.trim().length > 0 || value.files.length > 0) &&
    !pending &&
    ready &&
    !exceedsLimit(value.files) &&
    !badFilename &&
    (newIntent || !deleted);
  const canSend = allowed(draft);

  const applySharedDraft = async (generation: number, message = "") => {
    try {
      const saved = await loadSharedDraft();
      if (!draftIsWritable() || generation !== draftGeneration()) return;
      const next = { ...saved, dedupeKey: saved.dedupeKey ?? newDedupeKey() };
      current.current = next;
      setDraft(next);
      setSelectedAttempt(!!saved.webSendAttempted);
      setError("");
      setDeleted(false);
      setBadFile(undefined);
      setNotice(message);
    } catch {
      if (generation === draftGeneration()) {
        setDraftError(true);
        setSelectedAttempt(true);
        setNotice(message);
      }
    }
  };

  const send = async (newDraft?: ComposerDraft, expectedKey?: string) => {
    if (attempt.current || busyRef.current || !allowed(newDraft ?? current.current, !!newDraft))
      return;
    const controller = new AbortController();
    attempt.current = controller;
    setPending(true);
    setError("");
    setNotice("");
    setProgress(undefined);
    const source = newDraft ?? current.current;
    const snapshot = {
      ...source,
      files: [...source.files],
      detectionContext: source.detectionContext ?? captureDetectionContext(),
      webSendAttempted: true,
    };
    const generation = draftGeneration();
    current.current = snapshot;
    setDraft(snapshot);
    try {
      const owned = await prepareComposerDraft(snapshot, expectedKey ?? source.dedupeKey);
      setDraftError(!owned);
    } catch {
      setDraftError(true);
    }
    if (!draftIsWritable() || generation !== draftGeneration()) {
      attempt.current = null;
      setPending(false);
      return;
    }
    try {
      if (snapshot.files.length)
        await upload.mutateAsync({
          content: snapshot.content,
          files: snapshot.files,
          dedupeKey: snapshot.dedupeKey,
          options: {
            signal: controller.signal,
            onProgress: setProgress,
            detectionContext: snapshot.detectionContext,
          },
        });
      else
        await create.mutateAsync({
          content: snapshot.content,
          dedupeKey: snapshot.dedupeKey,
          detectionContext: snapshot.detectionContext,
        });
      if (generation === draftGeneration() && attempt.current === controller) {
        try {
          await clearDraftIfKey(snapshot.dedupeKey!, generation);
          if (generation === draftGeneration()) setDraftError(false);
        } catch {
          if (generation === draftGeneration()) setDraftError(true);
        }
        if (generation === draftGeneration() && current.current.dedupeKey === snapshot.dedupeKey) {
          await applySharedDraft(generation);
        }
      }
    } catch (err) {
      if (generation === draftGeneration()) {
        if (err instanceof DOMException && err.name === "AbortError") {
          setError("已停止本机上传，NAS 是否已保存尚未确认。内容已保留，可原样重试。");
          void qc.invalidateQueries({ queryKey: ["items"] });
        } else {
          const message = mutationErrorMessage(err, "发送");
          setError(message);
          if (
            err instanceof ApiError &&
            err.code === "file_too_large" &&
            typeof err.details?.filename === "string"
          )
            setBadFile({
              filename: err.details.filename,
              infoUpdatedAt: infoUpdatedAt.current,
              message,
            });
          if (err instanceof ApiError && err.code === "already_deleted") setDeleted(true);
        }
      }
    } finally {
      if (attempt.current === controller) {
        attempt.current = null;
        setPending(false);
        void refreshAttempts();
      }
    }
  };

  const restoreAttempt = async (key: string) => {
    if (!ready || pending || attempt.current || busyRef.current) return;
    busyRef.current = true;
    setPending(true);
    const generation = draftGeneration();
    try {
      const saved = await selectPendingAttempt(key);
      if (!draftIsWritable() || generation !== draftGeneration()) return;
      if (!saved) {
        await refreshAttempts();
        return;
      }
      current.current = saved;
      setDraft(saved);
      setSelectedAttempt(true);
      setDeleted(false);
      setBadFile(undefined);
      setNotice("");
      setError("");
    } catch {
      if (generation === draftGeneration()) setDraftError(true);
    } finally {
      busyRef.current = false;
      if (generation === draftGeneration()) setPending(false);
    }
  };
  const restoreShared = async () => {
    if (!ready || pending || attempt.current || busyRef.current) return;
    busyRef.current = true;
    setPending(true);
    const generation = draftGeneration();
    try {
      if (!draftIsWritable() || generation !== draftGeneration()) return;
      disownAttempt();
      await applySharedDraft(generation);
    } catch {
      if (generation === draftGeneration()) setDraftError(true);
    } finally {
      busyRef.current = false;
      if (generation === draftGeneration()) setPending(false);
    }
  };
  const removeAttempt = async (key: string) => {
    if (!ready || pending || attempt.current || busyRef.current) return;
    busyRef.current = true;
    setPending(true);
    const generation = draftGeneration();
    try {
      await deletePendingAttempt(key);
      if (!draftIsWritable() || generation !== draftGeneration()) return;
      if (current.current.dedupeKey === key) await applySharedDraft(generation);
      await refreshAttempts();
    } catch {
      if (generation === draftGeneration()) setDraftError(true);
    } finally {
      busyRef.current = false;
      if (generation === draftGeneration()) setPending(false);
    }
  };
  const clearAttempts = async () => {
    if (!ready || pending || attempt.current || busyRef.current) return;
    busyRef.current = true;
    setPending(true);
    const generation = draftGeneration();
    try {
      await clearPendingAttempts();
      if (!draftIsWritable() || generation !== draftGeneration()) return;
      if (selectedAttempt || current.current.webSendAttempted) await applySharedDraft(generation);
      await refreshAttempts();
    } catch {
      if (generation === draftGeneration()) setDraftError(true);
    } finally {
      busyRef.current = false;
      if (generation === draftGeneration()) setPending(false);
    }
  };

  return {
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
    sendAsNew: () => {
      if (attempt.current || busyRef.current || !ready) return;
      const previousKey = current.current.dedupeKey;
      const next = {
        content: current.current.content,
        files: current.current.files,
        dedupeKey: newDedupeKey(),
        webSendAttempted: false,
      };
      current.current = next;
      setDraft(next);
      setError("");
      setDeleted(false);
      void send(next, previousKey);
    },
    stop: () => attempt.current?.abort(),
  };
}
