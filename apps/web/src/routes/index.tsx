import { useCallback, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { timelineParams } from "../lib/timeline";
import { useItems } from "../hooks/useItems";
import { useRealtime } from "../lib/realtime";
import { AccessTokens } from "../components/AccessTokens";
import { ConnectDevices } from "../components/ConnectDevices";
import { ServerInfo } from "../components/ServerInfo";
import { AppMenu } from "../components/AppMenu";
import { getNativeBridge } from "../lib/nativeBridge";
import { Composer } from "../components/Composer";
import { FilterBar, type FilterKey } from "../components/FilterBar";
import { Timeline } from "../components/Timeline";
import { useAuth, useAuthAccess } from "../hooks/useAuth";

export function TimelinePage() {
  const [toolsError, setToolsError] = useState("");
  const native = getNativeBridge();
  const access = useAuthAccess();
  const [dialog, setDialog] = useState<"connect" | "tokens" | "info" | null>(null);
  const [filter, setFilter] = useState<FilterKey>("all");
  const [query, setQuery] = useState("");
  const params = timelineParams(filter, query);
  const { data, isLoading, isError, hasNextPage, fetchNextPage, isFetchingNextPage, refetch } = useItems(params);

  const qc = useQueryClient();
  const refresh = useCallback(() => {
    void qc.invalidateQueries({ queryKey: ["items"] });
  }, [qc]);
  const realtime = useRealtime(refresh, access.authenticated && !access.reauthRequired && !access.exiting);

  const { data: auth } = useAuth();
  const { data: info } = useQuery({ queryKey: ["server", "info"], queryFn: api.info, enabled: filter === "trash" && access.authenticated && !access.reauthRequired && !access.exiting });


  const items = data?.pages.flatMap((page) => page.items) ?? [];

  const now = new Date();
  const dateStr = `${now.getFullYear()} · ${now.getMonth() + 1}月${now.getDate()}日`;

  return (
    <div className="app">
      <div className="grain" aria-hidden />
      <main className="shell">
        <header className="masthead">
          <div className="masthead__brand">
            <span className="wordmark">SendToMyself</span>
            <span className="masthead__sub">发给自己 · 统一信息流</span>
          </div>
          <div className="masthead__right">
            <span className="masthead__date">{dateStr}</span>
            <AppMenu onOpenConnect={() => setDialog("connect")} onOpenTokens={() => setDialog("tokens")}
              onOpenServerInfo={() => setDialog("info")} onOpenTrash={() => setFilter("trash")}
              onOpenTransfers={typeof native?.openTools === "function" ? () => { setToolsError(""); void native.openTools!().catch(() => setToolsError("暂时无法打开传输菜单，请重试")); } : undefined}
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
        <FilterBar active={filter} onChange={setFilter} query={query} onQuery={setQuery} />
        {filter === "trash" && <p>{info === undefined ? "暂时无法读取保留设置，请以各条目显示的到期时间为准" : info.trashRetentionDays > 0 ? `删除的内容保留 ${info.trashRetentionDays} 天，到期后永久删除。已有旧内容从自动清理启用时开始计时。` : "自动清理已关闭，内容保留到你手动永久删除。"}</p>}
        {isError && (
          <div className="state" role="alert">
            <p>加载失败，已显示的内容仍保留。</p>
            <button onClick={() => void refetch()}>重试加载</button>
          </div>
        )}
        {(!isError || items.length > 0) && <Timeline items={items} trash={filter === "trash"} loading={isLoading} />}
        {hasNextPage && (
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
