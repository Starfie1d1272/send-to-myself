import { useEffect, useRef, useState } from "react";
import { getNativeBridge, hasNativeAuth } from "../lib/nativeBridge";

export type AppMenuProps = {
  onOpenConnect: () => void; onOpenTokens: () => void; onOpenServerInfo: () => void; onOpenTrash: () => void;
  onOpenTransfers?: () => void; onLogout?: () => void; logoutPending?: boolean;
};
export function AppMenu(props: AppMenuProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const click = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpen(false); ref.current?.querySelector("button")?.focus(); } };
    document.addEventListener("mousedown", click); document.addEventListener("keydown", key);
    return () => { document.removeEventListener("mousedown", click); document.removeEventListener("keydown", key); };
  }, [open]);
  const item = (label: string, action: () => void, disabled = false) => <button role="menuitem" disabled={disabled} onClick={() => { setOpen(false); action(); }}>{label}</button>;
  const oldNative = !!getNativeBridge() && !hasNativeAuth();
  return <div ref={ref} style={{ position: "relative" }}><button aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>更多</button>
    {open && <div role="menu" style={{ position: "absolute", right: 0, top: "100%", zIndex: 5, display: "grid", minWidth: 170, padding: 8, background: "#fffaf0", boxShadow: "0 4px 20px #0003" }}>
      {item("连接手机 / 电脑", props.onOpenConnect)}
      {props.onOpenTransfers && item("传输任务", props.onOpenTransfers)}
      {item("服务器信息", props.onOpenServerInfo)}
      {item("接入令牌", props.onOpenTokens)}
      {item("回收站", props.onOpenTrash)}
      {props.onLogout && item(props.logoutPending ? "退出中…" : oldNative ? "退出网页登录" : "退出登录", props.onLogout, props.logoutPending)}
      {oldNative && <small>当前应用后台任务需在原生传输页暂停；网页登录不能修复后台令牌。</small>}
    </div>}
  </div>;
}
