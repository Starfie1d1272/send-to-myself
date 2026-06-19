import { useCallback, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { ListParams } from "../lib/api";
import { useItems } from "../hooks/useItems";
import { useRealtime } from "../lib/realtime";
import { dueBucket, itemUrls } from "../lib/format";
import { Composer } from "../components/Composer";
import { FilterBar, type FilterKey } from "../components/FilterBar";
import { Timeline } from "../components/Timeline";

function toParams(f: FilterKey, q: string): ListParams {
  const base: ListParams = { limit: 100 };
  if (q) base.q = q;
  switch (f) {
    case "todo":
      return { ...base, isTodo: true, completed: false };
    case "due":
      return { ...base, isTodo: true };
    case "idea":
      return { ...base, category: "idea" };
    case "read_later":
      return { ...base, category: "read_later" };
    case "pinned":
      return { ...base, pinned: true };
    case "completed":
      return { ...base, completed: true };
    case "trash":
      return { ...base, deleted: true };
    default:
      return base; // all / link
  }
}

export function TimelinePage() {
  const [filter, setFilter] = useState<FilterKey>("all");
  const [query, setQuery] = useState("");
  const params = useMemo(() => toParams(filter, query), [filter, query]);
  const { data, isLoading } = useItems(params);

  const qc = useQueryClient();
  const refresh = useCallback(() => {
    void qc.invalidateQueries({ queryKey: ["items"] });
  }, [qc]);
  useRealtime(refresh);

  let items = data?.items ?? [];
  if (filter === "due") {
    items = items.filter(
      (i) => !i.completed && ["overdue", "today", "tomorrow", "this_week"].includes(dueBucket(i.dueAt)),
    );
  }
  if (filter === "link") items = items.filter((i) => itemUrls(i).length > 0);

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
          <span className="masthead__date">{dateStr}</span>
        </header>

        <Composer />
        <FilterBar active={filter} onChange={setFilter} query={query} onQuery={setQuery} />
        <Timeline items={items} trash={filter === "trash"} loading={isLoading} />
      </main>
    </div>
  );
}
