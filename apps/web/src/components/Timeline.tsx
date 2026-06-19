import { AnimatePresence } from "motion/react";
import type { Item } from "@sendtomyself/shared";
import { type GapKind, groupByDay, sameCluster } from "../lib/format";
import { ItemCard } from "./ItemCard";

export function Timeline({
  items,
  trash,
  loading,
}: {
  items: Item[];
  trash?: boolean;
  loading?: boolean;
}) {
  if (loading) {
    return <div className="state state--load">载入中…</div>;
  }
  if (items.length === 0) {
    return (
      <div className="state state--empty">
        <p className="state__title">{trash ? "回收站是空的" : "还没有任何东西"}</p>
        <p className="state__sub">
          {trash ? "删除的内容会先到这里，可随时恢复。" : "写下第一条，发给自己。"}
        </p>
      </div>
    );
  }

  const groups = groupByDay(items);
  return (
    <div className="timeline">
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
                return <ItemCard key={it.id} item={it} trash={trash} gap={gap} />;
              })}
            </AnimatePresence>
          </ul>
        </section>
      ))}
    </div>
  );
}
