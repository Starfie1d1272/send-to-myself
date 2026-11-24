import { useState } from "react";
import type { TimelineViewState } from "../lib/timeline";
import { IconSearch } from "./icons";

export function FilterBar({
  state,
  onChange,
}: {
  state: TimelineViewState;
  onChange: (state: TimelineViewState) => void;
}) {
  const [open, setOpen] = useState(false);
  const set = (patch: Partial<TimelineViewState>) => onChange({ ...state, ...patch });
  const activeFilterCount =
    (state.contentType !== "all" ? 1 : 0) +
    (state.category !== "all" ? 1 : 0) +
    (state.sensitiveOnly ? 1 : 0);
  const filtered = activeFilterCount > 0;
  return (
    <div className="filterbar">
      <div className="chips chips--filter">
        {(
          [
            ["all", "全部"],
            ["todo", "待办"],
            ["favorites", "收藏"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            className={`chip${state.view === key ? " chip--on" : ""}`}
            aria-pressed={state.view === key}
            onClick={() =>
              set(
                state.view === "trash"
                  ? {
                      view: key,
                      query: "",
                      contentType: "all",
                      category: "all",
                      sensitiveOnly: false,
                    }
                  : { view: key },
              )
            }
          >
            {label}
          </button>
        ))}
        {state.view === "trash" && (
          <button type="button" className="chip chip--on" aria-pressed="true">
            回收站
          </button>
        )}
      </div>
      {state.view === "todo" && (
        <div className="chips">
          {(
            [
              ["open", "未完成"],
              ["next7days", "未来7天"],
              ["completed", "已完成"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              className={`chip${state.todoScope === key ? " chip--on" : ""}`}
              aria-pressed={state.todoScope === key}
              onClick={() => set({ todoScope: key })}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      <div className="filterbar__search">
        <label className="search">
          <IconSearch width={16} height={16} />
          <input
            aria-label="搜索正文、链接、文件名"
            placeholder="搜索正文、链接、文件名…"
            value={state.query}
            onChange={(e) => set({ query: e.target.value })}
          />
        </label>
        <button
          type="button"
          className={`button button--secondary filterbar__toggle`}
          onClick={() => setOpen(!open)}
          aria-expanded={open}
        >
          {filtered ? `筛选 · ${activeFilterCount}` : "筛选"}
        </button>
      </div>
      {open && (
        <div className="filter-panel">
          <div className="filter-panel__row">
            <span className="filter-panel__label">内容</span>
            {(
              [
                ["all", "全部"],
                ["link", "链接"],
                ["image", "图片"],
                ["file", "文件"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                className={`chip${state.contentType === key ? " chip--on" : ""}`}
                aria-pressed={state.contentType === key}
                onClick={() => set({ contentType: key })}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="filter-panel__row">
            <span className="filter-panel__label">标记</span>
            {(
              [
                ["all", "全部"],
                ["idea", "想法"],
                ["read_later", "稍后看"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                className={`chip${state.category === key ? " chip--on" : ""}`}
                aria-pressed={state.category === key}
                onClick={() => set({ category: key })}
              >
                {label}
              </button>
            ))}
          </div>
          <label className="filter-panel__check">
            <input
              type="checkbox"
              checked={state.sensitiveOnly}
              onChange={(e) => set({ sensitiveOnly: e.target.checked })}
            />
            仅敏感内容
          </label>
        </div>
      )}
      {filtered && (
        <div className="chips">
          {state.contentType !== "all" && (
            <button
              type="button"
              className="chip chip--active-filter"
              aria-label={`移除内容筛选：{{ link: "链接", image: "图片", file: "文件" }[state.contentType]}`}
              onClick={() => set({ contentType: "all" })}
            >
              {{ link: "链接", image: "图片", file: "文件" }[state.contentType]} ×
            </button>
          )}
          {state.category !== "all" && (
            <button
              type="button"
              className="chip chip--active-filter"
              aria-label={`移除标记筛选：${state.category === "idea" ? "想法" : "稍后看"}`}
              onClick={() => set({ category: "all" })}
            >
              {state.category === "idea" ? "想法" : "稍后看"} ×
            </button>
          )}
          {state.sensitiveOnly && (
            <button
              type="button"
              className="chip chip--active-filter"
              aria-label="移除仅敏感内容筛选"
              onClick={() => set({ sensitiveOnly: false })}
            >
              敏感内容 ×
            </button>
          )}
          <button
            type="button"
            className="button button--quiet button--sm"
            onClick={() => set({ contentType: "all", category: "all", sensitiveOnly: false })}
          >
            清除筛选
          </button>
        </div>
      )}
    </div>
  );
}
