import { useEffect } from "react";
import { Dialog } from "./ui/Dialog";
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
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  return (
    <Dialog className="lightbox" label="图片预览" onClose={onClose} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }} onKeyDown={(e) => {
      if (e.key !== "Tab") return;
      const close = e.currentTarget.querySelector<HTMLButtonElement>(".lightbox__close");
      const scroll = e.currentTarget.querySelector<HTMLDivElement>(".lightbox__scroll");
      if (e.shiftKey && document.activeElement === close) { e.preventDefault(); scroll?.focus(); }
      else if (!e.shiftKey && document.activeElement === scroll) { e.preventDefault(); close?.focus(); }
    }}>
      <button className="lightbox__close" onClick={onClose} aria-label="关闭">
        <IconX width={22} height={22} />
      </button>
      <div className="lightbox__scroll" tabIndex={0} onClick={(e) => e.stopPropagation()}>
        <img src={src} alt={alt ?? ""} className="lightbox__img" />
      </div>
    </Dialog>
  );
}
