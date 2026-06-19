import { useState } from "react";
import { motion } from "motion/react";
import type { Item } from "@sendtomyself/shared";
import {
  dueBucket,
  dueLabel,
  formatDue,
  formatTime,
  hostnameOf,
  itemDueSuggestion,
  itemPreview,
  itemUrls,
  quickDue,
} from "../lib/format";
import { useItemMutations } from "../hooks/useItems";
import { Attachments } from "./Attachments";
import { LinkPreviewCard } from "./LinkPreviewCard";
import {
  IconCheck,
  IconClock,
  IconCopy,
  IconEye,
  IconPin,
  IconRestore,
  IconTrash,
} from "./icons";

const URL_RE = /(https?:\/\/[^\s]+)/g;

function LinkifiedText({ text }: { text: string }) {
  const parts = text.split(URL_RE);
  return (
    <>
      {parts.map((p, i) =>
        URL_RE.test(p) ? (
          <a key={i} href={p} target="_blank" rel="noreferrer" className="inline-link">
            {p}
          </a>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </>
  );
}

export function ItemCard({ item, trash }: { item: Item; trash?: boolean }) {
  const { update, remove, restore } = useItemMutations();
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [dueOpen, setDueOpen] = useState(false);

  const patch = (p: Parameters<typeof update.mutate>[0]["patch"]) =>
    update.mutate({ id: item.id, patch: p });

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(item.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      /* ignore */
    }
  };

  const urls = itemUrls(item);
  const preview = itemPreview(item);
  const suggestion = itemDueSuggestion(item);
  const bucket = dueBucket(item.dueAt);
  const showSuggestion = !trash && suggestion && !item.dueAt && !item.isTodo;
  const attachments = item.attachments ?? [];

  return (
    <motion.li
      layout
      initial={{ opacity: 0, y: -12, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.96, transition: { duration: 0.18 } }}
      transition={{ type: "spring", stiffness: 520, damping: 38 }}
      className={`item${item.pinned ? " item--pinned" : ""}${
        item.completed ? " item--done" : ""
      }`}
    >
      <div className="item__row">
        {item.isTodo && !trash && (
          <button
            className={`check${item.completed ? " check--on" : ""}`}
            onClick={() => patch({ completed: !item.completed })}
            aria-label="完成"
            title={item.completed ? "标记未完成" : "标记完成"}
          >
            {item.completed && <IconCheck width={14} height={14} />}
          </button>
        )}

        <div className="item__body">
          {item.sensitive && !revealed ? (
            <button className="redacted" onClick={() => setRevealed(true)}>
              <span className="redacted__bars" aria-hidden>
                ▮▮▮▮▮▮▮▮▮▮
              </span>
              <span className="redacted__hint">
                <IconEye width={14} height={14} /> 已隐藏敏感内容 · 点击显示
              </span>
            </button>
          ) : (
            item.content.trim().length > 0 && (
              <p className={`item__content${item.sensitive ? " item__content--mono" : ""}`}>
                {item.sensitive ? item.content : <LinkifiedText text={item.content} />}
              </p>
            )
          )}

          {attachments.length > 0 && !item.sensitive && (
            <Attachments items={attachments} />
          )}

          {preview && !item.sensitive && <LinkPreviewCard preview={preview} />}

          {urls.length > 0 && !item.sensitive && !preview && (
            <div className="chips">
              {urls.slice(0, 3).map((u) => (
                <a key={u} className="link-chip" href={u} target="_blank" rel="noreferrer">
                  <span className="link-chip__dot" />
                  {hostnameOf(u)}
                </a>
              ))}
            </div>
          )}

          {showSuggestion && (
            <button
              className="suggest"
              onClick={() => patch({ isTodo: true, dueAt: suggestion!.dueAt })}
            >
              <IconClock width={14} height={14} />
              识别到截止「{suggestion!.matchedText}」· 设为待办
            </button>
          )}

          <div className="item__meta">
            {item.dueAt && bucket !== "none" && (
              <span className={`due due--${bucket}`}>
                <IconClock width={12} height={12} />
                {dueLabel[bucket]} · {formatDue(item.dueAt)}
              </span>
            )}
            {item.category !== "none" && (
              <span className="tag">{item.category === "idea" ? "想法" : "稍后看"}</span>
            )}
            <time className="item__time">{formatTime(item.createdAt)}</time>
          </div>
        </div>
      </div>

      <div className="actions">
        {trash ? (
          <button className="icon-btn" title="恢复" onClick={() => restore.mutate(item.id)}>
            <IconRestore />
          </button>
        ) : (
          <>
            <button className="icon-btn" title={copied ? "已复制" : "复制"} onClick={copy}>
              {copied ? <IconCheck /> : <IconCopy />}
            </button>
            <button
              className={`icon-btn${item.pinned ? " icon-btn--on" : ""}`}
              title={item.pinned ? "取消置顶" : "置顶"}
              onClick={() => patch({ pinned: !item.pinned })}
            >
              <IconPin />
            </button>
            <button
              className={`icon-btn${item.isTodo ? " icon-btn--on" : ""}`}
              title={item.isTodo ? "取消待办" : "设为待办"}
              onClick={() => patch({ isTodo: !item.isTodo })}
            >
              <IconCheck />
            </button>
            <div className="due-wrap">
              <button
                className={`icon-btn${item.dueAt ? " icon-btn--on" : ""}`}
                title="截止时间"
                onClick={() => setDueOpen((v) => !v)}
              >
                <IconClock />
              </button>
              {dueOpen && (
                <div className="due-menu" onMouseLeave={() => setDueOpen(false)}>
                  {(["today", "tomorrow", "sunday"] as const).map((k) => (
                    <button
                      key={k}
                      onClick={() => {
                        patch({ isTodo: true, dueAt: quickDue(k) });
                        setDueOpen(false);
                      }}
                    >
                      {k === "today" ? "今天" : k === "tomorrow" ? "明天" : "本周日"}
                    </button>
                  ))}
                  {item.dueAt && (
                    <button
                      className="due-menu__clear"
                      onClick={() => {
                        patch({ dueAt: null });
                        setDueOpen(false);
                      }}
                    >
                      清除
                    </button>
                  )}
                </div>
              )}
            </div>
            <button className="icon-btn icon-btn--danger" title="删除" onClick={() => remove.mutate(item.id)}>
              <IconTrash />
            </button>
          </>
        )}
      </div>
    </motion.li>
  );
}
