import { AnimatePresence } from "motion/react";
import type { Item } from "@sendtomyself/shared";
import { type GapKind, groupByDay, sameCluster } from "../lib/format";
import type { TimelineViewState } from "../lib/timeline";
import { ItemCard } from "./ItemCard";

export function Timeline({ items, state, onChange, loading, pending }: { items: Item[]; state: TimelineViewState; onChange: (s: TimelineViewState) => void; loading?: boolean; pending?: boolean }) {
  const trash = state.view === "trash";
  if (loading) return <div className="state state--load">载入中…</div>;
  if (items.length === 0 && !pending) {
    const filtered = state.contentType !== "all" || state.category !== "all" || state.sensitiveOnly;
    const title = state.query.trim() ? "没有找到相关内容" : filtered ? "没有符合筛选的内容" : trash ? "回收站是空的" : state.view === "favorites" ? "还没有收藏" : state.view === "todo" ? ({open:"暂无未完成待办",next7days:"未来7天没有到期待办",completed:"还没有已完成待办"})[state.todoScope] : "发给自己的第一条内容";
    const sub = state.query.trim() ? "换个关键词试试" : trash ? "删除的内容会先到这里。" : state.view === "favorites" ? "在内容的更多菜单中选择收藏" : state.view === "todo" && state.todoScope === "open" ? "可在内容的更多菜单中设为待办" : state.view === "all" && !filtered ? "输入文字，或添加图片和文件" : "";
    return <div className="state state--empty"><p className="state__title">{title}</p><p className="state__sub">{sub}</p>{state.query.trim() ? <button onClick={() => onChange({...state,query:""})}>清空搜索</button> : filtered ? <button onClick={() => onChange({...state,contentType:"all",category:"all",sensitiveOnly:false})}>清除筛选</button> : null}</div>;
  }
  const groups = groupByDay(items);
  return (
    <>
    {pending && <div className="state state--load" role="status">正在加载筛选结果…</div>}
    <div className="timeline" style={pending ? { display: "none" } : undefined}>
      {groups.map((g) => (
        <section key={g.key} className="day">
          <div className="day__divider">
            <span>{g.label}</span>
          </div>
          <ul className="day__list">
            <AnimatePresence initial={false}>
              {g.items.map((it, i) => {
                const gap: GapKind =
                  i === 0 ? "first" : sameCluster(g.items[i - 1]!, it) ? "cont" : "normal";
                return <ItemCard key={it.id} item={it} trash={trash} gap={gap} revealEpoch={JSON.stringify(state)} />;
              })}
            </AnimatePresence>
          </ul>
        </section>
      ))}
    </div>
    </>
  );
}
