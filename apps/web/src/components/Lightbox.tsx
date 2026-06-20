import { useEffect } from "react";
import { createPortal } from "react-dom";
import { IconX } from "./icons";

/** 壳内全屏看图弹层：替代 target="_blank"（单 WebView 壳里打不开新标签）。
 *  长图按宽度铺满后可纵向滚动；点遮罩 / Esc / 关闭按钮退出。 */
export function Lightbox({
  src,
  alt,
  onClose,
}: {
  src: string;
  alt?: string;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  return createPortal(
    <div className="lightbox" onClick={onClose}>
      <button className="lightbox__close" onClick={onClose} aria-label="关闭">
        <IconX width={22} height={22} />
      </button>
      <div className="lightbox__scroll" onClick={(e) => e.stopPropagation()}>
        <img src={src} alt={alt ?? ""} className="lightbox__img" />
      </div>
    </div>,
    document.body,
  );
}
