import { useState } from "react";
import type { SecretSpan } from "@sendtomyself/shared/detect/secret";

/**
 * 只遮罩命中的密钥片段，前后文字照常显示（SPEC §11）。
 * 点击遮罩 → 显示明文；再点已显示的密钥 → 复制（保留「秒复制」体验）。
 */
export function SensitiveText({ content, spans }: { content: string; spans: SecretSpan[] }) {
  const [shown, setShown] = useState<Set<number>>(new Set());
  const [copied, setCopied] = useState<number | null>(null);

  const reveal = (i: number) => setShown((s) => new Set(s).add(i));
  const copy = async (i: number, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(i);
      setTimeout(() => setCopied((c) => (c === i ? null : c)), 1400);
    } catch {
      /* ignore */
    }
  };

  // 把 content 切成 [普通文本, 密钥, 普通文本, …]
  const parts: Array<{ text: string; secret?: SecretSpan; idx?: number }> = [];
  let cursor = 0;
  spans.forEach((sp, i) => {
    if (sp.start > cursor) parts.push({ text: content.slice(cursor, sp.start) });
    parts.push({ text: content.slice(sp.start, sp.end), secret: sp, idx: i });
    cursor = sp.end;
  });
  if (cursor < content.length) parts.push({ text: content.slice(cursor) });

  return (
    <p className="item__content">
      {parts.map((p, k) => {
        if (!p.secret) return <span key={k}>{p.text}</span>;
        const i = p.idx!;
        const isShown = shown.has(i);
        if (!isShown) {
          return (
            <button
              key={k}
              className="secret"
              title={`已隐藏 ${p.secret.hint} · 点击显示`}
              onClick={() => reveal(i)}
            >
              <span className="secret__dots" aria-hidden>
                ••••••••••
              </span>
              <span className="secret__tag">{p.secret.hint}</span>
            </button>
          );
        }
        return (
          <button
            key={k}
            className="secret secret--shown"
            title="点击复制"
            onClick={() => copy(i, p.secret!.value)}
          >
            {copied === i ? "已复制 ✓" : p.text}
          </button>
        );
      })}
    </p>
  );
}
