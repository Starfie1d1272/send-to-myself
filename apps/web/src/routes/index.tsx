import { useCallback, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { timelineParams } from "../lib/timeline";
import { useItems } from "../hooks/useItems";
import { useRealtime } from "../lib/realtime";
import { Composer } from "../components/Composer";
import { FilterBar, type FilterKey } from "../components/FilterBar";
import { Timeline } from "../components/Timeline";
import { IconLogout } from "../components/icons";
import { useAuth, useAuthActions } from "../hooks/useAuth";

export function TimelinePage() {
  const [filter, setFilter] = useState<FilterKey>("all");
  const [query, setQuery] = useState("");
  const params = useMemo(() => timelineParams(filter, query), [filter, query]);
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
