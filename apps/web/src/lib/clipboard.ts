/** Desktop commands expose writes only, scoped to the configured server origin. */
function nativeInvoke(): ((command: string, args: Record<string, unknown>) => Promise<unknown>) | undefined {
  return (window as unknown as { __TAURI__?: { core?: { invoke?: (command: string, args: Record<string, unknown>) => Promise<unknown> } } }).__TAURI__?.core?.invoke;
}
export async function copyText(text: string): Promise<boolean> {
  const invoke = nativeInvoke();
  if (invoke) {
    try { await invoke("copy_text", { text }); return true; } catch { /* old shell: browser fallback */ }
  }
  if (navigator.clipboard && window.isSecureContext) {
    try { await navigator.clipboard.writeText(text); return true; } catch { /* fallback */ }
  }
  let textarea: HTMLTextAreaElement | undefined;
  const focused = document.activeElement;
  try {
    textarea = document.createElement("textarea");
    textarea.value = text; textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed"; textarea.style.top = "-1000px"; textarea.style.opacity = "0";
    document.body.appendChild(textarea); textarea.select();
    return document.execCommand("copy");
  } catch { return false; }
  finally { textarea?.remove(); if (focused instanceof HTMLElement) focused.focus(); }
}

async function asPng(blob: Blob): Promise<Blob> {
  // Browser clipboard implementations generally accept PNG, not JPEG/WebP/GIF.
  const image = await createImageBitmap(blob);
  try {
    if (!image.width || !image.height || image.width * image.height > 16_000_000) throw new Error("image too large");
    const canvas = document.createElement("canvas");
    canvas.width = image.width; canvas.height = image.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("canvas unavailable");
    context.drawImage(image, 0, 0);
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error("PNG conversion failed")), "image/png"));
  } finally { image.close(); }
}

/** Copy pixels, never a private attachment URL. GIF copies its first frame. */
export async function copyImage(url: string): Promise<boolean> {
  const invoke = nativeInvoke();
  const clip = navigator.clipboard;
  const browser = window.isSecureContext && !!clip?.write && typeof ClipboardItem !== "undefined";
  if (!invoke && !browser) return false;
  try {
    const response = await fetch(url, { credentials: "include", redirect: "error" });
    if (!response.ok) return false;
    const blob = await response.blob();
    if (!blob.type.startsWith("image/") || blob.size > 50 * 1024 * 1024) return false;
    const png = await asPng(blob);
    if (png.size > 50 * 1024 * 1024) return false;
    if (invoke) {
      try { await invoke("copy_image", { png: Array.from(new Uint8Array(await png.arrayBuffer())) }); return true; }
      catch { if (!browser) return false; }
    }
    await clip.write([new ClipboardItem({ "image/png": png })]);
    return true;
  } catch { return false; }
}
