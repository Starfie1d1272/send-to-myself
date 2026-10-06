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

/** Copy the image itself. Never report a protected URL as an image copy. */
export async function copyImage(url: string): Promise<boolean> {
  const clip = navigator.clipboard;
  if (!window.isSecureContext || !clip?.write || typeof ClipboardItem === "undefined") return false;
  try {
    const res = await fetch(url, { credentials: "include" });
    if (!res.ok) return false;
    const blob = await res.blob();
    if (!blob.type.startsWith("image/")) return false;
    await clip.write([new ClipboardItem({ [blob.type]: blob })]);
    return true;
  } catch {
    return false;
  }
}
