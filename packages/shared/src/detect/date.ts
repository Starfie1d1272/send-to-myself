/** DDL 自动识别（SPEC §6, §15）。基于 chrono-node 中文解析，结果仅作建议需用户确认。 */

import type { DetectionContext } from "../schema.js";
import * as chrono from "chrono-node";

export interface DueSuggestion {
  /** ISO 8601（含时区偏移）。 */
  dueAt: string;
  /** 命中的原文片段，给用户确认用。 */
  matchedText: string;
}

// Chrono 2.10.2 includes the same common ISO parser in zh and en. Identify
// common parsers by their shared prototype rather than configuration order.
// The remaining zh parsers are Hant casual and Hant/Hans date, relative
// weekday, weekday, time-expression and deadline parsers; these use the legacy
// host-local refDate/instant. Pin Chrono until this adaptation is rechecked.
// Only the clone is wrapped; legacy Date callers use the original parser.
const commonParserPrototypes = new Set(chrono.en.casual.parsers.map(parser => Object.getPrototypeOf(parser)));
const contextualZh = chrono.zh.casual.clone();
contextualZh.parsers = contextualZh.parsers.map((parser) => {
  if (commonParserPrototypes.has(Object.getPrototypeOf(parser))) return parser;
  const view = (context: chrono.ParsingContext): chrono.ParsingContext => {
    const adjusted = context.reference.getDateWithAdjustedTimezone();
    const reference = Object.assign(Object.create(context.reference) as chrono.ReferenceWithTimezone, { instant: adjusted });
    return Object.assign(Object.create(context) as chrono.ParsingContext, {
      reference, refDate: adjusted,
      createParsingResult: context.createParsingResult.bind(context),
      createParsingComponents: context.createParsingComponents.bind(context),
    });
  };
  return {
    pattern: (context) => parser.pattern(view(context)),
    extract: (context, match) => parser.extract(view(context), match),
  } satisfies chrono.Parser;
});

// 这些关键词出现时才更倾向于把解析到的日期当作 DDL，降低误识别（发布时间/上课时间）。
const DDL_HINT_RE = /(ddl|deadline|截止|截止时间|提交|之前|前交|交\b|due)/i;

/**
 * 从文本中识别一个最可能的 DDL。
 * @param ref 参考「现在」，默认当前时间；便于测试与服务端固定时区。
 * @returns 命中返回建议，否则 null。绝不修改原文。
 */
export function detectDueDate(text: string, ref: Date | DetectionContext = new Date()): DueSuggestion | null {
  // forwardDate：把「本周五」「25号」这类歧义解析为未来，符合 DDL 语义。
  const results = ref instanceof Date
    ? chrono.zh.parse(text, ref, { forwardDate: true })
    : contextualZh.parse(text, { instant: new Date(ref.capturedAt), timezone: ref.utcOffsetMinutes }, { forwardDate: false });
  if (results.length === 0) return null;

  // 优先取附近带「截止/提交/前」等关键词的结果；否则取第一个。
  const preferred =
    results.find((r) => DDL_HINT_RE.test(contextAround(text, r.index, r.text.length))) ??
    results[0];
  if (!preferred) return null;

  const due = ref instanceof Date ? preferred.start.date() : contextualDate(preferred, ref);
  if (!due) return null;
  return {
    dueAt: due.toISOString(),
    matchedText: preferred.text,
  };
}

function contextAround(text: string, index: number, len: number): string {
  const start = Math.max(0, index - 6);
  return text.slice(start, index + len + 6);
}

// Chrono's Chinese relative sub-day parsers use host-local Date setters. Use
// their recognized text with the sender's instant instead. This finite adapter
// follows the number and unit syntax of the pinned Chinese parsers.
function relativeSubDay(text: string): number | null {
  const match = /^(\d+|[零〇一二两兩三四五六七八九十]+|半|几|幾)\s*(?:个|個)?(秒(?:钟|鐘)?|分钟|分鐘|小时|小時|钟|鐘)(?:(?:之|过|過)?后|(?:之)?内|(?:之)?後|(?:之)?內|(?:之)?前)$/.exec(text);
  if (!match) return null;
  const digits: Record<string, number> = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 兩: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
  const value = match[1]!;
  let n = value === "半" ? 0.5 : value === "几" || value === "幾" ? 3 : Number(value);
  if (Number.isNaN(n)) {
    n = 0;
    for (const char of value) n = char === "十" ? (n === 0 ? 10 : n * 10) : n + digits[char]!;
  }
  const unit = match[2]!;
  const factor = unit.startsWith("秒") ? 1000 : unit.startsWith("分") ? 60_000 : 3_600_000;
  return n * factor * (text.endsWith("前") ? -1 : 1);
}

// Apply forward-date semantics on absolute instants; calendar arithmetic uses
// UTC fields of the sender's fixed-offset wall clock, never the NAS timezone.
function contextualDate(result: chrono.ParsedResult, context: DetectionContext): Date | null {
  const instant = new Date(context.capturedAt);
  const relative = relativeSubDay(result.text);
  if (relative !== null) return new Date(instant.getTime() + relative);

  const start = result.start;
  let date = start.date();
  if (date >= instant || !(start instanceof chrono.ParsingComponents)) return date;
  const offset = context.utcOffsetMinutes * 60_000;
  const wall = new Date(date.getTime() + offset);
  if (start.isOnlyTime()) {
    wall.setUTCDate(wall.getUTCDate() + 1);
  } else if (start.isOnlyWeekdayComponent()) {
    wall.setUTCDate(wall.getUTCDate() + 7);
  } else if (start.isDateWithUnknownYear()) {
    for (let i = 0; i < 3 && wall.getTime() - offset < instant.getTime(); i++) {
      const month = wall.getUTCMonth();
      wall.setUTCFullYear(wall.getUTCFullYear() + 1);
      // Chrono discards invalid yearless dates instead of normalizing Feb 29.
      if (wall.getUTCMonth() !== month) return null;
    }
  } else {
    return date;
  }
  date = new Date(wall.getTime() - offset);
  return date;
}
