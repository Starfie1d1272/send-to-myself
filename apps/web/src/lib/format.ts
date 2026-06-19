import type { Item, LinkPreview } from "@sendtomyself/shared";

export type DueBucket = "overdue" | "today" | "tomorrow" | "this_week" | "later" | "none";

const DAY = 86_400_000;
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

/** DDL 到期分桶（SPEC §4）。 */
export function dueBucket(dueAt: string | undefined, now = new Date()): DueBucket {
  if (!dueAt) return "none";
  const diff = Math.round((startOfDay(new Date(dueAt)) - startOfDay(now)) / DAY);
  if (diff < 0) return "overdue";
  if (diff === 0) return "today";
  if (diff === 1) return "tomorrow";
  if (diff <= 7) return "this_week";
  return "later";
}

export const dueLabel: Record<Exclude<DueBucket, "none">, string> = {
  overdue: "已过期",
  today: "今天截止",
  tomorrow: "明天截止",
  this_week: "本周截止",
  later: "更晚",
};

/** 截止时间的简短展示，如「6月25日」。 */
export function formatDue(dueAt: string): string {
  const d = new Date(dueAt);
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

/** 一天内的时间 HH:MM。 */
export function formatTime(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function dayLabel(d: Date, now = new Date()): string {
  const diff = Math.round((startOfDay(now) - startOfDay(d)) / DAY);
  if (diff === 0) return "今天";
  if (diff === 1) return "昨天";
  const sameYear = d.getFullYear() === now.getFullYear();
  return sameYear
    ? `${d.getMonth() + 1}月${d.getDate()}日`
    : `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}

/** 视觉聚簇阈值：相邻两条创建时间间隔小于此值视为同一簇（连续发送），仅影响间距。 */
export const CLUSTER_GAP_MS = 3 * 60_000;

/** 相邻两条（newer, older）是否属于同一视觉簇。纯展示判断，不改数据。 */
export function sameCluster(newer: Item, older: Item): boolean {
  const gap = new Date(newer.createdAt).getTime() - new Date(older.createdAt).getTime();
  return gap >= 0 && gap < CLUSTER_GAP_MS;
}

/** 一条在簇内的位置：当天首条 / 同簇续条 / 新簇起始。用于决定上间距。 */
export type GapKind = "first" | "cont" | "normal";

export interface DayGroup {
  key: string;
  label: string;
  items: Item[];
}

/** 按天分组（今天/昨天/更早），保持原有倒序。 */
export function groupByDay(items: Item[]): DayGroup[] {
  const groups: DayGroup[] = [];
  let current: DayGroup | null = null;
  for (const it of items) {
    const d = new Date(it.createdAt);
    const key = String(startOfDay(d));
    if (!current || current.key !== key) {
      current = { key, label: dayLabel(d), items: [] };
      groups.push(current);
    }
    current.items.push(it);
  }
  return groups;
}

/** 快捷截止日期 → ISO（默认当天 18:00）。 */
export function quickDue(kind: "today" | "tomorrow" | "sunday"): string {
  const d = new Date();
  if (kind === "tomorrow") d.setDate(d.getDate() + 1);
  if (kind === "sunday") {
    const toSunday = (7 - d.getDay()) % 7 || 7; // 下一个周日
    d.setDate(d.getDate() + toSunday);
  }
  d.setHours(18, 0, 0, 0);
  return d.toISOString();
}

/** 取 Item 上识别到的链接（meta.suggestions.urls）。 */
export function itemUrls(item: Item): string[] {
  const s = item.meta?.suggestions as { urls?: string[] } | undefined;
  return s?.urls ?? [];
}

/** 取 Item 上的 DDL 识别建议。 */
export function itemDueSuggestion(item: Item): { dueAt: string; matchedText: string } | null {
  const s = item.meta?.suggestions as
    | { due?: { dueAt: string; matchedText: string } | null }
    | undefined;
  return s?.due ?? null;
}

export function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** 取链接预览（meta.preview），仅当抓取成功且有标题/封面时返回。 */
export function itemPreview(item: Item): LinkPreview | null {
  const p = item.meta?.preview as LinkPreview | undefined;
  if (!p || p.status !== "ok") return null;
  if (!p.title && !p.image) return null;
  return p;
}

/** 字节 → 人类可读。 */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
