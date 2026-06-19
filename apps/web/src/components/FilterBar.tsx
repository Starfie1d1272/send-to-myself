import { IconSearch } from "./icons";

export type FilterKey =
  | "all"
  | "todo"
  | "due"
  | "idea"
  | "read_later"
  | "link"
  | "image"
  | "file"
  | "pinned"
  | "completed"
  | "trash";

export const FILTERS: { key: FilterKey; label: string }[] = [
  { key: "all", label: "全部" },
  { key: "todo", label: "待办" },
  { key: "due", label: "即将截止" },
  { key: "idea", label: "想法" },
  { key: "read_later", label: "稍后看" },
  { key: "link", label: "链接" },
  { key: "image", label: "图片" },
  { key: "file", label: "文件" },
  { key: "pinned", label: "置顶" },
  { key: "completed", label: "已完成" },
  { key: "trash", label: "回收站" },
];

export function FilterBar({
  active,
  onChange,
  query,
  onQuery,
}: {
  active: FilterKey;
  onChange: (k: FilterKey) => void;
  query: string;
  onQuery: (q: string) => void;
}) {
  return (
    <div className="filterbar">
      <div className="chips chips--filter">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            className={`chip${active === f.key ? " chip--on" : ""}`}
            onClick={() => onChange(f.key)}
          >
            {f.label}
          </button>
        ))}
      </div>
      <label className="search">
        <IconSearch width={16} height={16} />
        <input
          placeholder="搜索正文、链接、文件名…"
          value={query}
          onChange={(e) => onQuery(e.target.value)}
        />
      </label>
    </div>
  );
}
