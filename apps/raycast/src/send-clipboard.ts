import { Clipboard, showToast, Toast } from "@raycast/api";
import { fileURLToPath } from "node:url";
import { send } from "./lib/runtime";

export default async function Command() {
  const toast = await showToast({ style: Toast.Style.Animated, title: "正在发送剪贴板…" });
  try {
    const value = await Clipboard.read();
    const path = value.file?.startsWith("file:") ? fileURLToPath(value.file) : value.file;
    if (!path && !value.text?.trim()) throw new Error("剪贴板没有文字或文件。截图请保存为文件后用“随手记录”发送。");
    await send(path ? "" : value.text ?? "", path ? [path] : []);
    toast.style = Toast.Style.Success; toast.title = "已发送到自己";
  } catch (error) {
    toast.style = Toast.Style.Failure; toast.title = "发送失败";
    toast.message = error instanceof Error ? error.message : "请重试";
  }
}
