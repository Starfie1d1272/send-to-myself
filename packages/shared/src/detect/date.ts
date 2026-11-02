/** DDL 自动识别（SPEC §6, §15）。基于 chrono-node 中文解析，结果仅作建议需用户确认。 */

import type { DetectionContext } from "../schema.js";
import * as chrono from "chrono-node";

export interface DueSuggestion {
  /** ISO 8601（含时区偏移）。 */
  dueAt: string;
  /** 命中的原文片段，给用户确认用。 */
  matchedText: string;
}

// Chrono 2.10.2 zh casual config: Hant casual, common ISO, then Hant/Hans
// date, relative weekday, weekday, time-expression and deadline parsers.
// The Chinese parsers use the legacy host-local refDate/instant; ISO does not.
// This clone leaves the original reference and refiners intact.
const contextualZh = chrono.zh.casual.clone();
contextualZh.parsers = contextualZh.parsers.map((parser, index) => {
  if (index === 1) return parser; // common ISOFormatParser inserted by Chrono
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
