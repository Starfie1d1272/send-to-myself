import { invoke } from "@tauri-apps/api/core";

// 桌面薄壳启动页：已配置 → 直接跳到部署好的网页；未配置/出错 → 显示连接表单。
const launcher = document.getElementById("launcher")!;
const form = document.getElementById("form") as HTMLFormElement;
const urlInput = document.getElementById("url") as HTMLInputElement;
const err = document.getElementById("err")!;

/** 补全协议、去掉尾部斜杠。 */
function normalize(raw: string): string {
  let u = raw.trim();
  if (!/^https?:\/\//i.test(u)) u = "https://" + u;
  return u.replace(/\/+$/, "");
}

function showError(msg: string): void {
  err.textContent = msg;
  err.hidden = false;
}

/** 任何「不跳转」的分支都要露出表单，避免黑屏。 */
function reveal(): void {
  launcher.hidden = false;
  urlInput.focus();
}

/** 是否是壳自身地址：存了它会导致启动页无限跳回自己。 */
function isShellOrigin(u: string): boolean {
  try {
    return new URL(u).origin === window.location.origin;
  } catch {
    return true; // 解析不了，按非法处理
  }
}

/** 跳转前探测服务器是否活着：活=resolve(opaque)，挂=reject。
 *  no-cors 只看 TCP+HTTP 是否可达，不关心跨域响应内容。 */
async function isReachable(url: string): Promise<boolean> {
  try {
    await fetch(url, { mode: "no-cors", signal: AbortSignal.timeout(4000) });
    return true;
  } catch {
    return false;
  }
}

async function boot(): Promise<void> {
  let saved: string | null = null;
  try {
    saved = await invoke<string | null>("get_server_url");
  } catch (e) {
    // 读配置失败也要让用户能填地址，并把错误显示出来便于排查
    showError("读取配置失败：" + String(e));
    reveal();
    return;
  }
  if (saved && !isShellOrigin(saved)) {
    // 先探测可达性：否则目标站点（如已关闭的本地 dev）挂掉时，
    // 整页 location.replace 过去会白屏，且壳 JS 不再运行、回不到表单。
    if (await isReachable(saved)) {
      window.location.replace(saved); // 跳到部署好的网页
      return;
    }
    showError("上次的服务器连不上了：" + saved + "，可改成别的地址后重新连接");
    urlInput.value = saved;
  }
  reveal();
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  err.hidden = true;
  const url = normalize(urlInput.value);
  if (isShellOrigin(url)) {
    showError("这是壳自身的地址，请填你的服务器地址，例如 https://stm.example.com");
    return;
  }
  try {
    new URL(url); // 基本格式校验
  } catch {
    showError("地址格式不对，例如 https://stm.example.com");
    return;
  }
  try {
    await invoke("set_server_url", { url });
    window.location.replace(url);
  } catch (e) {
    showError("保存失败：" + String(e));
  }
});

void boot();
