import { useRef, useState } from "react";
import { useItemMutations } from "../hooks/useItems";
import { IconSend } from "./icons";

export function Composer() {
  const { create } = useItemMutations();
  const [value, setValue] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);

  const grow = () => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
  };

  const send = () => {
    const content = value.trim();
    if (!content || create.isPending) return;
    create.mutate(
      { content },
      {
        onSuccess: () => {
          setValue("");
          requestAnimationFrame(grow);
        },
      },
    );
  };

  return (
    <div className="composer">
      <textarea
        ref={ref}
        className="composer__input"
        placeholder="写点什么，发给自己…"
        value={value}
        rows={1}
        onChange={(e) => {
          setValue(e.target.value);
          grow();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            send();
          }
        }}
      />
      <div className="composer__bar">
        <span className="composer__hint">Enter 发送 · Shift+Enter 换行</span>
        <button className="send" onClick={send} disabled={!value.trim() || create.isPending}>
          发送
          <IconSend width={16} height={16} />
        </button>
      </div>
    </div>
  );
}
