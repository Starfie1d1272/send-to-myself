import { useCallback, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { timelineParams } from "../lib/timeline";
import { useItems } from "../hooks/useItems";
import { useRealtime } from "../lib/realtime";
import { DeviceAccess } from "../components/DeviceAccess";
import { Composer } from "../components/Composer";
import { FilterBar, type FilterKey } from "../components/FilterBar";
import { Timeline } from "../components/Timeline";
import { IconLogout } from "../components/icons";
import { useAuth, useAuthActions } from "../hooks/useAuth";

export function TimelinePage() {
  const [toolsError, setToolsError] = useState("");
  const native = (window as Window & { stmNative?: { openTools?: () => Promise<string> } }).stmNative;
  const [devicesOpen, setDevicesOpen] = useState(false);
  const [filter, setFilter] = useState<FilterKey>("all");
  const [query, setQuery] = useState("");
  const params = timelineParams(filter, query);
  const { data, isLoading, isError, hasNextPage, fetchNextPage, isFetchingNextPage, refetch } = useItems(params);

  const qc = useQueryClient();
  const refresh = useCallback(() => {
    void qc.invalidateQueries({ queryKey: ["items"] });
  }, [qc]);
  useRealtime(refresh);

  const { data: auth } = useAuth();
  const { logout } = useAuthActions();

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
            <button className="masthead__devices" onClick={() => setDevicesOpen(true)}>设备接入</button>
            {typeof native?.openTools === "function" && (
              <button className="icon-btn" aria-label="文件与传输" title="文件与传输"
                onClick={() => { setToolsError(""); void native.openTools!().catch(() => setToolsError("暂时无法打开传输菜单，请重试")); }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <circle cx="5" cy="12" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="19" cy="12" r="2" />
                </svg>
              </button>
            )}
            {auth?.authEnabled && (
              <button
                className="icon-btn"
                title="退出登录"
                onClick={() => logout.mutate()}
              >
                <IconLogout width={17} height={17} />
              </button>
            )}
          </div>
        </header>

        {devicesOpen && <DeviceAccess onClose={() => setDevicesOpen(false)} />}
        {toolsError && <p role="alert">{toolsError}</p>}
        <Composer />
        <FilterBar active={filter} onChange={setFilter} query={query} onQuery={setQuery} />
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
