/**
 * 自动识别聚合（SPEC §6）。
 * 全部纯函数、无副作用、无网络。仅产出「建议」，由调用方决定是否采纳。
 */

import type { ItemKind } from "../schema.js";
import { detectUrls, isPureLink } from "./url.js";
import { detectSecret, type SecretDetection } from "./secret.js";
import { detectDueDate, type DueSuggestion } from "./date.js";

export * from "./url.js";
export * from "./secret.js";
export * from "./date.js";

// 疑似待办关键词（SPEC §6）。
const TODO_RE = /(\btodo\b|\bddl\b|待办|截止|deadline)/i;

/** 是否疑似待办。 */
export function detectTodo(text: string): boolean {
  return TODO_RE.test(text);
}

/**
 * 推断展示类型。附件信息由调用方传入（shared 不碰文件系统）。
 */
export function detectKind(
  content: string,
  attachments?: { hasImage?: boolean; hasFile?: boolean },
): ItemKind {
  if (attachments?.hasImage) return "image";
  if (attachments?.hasFile) return "file";
  if (isPureLink(content)) return "link";
  return "text";
}

export interface DetectionResult {
  kind: ItemKind;
  urls: string[];
  todo: boolean;
  due: DueSuggestion | null;
  secret: SecretDetection;
}

/** 一次性跑完所有规则识别。 */
export function detect(
  content: string,
  attachments?: { hasImage?: boolean; hasFile?: boolean },
  ref?: Date,
): DetectionResult {
  return {
    kind: detectKind(content, attachments),
    urls: detectUrls(content),
    todo: detectTodo(content),
    due: detectDueDate(content, ref),
    secret: detectSecret(content),
  };
}
