import type { SecretSpan } from "@sendtomyself/shared/detect/secret";
export function SensitiveText({ content, spans, onReveal }: { content: string; spans: SecretSpan[]; onReveal: () => void }) {
  let cursor = 0;
  return <p className="item__content">{spans.map((span) => { const before = content.slice(cursor, span.start); cursor = span.end; return <span key={span.start}>{before}<button className="secret" onClick={onReveal} aria-label="查看内容">••••••••••</button></span>; })}{content.slice(cursor)}</p>;
}
