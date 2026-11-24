import { useEffect, useRef } from "react";
import { usePopoverMenu } from "../hooks/usePopoverMenu";
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
  const { open, setOpen, close, containerRef, triggerRef } = usePopoverMenu();
  const panelRef = useRef<HTMLDivElement>(null);
  const initialFocusRef = useRef<"first" | "last">("first");

  useEffect(() => {
    if (!open) return;
    const items = Array.from(
      panelRef.current?.querySelectorAll<HTMLButtonElement>(
        'button[role="menuitem"]:not(:disabled)',
      ) ?? [],
    );
    const target = initialFocusRef.current === "last" ? items.at(-1) : items[0];
    target?.focus();
    initialFocusRef.current = "first";
  }, [open]);

  const onTriggerKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      initialFocusRef.current = e.key === "ArrowUp" ? "last" : "first";
      setOpen(true);
    }
  };

  const onMenuKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Tab") {
      setOpen(false);
      return;
    }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;
    const buttons = Array.from(
      panelRef.current?.querySelectorAll<HTMLButtonElement>(
        'button[role="menuitem"]:not(:disabled)',
      ) ?? [],
    );
    if (!buttons.length) return;
    e.preventDefault();
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === "Home") buttons[0]!.focus();
    else if (e.key === "End") buttons.at(-1)!.focus();
    else if (e.key === "ArrowDown") buttons[(index + 1) % buttons.length]!.focus();
    else buttons[(index - 1 + buttons.length) % buttons.length]!.focus();
  };

  const item = (label: string, action: () => void, disabled = false) => (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={() => {
        triggerRef.current?.focus();
        close();
        action();
      }}
    >
      {label}
    </button>
  );
  const oldNative = !!getNativeBridge() && !hasNativeAuth();
  return (
    <div ref={containerRef} className="app-menu">
      <button
        type="button"
        ref={triggerRef}
        className="icon-btn app-menu__trigger"
        aria-label="应用菜单"
        title="应用菜单"
        aria-haspopup="menu"
        aria-expanded={open}
        onKeyDown={onTriggerKeyDown}
        onClick={() => {
          initialFocusRef.current = "first";
          setOpen(!open);
        }}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <circle cx="5" cy="12" r="2" />
          <circle cx="12" cy="12" r="2" />
          <circle cx="19" cy="12" r="2" />
        </svg>
      </button>
      {open && (
        <div ref={panelRef} role="menu" className="app-menu__panel" onKeyDown={onMenuKeyDown}>
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
            <small className="app-menu__note">
              当前应用后台任务需在原生传输页暂停；网页登录不能修复后台令牌。
            </small>
          )}
        </div>
      )}
    </div>
  );
}
