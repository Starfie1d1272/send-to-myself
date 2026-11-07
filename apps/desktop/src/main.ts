import { invoke } from "@tauri-apps/api/core";

type Settings = {
  serverUrl: string | null;
  shortcut: string;
  shortcutActive: boolean;
  shortcutError: string | null;
  clipboardAvailable: boolean;
  clipboardError: string | null;
};
type ConnectResult = { url: string; clipboardAvailable: boolean; clipboardError: string | null };
type SettingsError = { code: string; message: string };
const messages: Record<string, string> = {
  invalid_url: "请填写应用根地址，例如 http://192.168.1.2:8787。",
  unreachable: "无法连接服务器，请检查地址和网络。",
  tls_error: "HTTPS 证书或连接有问题，请检查地址和证书。",
  wrong_service: "地址不是可用收件箱，或服务暂时不可用。",
  redirect: "地址发生跳转，请复制最终应用根地址。",
  save_failed: "保存失败，请检查配置目录权限后重试。",
  invalid_shortcut: "请使用 Ctrl/⌘/Alt 加一个按键。",
  shortcut_conflict: "快捷键注册失败，可能已被其他程序占用。",
  forbidden: "当前页面无权修改设置。",
  superseded: "连接已被新的操作取代，请重试。",
};
const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const form = el<HTMLFormElement>("form"),
  input = el<HTMLInputElement>("url"),
  connect = el<HTMLButtonElement>("connect");
const error = el<HTMLElement>("err"),
  shortcutError = el<HTMLElement>("shortcut-error");
const record = el<HTMLButtonElement>("record"),
  back = el<HTMLButtonElement>("back");
const settingsView = new URLSearchParams(location.search).get("view") === "settings";
let settings: Settings | null = null,
  candidate = "",
  recording = false,
  busy = false;
function showError(target: HTMLElement, e: unknown): void {
  const code = (e as SettingsError)?.code;
  target.textContent = messages[code] ?? "操作失败，请重试。";
  target.hidden = false;
}
function renderSettings(value: Settings): void {
  settings = value;
  candidate = value.shortcut;
  record.textContent = candidate;
  el<HTMLElement>("shortcut-status").textContent =
    value.shortcutError || (value.shortcutActive ? "快捷键已生效" : "快捷键未生效");
  el<HTMLElement>("clipboard-status").textContent =
    value.clipboardError ||
    (value.clipboardAvailable ? "" : "原生复制暂不可用，可使用页面支持的复制方式");
  back.hidden = !value.serverUrl;
}
async function connectTo(raw: string): Promise<void> {
  if (busy) return;
  let url = raw.trim();
  if (!/^[a-z][a-z\d+.-]*:\/\//i.test(url)) url = `http://${url}`;
  input.value = url;
  error.hidden = true;
  busy = true;
  connect.disabled = true;
  back.disabled = true;
  try {
    if (new URL(url).origin === location.origin) throw { code: "invalid_url" };
    const result = await invoke<ConnectResult>("connect_server", { url });
    if (!result.clipboardAvailable) {
      error.textContent = "原生复制暂不可用，可使用页面支持的复制方式";
      error.hidden = false;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    location.replace(result.url);
  } catch (e) {
    showError(error, e instanceof TypeError ? { code: "invalid_url" } : e);
  } finally {
    busy = false;
    connect.disabled = false;
    back.disabled = false;
  }
}
form.addEventListener("submit", (e) => {
  e.preventDefault();
  void connectTo(input.value);
});
back.addEventListener("click", () => {
  if (settings?.serverUrl) void connectTo(settings.serverUrl);
});
record.addEventListener("click", () => {
  recording = true;
  record.textContent = "请按下快捷键（Esc 取消）";
  shortcutError.hidden = true;
});
record.addEventListener("keydown", (e) => {
  if (!recording || e.key === "Tab") {
    if (e.key === "Tab") {
      recording = false;
      record.textContent = candidate;
    }
    return;
  }
  e.preventDefault();
  if (e.key === "Escape") {
    recording = false;
    record.textContent = candidate;
    return;
  }
  if (["Control", "Meta", "Alt", "Shift"].includes(e.key)) return;
  const key = /^Key[A-Z]$/.test(e.code)
    ? e.code.slice(3)
    : /^Digit[0-9]$/.test(e.code)
      ? e.code.slice(5)
      : /^F(?:[1-9]|1[0-2])$/.test(e.code)
        ? e.code
        : "";
  if ((!e.ctrlKey && !e.metaKey && !e.altKey) || !key) {
    showError(shortcutError, { code: "invalid_shortcut" });
    return;
  }
  candidate = [
    e.ctrlKey && "Control",
    e.metaKey && "Super",
    e.altKey && "Alt",
    e.shiftKey && "Shift",
    key,
  ]
    .filter(Boolean)
    .join("+");
  recording = false;
  record.textContent = candidate;
});
async function saveShortcut(shortcut: string): Promise<void> {
  shortcutError.hidden = true;
  try {
    renderSettings(await invoke<Settings>("set_shortcut", { shortcut }));
  } catch (e) {
    showError(shortcutError, e);
  }
}
el<HTMLButtonElement>("save-shortcut").addEventListener(
  "click",
  () => void saveShortcut(candidate),
);
el<HTMLButtonElement>("reset-shortcut").addEventListener(
  "click",
  () => void saveShortcut("CommandOrControl+Shift+S"),
);
async function boot(): Promise<void> {
  el<HTMLElement>("launcher").hidden = false;
  try {
    const value = await invoke<Settings>("get_settings");
    renderSettings(value);
    input.value = value.serverUrl ?? "";
    if (settingsView) {
      el<HTMLElement>("title").textContent = "设置";
      connect.textContent = "保存并连接";
      el<HTMLElement>("settings").hidden = false;
    } else if (value.serverUrl) {
      await connectTo(value.serverUrl);
    }
  } catch (e) {
    showError(error, e);
  }
  el<HTMLElement>("launcher").hidden = false;
}
void boot();
