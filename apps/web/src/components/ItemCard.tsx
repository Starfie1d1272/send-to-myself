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
import { findSecretSpans } from "@sendtomyself/shared/detect/secret";
import { copyText, copyImage } from "../lib/clipboard";
import { attachmentRawUrl } from "../lib/api";
import { useItemMutations } from "../hooks/useItems";
import { Attachments } from "./Attachments";
import { LinkPreviewCard } from "./LinkPreviewCard";
import { SensitiveText } from "./SensitiveText";
import {
  IconCheck,
  IconClock,
  IconCopy,
  IconEye,
  IconPin,
  IconRestore,
  IconTag,
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

export function ItemCard({
  item,
  trash,
  gap = "normal",
}: {
  item: Item;
  trash?: boolean;
  gap?: "first" | "cont" | "normal";
}) {
  const { update, remove, restore, refetchPreview } = useItemMutations();
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [dueOpen, setDueOpen] = useState(false);
  const [tagOpen, setTagOpen] = useState(false);

  const patch = (p: Parameters<typeof update.mutate>[0]["patch"]) =>
    update.mutate({ id: item.id, patch: p });

  const copy = async () => {
    // 有文字复制文字；纯图片记录复制图片本体（http 下自动降级为复制图片链接）
    const firstImg = (item.attachments ?? []).find((a) => a.mimeType.startsWith("image/"));
    const ok =
      item.content.trim().length > 0
        ? await copyText(item.content)
        : firstImg
          ? await copyImage(attachmentRawUrl(firstImg.id))
          : false;
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    }
  };

  const urls = itemUrls(item);
  const preview = itemPreview(item);
  const suggestion = itemDueSuggestion(item);
  const bucket = dueBucket(item.dueAt);
  const showSuggestion = !trash && suggestion && !item.dueAt && !item.isTodo;
  const attachments = item.attachments ?? [];
  // 命中具体密钥 → 只遮罩密钥本身；手动标敏感但无命中 → 整条遮罩
  const secretSpans = item.sensitive ? findSecretSpans(item.content) : [];
  const partialMask = item.sensitive && secretSpans.length > 0;

  return (
    <motion.li
      layout
      initial={{ opacity: 0, y: -12, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.96, transition: { duration: 0.18 } }}
      transition={{ type: "spring", stiffness: 520, damping: 38 }}
      className={`item item--gap-${gap}${item.pinned ? " item--pinned" : ""}${
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
          {partialMask ? (
            <SensitiveText content={item.content} spans={secretSpans} />
          ) : item.sensitive && !revealed ? (
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
              {!trash && (
                <button
                  className="link-chip link-chip--action"
                  title="重新抓取预览"
                  disabled={refetchPreview.isPending}
                  onClick={() => refetchPreview.mutate(item.id)}
                >
                  {refetchPreview.isPending ? "抓取中…" : "抓取预览"}
                </button>
              )}
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
                className={`icon-btn${item.category !== "none" ? " icon-btn--on" : ""}`}
                title="标签：想法 / 稍后看"
                onClick={() => setTagOpen((v) => !v)}
              >
                <IconTag />
              </button>
              {tagOpen && (
                <div className="due-menu" onMouseLeave={() => setTagOpen(false)}>
                  <button
                    onClick={() => {
                      patch({ category: "idea" });
                      setTagOpen(false);
                    }}
                  >
                    想法
                  </button>
                  <button
                    onClick={() => {
                      patch({ category: "read_later" });
                      setTagOpen(false);
                    }}
                  >
                    稍后看
                  </button>
                  {item.category !== "none" && (
                    <button
                      className="due-menu__clear"
                      onClick={() => {
                        patch({ category: "none" });
                        setTagOpen(false);
                      }}
                    >
                      清除标签
                    </button>
                  )}
                </div>
              )}
            </div>
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
                  <label className="due-menu__custom">
                    自定义…
                    <input
                      type="datetime-local"
                      onChange={(e) => {
                        if (e.target.value) {
                          patch({ isTodo: true, dueAt: new Date(e.target.value).toISOString() });
                          setDueOpen(false);
                        }
                      }}
                    />
                  </label>
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
