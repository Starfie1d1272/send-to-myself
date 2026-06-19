import { invoke } from "@tauri-apps/api/core";

// 桌面薄壳启动页：已配置 → 直接跳到部署好的网页；未配置 → 显示连接表单。
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

async function boot(): Promise<void> {
  const saved = await invoke<string | null>("get_server_url");
  if (saved) {
    window.location.replace(saved); // 跳到部署好的网页，之后就在远端站点里用
    return;
  }
  launcher.hidden = false;
  urlInput.focus();
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  err.hidden = true;
  const url = normalize(urlInput.value);
  try {
    new URL(url); // 基本校验
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
