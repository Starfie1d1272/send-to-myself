import { useCallback, useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "./api";

export type RealtimeStatus = "connecting" | "connected" | "reconnecting";
export function subscribeRealtime(
  onChange: () => void,
  onStatus?: (status: RealtimeStatus) => void,
): () => void {
  const es = new EventSource("/api/realtime");
  es.addEventListener("open", () => {
    onStatus?.("connected");
    onChange();
  });
  es.addEventListener("error", () => onStatus?.("reconnecting"));
  for (const event of ["item.created", "item.updated", "item.deleted"])
    es.addEventListener(event, onChange);
  return () => es.close();
}
export function useRealtime(onChange: () => void, enabled: boolean) {
  const [status, setStatus] = useState<RealtimeStatus>("connecting");
  const [generation, setGeneration] = useState(0);
  const [retryError, setRetryError] = useState("");
  const qc = useQueryClient();
  useEffect(() => {
    if (!enabled) return;
    setStatus("connecting");
    let active = true;
    let checking = false;
    const unsubscribe = subscribeRealtime(onChange, (state) => {
      setStatus(state);
      if (state !== "reconnecting" || checking) return;
      checking = true;
      void api
        .me()
        .then((auth) => {
          if (active) qc.setQueryData(["auth", "me"], auth);
        })
        .catch(() => {})
        .finally(() => {
          checking = false;
        });
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [onChange, enabled, generation, qc]);
  const retry = useCallback(async () => {
    setRetryError("");
    try {
      const state = await api.me();
      qc.setQueryData(["auth", "me"], state);
      if (state.authenticated) setGeneration((n) => n + 1);
    } catch {
      setRetryError("暂时无法连接 NAS，请检查网络或地址");
    }
  }, [qc]);
  return { status, retry, retryError };
}
