import { useEffect, useRef, type ReactNode } from "react";

/** A mounted dialog owns its modal lifecycle and returns focus to its opener. */
export function Dialog({
  children,
  onClose,
  labelledBy,
  label,
  className = "device-dialog",
  onClick,
  onKeyDown,
}: {
  children: ReactNode;
  onClose: () => void;
  labelledBy?: string;
  label?: string;
  className?: string;
  onClick?: React.MouseEventHandler<HTMLDialogElement>;
  onKeyDown?: React.KeyboardEventHandler<HTMLDialogElement>;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = ref.current;
    dialog?.showModal();
    return () => {
      dialog?.close();
      if (opener?.isConnected) opener.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className={className}
      aria-labelledby={labelledBy}
      aria-label={label}
      onClick={onClick}
      onKeyDown={onKeyDown}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      {children}
    </dialog>
  );
}
