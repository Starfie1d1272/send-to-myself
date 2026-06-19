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
    window.location.replace(saved); // 跳到部署好的网页
    return;
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
