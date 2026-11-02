import { useCallback, useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { initialTimelineState, timelineParams, type TimelineViewState } from "../lib/timeline";
import { useItems } from "../hooks/useItems";
import { useRealtime } from "../lib/realtime";
import { AccessTokens } from "../components/AccessTokens";
import { ConnectDevices } from "../components/ConnectDevices";
import { ServerInfo } from "../components/ServerInfo";
import { AppMenu } from "../components/AppMenu";
import { canOpenNativeTransfers, openNativeTransfers } from "../lib/nativeTransfers";
import { Composer } from "../components/Composer";
import { EditDraftRecovery } from "../components/EditDraftRecovery";
import { FilterBar } from "../components/FilterBar";
import { Timeline } from "../components/Timeline";
import { useAuth, useAuthAccess } from "../hooks/useAuth";

export function TimelinePage() {
  const [toolsError, setToolsError] = useState("");
  const access = useAuthAccess();
  const [dialog, setDialog] = useState<"connect" | "tokens" | "info" | null>(null);
  const [state, setState] = useState(initialTimelineState);
  const [search, setSearch] = useState(state.query);
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const timer = setTimeout(() => setSearch(state.query), 250); return () => clearTimeout(timer); }, [state.query]);
  useEffect(() => {
    const refreshNow = () => { if (document.visibilityState === "visible") setNow(new Date()); };
    refreshNow();
    const timer = setInterval(refreshNow, 60000);
    window.addEventListener("focus", refreshNow); document.addEventListener("visibilitychange", refreshNow);
    return () => { clearInterval(timer); window.removeEventListener("focus", refreshNow); document.removeEventListener("visibilitychange", refreshNow); };
  }, []);
  const changeState = (next: TimelineViewState) => {
    if ((state.view === "trash") !== (next.view === "trash")) setSearch(next.query);
    if (next.view === "todo" && next.todoScope === "next7days" && (state.view !== "todo" || state.todoScope !== "next7days")) setNow(new Date());
    setState(next);
  };
  const params = timelineParams({ ...state, query: search }, now);
  const { data, isLoading, isError, isPlaceholderData, hasNextPage, fetchNextPage, isFetchingNextPage, refetch } = useItems(params);

  const qc = useQueryClient();
  const refresh = useCallback(() => {
    void qc.invalidateQueries({ queryKey: ["items"] });
  }, [qc]);
  const realtime = useRealtime(refresh, access.authenticated && !access.reauthRequired && !access.exiting);

  const { data: auth } = useAuth();
  const { data: info } = useQuery({ queryKey: ["server", "info"], queryFn: api.info, enabled: state.view === "trash" && access.authenticated && !access.reauthRequired && !access.exiting });


  const items = data?.pages.flatMap((page) => page.items) ?? [];

  const today = now;
  const dateStr = `${today.getFullYear()} · ${today.getMonth() + 1}月${today.getDate()}日`;

  return (
    <div className="app">
      <div className="grain" aria-hidden />
      <main className="shell">
        <header className="masthead">
          <div className="masthead__brand">
            <span className="wordmark">发给自己</span>
            <span className="masthead__sub">SendToMyself · NAS 上的跨设备收件箱</span>
          </div>
          <div className="masthead__right">
            <span className="masthead__date">{dateStr}</span>
            <AppMenu onOpenConnect={() => setDialog("connect")} onOpenTokens={() => setDialog("tokens")}
              onOpenServerInfo={() => setDialog("info")} onOpenTrash={() => changeState({ ...initialTimelineState, view: "trash" })}
              onOpenTransfers={canOpenNativeTransfers() ? () => { setToolsError(""); void openNativeTransfers().catch(() => setToolsError("暂时无法打开传输菜单，请重试")); } : undefined}
              onLogout={auth?.authEnabled ? access.logout : undefined} logoutPending={access.logoutPending} />
          </div>
        </header>

        {!access.reauthRequired && !access.exiting && dialog === "connect" && <ConnectDevices onClose={() => setDialog(null)} />}
        {!access.reauthRequired && !access.exiting && dialog === "tokens" && <AccessTokens onClose={() => setDialog(null)} />}
        {!access.reauthRequired && !access.exiting && dialog === "info" && <ServerInfo status={realtime.status} onClose={() => setDialog(null)} />}
        {access.logoutError && <p role="alert">{access.logoutError}</p>}
        {realtime.status !== "connected" && <p role="status">{realtime.status === "connecting" ? "正在连接" : "实时连接中断，正在重连"} {realtime.status === "reconnecting" && <button onClick={() => void realtime.retry()}>重试</button>} {realtime.retryError}</p>}
        {toolsError && <p role="alert">{toolsError}</p>}
        <Composer />
        <EditDraftRecovery />
        <FilterBar state={state} onChange={changeState} />
        {state.view === "trash" && <p>{info === undefined ? "暂时无法读取保留设置，请以各条目显示的到期时间为准" : info.trashRetentionDays > 0 ? `删除的内容保留 ${info.trashRetentionDays} 天，到期后永久删除。已有旧内容从自动清理启用时开始计时。` : "自动清理已关闭，内容保留到你手动永久删除。"}</p>}
        {isError && (
          <div className="state" role="alert">
            <p>加载失败，已显示的内容仍保留。</p>
            <button onClick={() => void refetch()}>重试加载</button>
          </div>
        )}
        {(!isError || items.length > 0) && <Timeline items={items} now={now} state={state} onChange={changeState} loading={isLoading} pending={isPlaceholderData} />}
        {hasNextPage && !isPlaceholderData && (
          <div className="timeline__more">
            <button className="send" disabled={isFetchingNextPage} onClick={() => void fetchNextPage()}>
              {isFetchingNextPage ? "加载中…" : "加载更多"}
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
