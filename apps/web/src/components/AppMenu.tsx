import { useEffect, useRef, useState } from "react";
import { getNativeBridge, hasNativeAuth } from "../lib/nativeBridge";

export type AppMenuProps = {
  onOpenConnect: () => void;
  onOpenTokens: () => void;
  onOpenServerInfo: () => void;
  onOpenTrash: () => void;
  onOpenTransfers?: () => void;
  onLogout?: () => void;
  logoutPending?: boolean;
};
export function AppMenu(props: AppMenuProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const click = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        ref.current?.querySelector("button")?.focus();
      }
    };
    document.addEventListener("mousedown", click);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("mousedown", click);
      document.removeEventListener("keydown", key);
    };
  }, [open]);
  const item = (label: string, action: () => void, disabled = false) => (
    <button
      role="menuitem"
      disabled={disabled}
      onClick={() => {
        ref.current?.querySelector("button")?.focus();
        setOpen(false);
        action();
      }}
    >
      {label}
    </button>
  );
  const oldNative = !!getNativeBridge() && !hasNativeAuth();
  return (
    <div ref={ref} className="app-menu">
      <button
        className="icon-btn app-menu__trigger"
        aria-label="更多"
        title="更多"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <circle cx="5" cy="12" r="2" />
          <circle cx="12" cy="12" r="2" />
          <circle cx="19" cy="12" r="2" />
        </svg>
      </button>
      {open && (
        <div role="menu" className="app-menu__panel">
          {item("连接手机 / 电脑", props.onOpenConnect)}
          {props.onOpenTransfers && item("传输任务", props.onOpenTransfers)}
          {item("服务器信息", props.onOpenServerInfo)}
          {item("接入令牌", props.onOpenTokens)}
          {item("回收站", props.onOpenTrash)}
          {props.onLogout &&
            item(
              props.logoutPending ? "退出中…" : oldNative ? "退出网页登录" : "退出登录",
              props.onLogout,
              props.logoutPending,
            )}
          {oldNative && (
            <small>当前应用后台任务需在原生传输页暂停；网页登录不能修复后台令牌。</small>
          )}
        </div>
      )}
    </div>
  );
}
