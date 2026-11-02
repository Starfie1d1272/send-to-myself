import { useEffect, useRef, type ReactNode } from "react";

/** A mounted dialog owns its modal lifecycle and returns focus to its opener. */
export function Dialog({ children, onClose, labelledBy }: { children: ReactNode; onClose: () => void; labelledBy: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = ref.current;
    dialog?.showModal();
    return () => { dialog?.close(); if (opener?.isConnected) opener.focus(); };
  }, []);
  return <dialog ref={ref} className="device-dialog" aria-labelledby={labelledBy} onCancel={event => { event.preventDefault(); onClose(); }}>{children}</dialog>;
}
