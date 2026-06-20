/**
 * 复制文本到剪贴板。优先用异步 Clipboard API；非安全上下文（局域网 http、
 * 部分 WebView）下其不可用，回退到 execCommand，保证「秒复制」体验不静默失败。
 */
export async function copyText(text: string): Promise<boolean> {
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      /* 落到回退 */
    }
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.top = "-1000px";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

/**
 * 复制图片到剪贴板。仅安全上下文（https）支持写图片本体；
 * 局域网 http 下 Clipboard API 不可用，降级为复制图片的完整链接，避免静默失败。
 */
export async function copyImage(url: string): Promise<boolean> {
  const clip = navigator.clipboard as Clipboard & {
    write?: (items: ClipboardItem[]) => Promise<void>;
  };
  if (window.isSecureContext && clip?.write && typeof ClipboardItem !== "undefined") {
    try {
      const res = await fetch(url, { credentials: "include" });
      const blob = await res.blob();
      await clip.write([new ClipboardItem({ [blob.type]: blob })]);
      return true;
    } catch {
      /* 落到链接回退 */
    }
  }
  // 回退：复制图片的完整可访问链接
  return copyText(new URL(url, location.origin).toString());
}
