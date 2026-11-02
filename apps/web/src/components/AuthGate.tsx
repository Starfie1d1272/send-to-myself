import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AuthAccessContext, useAuth } from "../hooks/useAuth";
import { api, ApiError, freezeBusiness } from "../lib/api";
import { freezeDraft, resumeDraftSession, retireDraftSession } from "../lib/draft";
import { getNativeBridge, hasNativeAuth } from "../lib/nativeBridge";
import { LoginView } from "./LoginView";

function parseNative(raw: string): Record<string, unknown> {
  const result: unknown = JSON.parse(raw);
  if (!result || typeof result !== "object" || Array.isArray(result)) throw new Error("INVALID_RESULT");
  const value = result as Record<string, unknown>;
  if (value.serverOrigin !== window.location.origin) throw new Error("INVALID_RESULT");
  return value;
}

export function AuthGate({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const qc = useQueryClient();
  const [entered, setEntered] = useState(false);
  const [signedOut, setSignedOut] = useState(false);
  const [exiting, setExiting] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [confirmationPending, setConfirmationPending] = useState(false);
  const cleanup = useRef<Promise<void> | null>(null);
  const lastRemoteLogout = useRef("");
  const native = hasNativeAuth();
  const authenticated = !!auth.data && (!auth.data.authEnabled || auth.data.authenticated) && !signedOut;
  const reauthRequired = entered && !signedOut && !!auth.data && auth.data.authEnabled && !auth.data.authenticated;
  useEffect(() => { if (authenticated) setEntered(true); }, [authenticated]);

  const finishLogout = useCallback(() => {
    if (cleanup.current) return cleanup.current;
    freezeBusiness(true); freezeDraft(true); setExiting(true); setSignedOut(true);
    cleanup.current = (async () => {
      await qc.cancelQueries();
      let failed = false;
      const noticeId = `${Date.now()}-${Math.random()}`;
      if (typeof BroadcastChannel !== "undefined") { const channel = new BroadcastChannel("send-to-myself-session"); channel.postMessage(noticeId); channel.close(); }
      try { localStorage.setItem("send-to-myself-session-logout", noticeId); } catch { /* cross-window notification is best effort */ }
      try { await retireDraftSession(); } catch { failed = true; }
      qc.clear();
      qc.setQueryData(["auth", "me"], { authEnabled: true, authenticated: false });
      setEntered(false);
      if (failed) setNotice("已退出，但部分本机草稿未能清理");
    })();
    return cleanup.current;
  }, [qc]);
  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ serverOrigin?: string }>).detail;
      if (detail?.serverOrigin === window.location.origin) void finishLogout();
    };
    window.addEventListener("send-to-myself:host-logout", handler);
    return () => window.removeEventListener("send-to-myself:host-logout", handler);
  }, [finishLogout]);
  useEffect(() => {
    const recheck = () => { void qc.invalidateQueries({ queryKey: ["auth", "me"] }); };
    // Images and download navigations do not expose HTTP status to the page.
    // Check the existing session when a protected image fails or a download starts.
    const imageError = (event: Event) => {
      if (!(event.target instanceof HTMLImageElement)) return;
      try { const url = new URL(event.target.currentSrc || event.target.src, window.location.href); if (url.origin === window.location.origin && url.pathname.startsWith("/api/")) recheck(); } catch { /* invalid resource URL */ }
    };
    const download = (event: Event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const link = target.closest("a[download]");
      if (!(link instanceof HTMLAnchorElement)) return;
      try { const url = new URL(link.href, window.location.href); if (url.origin === window.location.origin && url.pathname.startsWith("/api/attachments/")) recheck(); } catch { /* invalid resource URL */ }
    };
    window.addEventListener("send-to-myself:auth-check", recheck);
    window.addEventListener("error", imageError, true);
    window.addEventListener("click", download, true);
    return () => { window.removeEventListener("send-to-myself:auth-check", recheck); window.removeEventListener("error", imageError, true); window.removeEventListener("click", download, true); };
  }, [qc]);

  useEffect(() => {
    const stop = (noticeId: string) => {
      if (!noticeId || lastRemoteLogout.current === noticeId) return;
      lastRemoteLogout.current = noticeId;
      freezeBusiness(true); freezeDraft(true); setExiting(false); setSignedOut(true); setEntered(false);
      void qc.cancelQueries(); qc.clear(); qc.setQueryData(["auth", "me"], { authEnabled: true, authenticated: false });
    };
    const channel = typeof BroadcastChannel === "undefined" ? undefined : new BroadcastChannel("send-to-myself-session");
    if (channel) channel.onmessage = event => { if (typeof event.data === "string") stop(event.data); };
    const storage = (event: StorageEvent) => { if (event.key === "send-to-myself-session-logout" && event.newValue) stop(event.newValue); };
    const stale = () => stop(`stale-${Date.now()}`);
    window.addEventListener("storage", storage);
    window.addEventListener("send-to-myself:session-stale", stale);
    return () => { channel?.close(); window.removeEventListener("storage", storage); window.removeEventListener("send-to-myself:session-stale", stale); };
  }, [qc]);

  const submit = async (password: string): Promise<boolean> => {
    setPending(true); setError("");
    try {
      if (native && !confirmationPending) {
        const result = parseNative(await getNativeBridge()!.reauthenticate!());
        if (result.status === "cancelled") return false;
        if (result.status !== "authenticated" || typeof result.revision !== "string" || !result.revision) throw new Error("INVALID_RESULT");
      } else if (!native && !confirmationPending) {
        await api.login(password);
      }
      let state;
      try { state = await api.me(); } catch { setConfirmationPending(true); setError("登录结果暂时无法确认，请重试连接"); return false; }
      if (!state.authenticated) { setConfirmationPending(false); setError("口令已验证，但登录会话未建立。请核对 HTTP/HTTPS 和 Cookie 配置"); return false; }
      setConfirmationPending(false); cleanup.current = null; setSignedOut(false); setExiting(false); setNotice("");
      await resumeDraftSession(true).catch(() => {});
      freezeDraft(false); freezeBusiness(false);
      qc.setQueryData(["auth", "me"], state);
      void qc.invalidateQueries({ queryKey: ["items"] });
      return true;
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) { setError("口令不正确，请重新输入"); return true; }
      if (err instanceof ApiError && err.status === 429) {
        let retry = 0; try { retry = Number(JSON.parse(err.message).retryAfter); } catch { /* optional */ }
        setError(`尝试过多，请稍后重试${Number.isFinite(retry) && retry > 0 ? `（${Math.ceil(retry)} 秒）` : ""}`);
      } else if (err instanceof ApiError && err.status >= 500) setError("NAS 服务暂时不可用，请稍后重试");
      else setError(native ? "应用中重新登录未完成，请重试" : "暂时无法连接 NAS，请检查网络或地址");
      return false;
    } finally { setPending(false); }
  };
  const logout = async () => {
    if (pending) return;
    setPending(true); setError(""); setExiting(true); freezeBusiness(true); freezeDraft(true);
    try {
      if (native) {
        const raw = await Promise.race([getNativeBridge()!.logout!(), new Promise<never>((_, reject) => setTimeout(() => reject(new Error("TIMEOUT")), 15000))]);
        const result = parseNative(raw);
        if (result.status !== "signed_out" || typeof result.cookieCleared !== "boolean" || !["complete", "unconfirmed"].includes(String(result.transferStop)) || !["complete", "unconfirmed"].includes(String(result.remoteSessionLogout))) throw new Error("INVALID_RESULT");
        await finishLogout();
        let message = "已退出当前连接，待发送内容和本机文件已保留。服务端设备令牌未自动撤销。";
        if (!result.cookieCleared) message += " 网页会话清理未完成，请重试清理。";
        if (result.transferStop === "unconfirmed") message += " 部分在途传输尚未确认停止，请在传输任务中查看。";
        if (result.remoteSessionLogout === "unconfirmed") message += " 未能确认NAS上的网页会话已注销。";
        setNotice(old => [old, message].filter(Boolean).join(" "));
      } else { await api.logout(); await finishLogout(); }
    } catch (err) {
      if (cleanup.current) { await cleanup.current; setNotice(old => `${old} 退出结果未完全确认，请在原生页面核对。`); }
      else if (native && !(err instanceof Error && ["LOCAL_STORAGE_FAILED", "CONNECTION_CHANGED", "AUTH_BUSY"].includes(err.message))) {
        setError("退出结果未确认，请重试或进入原生页面核对。");
      } else { setExiting(false); freezeDraft(false); freezeBusiness(false); setError("退出失败，请重试。"); }
    } finally { setPending(false); }
  };
  if (!entered && !signedOut && auth.isLoading) return <div className="state">正在连接…</div>;
  if (!entered && !signedOut && auth.isError && !auth.data) return <div className="state"><p>暂时无法连接 NAS，请检查网络或地址</p><button onClick={() => void auth.refetch()}>重试</button></div>;
  const login = <LoginView submit={submit} native={native} pending={pending} error={error} notice={notice} />;
  if (signedOut || (!entered && !authenticated)) return login;
  const blocked = reauthRequired || exiting;
  return <AuthAccessContext.Provider value={{ authenticated, reauthRequired, exiting, logout: () => void logout(), logoutPending: pending, logoutError: error }}>
    <div inert={blocked || undefined} aria-hidden={blocked || undefined}>{children}</div>
    {blocked && <div style={{ position: "fixed", inset: 0, zIndex: 10000, background: "#f6f1e8", overflow: "auto" }}>
      {reauthRequired && !exiting ? <LoginView submit={submit} native={native} pending={pending} error={error} modal /> : <main className="login"><div className="login__card"><p>{error || "正在退出…"}</p>{!pending && <><button onClick={() => void logout()}>重试退出</button>{getNativeBridge()?.openTools && <button onClick={() => void getNativeBridge()?.openTools?.()}>进入原生传输页面核对</button>}</>}</div></main>}
    </div>}
  </AuthAccessContext.Provider>;
}
