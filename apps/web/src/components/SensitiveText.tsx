import type { ReactNode } from "react";
import type { SecretSpan } from "@sendtomyself/shared/detect/secret";

export function SensitiveText({ content, spans, revealed, onReveal, onCopy, renderText }: {
  content: string; spans: SecretSpan[]; revealed: boolean; onReveal: () => void;
  onCopy: (value: string) => void; renderText: (text: string, start: number) => ReactNode;
}) {
  let cursor = 0;
  return <p className="item__content">{spans.map((span) => {
    const start = cursor; const before = content.slice(cursor, span.start); cursor = span.end;
    return <span key={span.start}>{renderText(before, start)}{revealed
      ? <button className="secret secret--shown" title="点击复制片段" aria-label={`复制${span.hint}片段`} onClick={() => onCopy(span.value)}>{span.value}</button>
      : <button className="secret" onClick={onReveal} aria-label="查看内容">••••••••••</button>}</span>;
  })}{renderText(content.slice(cursor), cursor)}</p>;
}
