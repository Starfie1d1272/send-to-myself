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
// Only the clone is adapted; legacy Date callers keep the original parser.
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
    extract: (context, match) => {
      const adjusted = view(context);
      // Chrono adds sub-day durations with host-local Date setters. Run those
      // parsers at a stable local noon, then apply their duration to the
      // sender's fixed-offset wall clock using UTC arithmetic.
      if (/DeadlineFormatParser$|AgoFormatParser$/.test(parser.constructor.name) &&
          /秒|分钟|小时|鐘|钟/.test(match[0])) {
        for (let day = 15; day <= 17; day++) {
          const anchor = new Date(2000, 0, day, 12, 0, 0, 0);
          const sampleContext = Object.assign(Object.create(adjusted) as chrono.ParsingContext, {
            refDate: anchor,
          });
          const sample = parser.extract(sampleContext, match);
          if (!(sample instanceof chrono.ParsingResult)) break;
          const c = sample.start;
          const sampleTime = Date.UTC(c.get("year")!, c.get("month")! - 1, c.get("day")!, c.get("hour")!, c.get("minute")!, c.get("second")!);
          const localResult = new Date(c.get("year")!, c.get("month")! - 1, c.get("day")!, c.get("hour")!, c.get("minute")!, c.get("second")!);
          // Retry on a different anchor if Chrono landed on a host DST
          // transition, where local setters can normalize a missing hour.
          if (new Date(localResult.getTime() - 3_600_000).getTimezoneOffset() !==
              new Date(localResult.getTime() + 3_600_000).getTimezoneOffset()) continue;
          const wall = new Date(context.reference.instant.getTime() + context.reference.getTimezoneOffset() * 60_000 +
            sampleTime - Date.UTC(2000, 0, day, 12));
          c.imply("year", wall.getUTCFullYear());
          c.imply("month", wall.getUTCMonth() + 1);
          c.imply("day", wall.getUTCDate());
          c.assign("hour", wall.getUTCHours());
          c.assign("minute", wall.getUTCMinutes());
          c.assign("second", wall.getUTCSeconds());
          return sample;
        }
      }
      return parser.extract(adjusted, match);
    },
  } satisfies chrono.Parser;
});

// ForwardDateRefiner compares a host-local wall-clock Date with an absolute
// result Date for weekdays and yearless dates. Make both sides wall-clock for
// those comparisons; restore the real date methods before returning results.
contextualZh.refiners = contextualZh.refiners.map((refiner) => {
  if (refiner.constructor.name !== "ForwardDateRefiner") return refiner;
  return {
    refine(context, results) {
      for (const result of results) {
        const components = [result.start, result.end].filter((c): c is chrono.ParsingComponents => !!c);
        const wallComparison = result.start.isOnlyWeekdayComponent() || result.start.isDateWithUnknownYear();
        if (!wallComparison) {
          refiner.refine(context, [result]);
          continue;
        }
        const original = components.map(c => c.date);
        try {
          for (const c of components) {
            c.date = () => new Date(c.get("year")!, c.get("month")! - 1, c.get("day")!, c.get("hour")!, c.get("minute")!, c.get("second")!, c.get("millisecond")!);
          }
          refiner.refine(context, [result]);
        } finally {
          components.forEach((c, i) => { c.date = original[i]!; });
        }
      }
      return results;
    },
  } satisfies chrono.Refiner;
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
    : contextualZh.parse(text, { instant: new Date(ref.capturedAt), timezone: ref.utcOffsetMinutes }, { forwardDate: true });
  if (results.length === 0) return null;

  // 优先取附近带「截止/提交/前」等关键词的结果；否则取第一个。
  const preferred =
    results.find((r) => DDL_HINT_RE.test(contextAround(text, r.index, r.text.length))) ??
    results[0];
  if (!preferred) return null;

  return {
    dueAt: preferred.start.date().toISOString(),
    matchedText: preferred.text,
  };
}

function contextAround(text: string, index: number, len: number): string {
  const start = Math.max(0, index - 6);
  return text.slice(start, index + len + 6);
}
