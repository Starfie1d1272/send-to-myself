import { Action, ActionPanel, Form, LocalStorage, showToast, Toast, popToRoot } from "@raycast/api";
import { useEffect, useRef, useState } from "react";
import { send } from "./lib/runtime";

export default function Command() {
  const writes = useRef(Promise.resolve());
  const [content, setContent] = useState("");
  const [files, setFiles] = useState<string[]>([]);
  const [ready, setReady] = useState(false);
  const [sending, setSending] = useState(false);
  useEffect(() => { let active = true;
    void LocalStorage.getItem<string>("note-draft").then(raw => {
      if (!active) return;
      try { const draft = raw ? JSON.parse(raw) : {}; setContent(draft.content ?? ""); setFiles(draft.files ?? []); } catch { /* invalid draft */ }
      setReady(true);
    }).catch(() => { if (active) { setReady(true); void showToast({ style: Toast.Style.Failure, title: "草稿读取失败" }); } });
    return () => { active = false; };
  }, []);
  const save = (nextContent: string, nextFiles: string[]) => {
    writes.current = writes.current.catch(() => {}).then(() => LocalStorage.setItem("note-draft", JSON.stringify({ content: nextContent, files: nextFiles })));
    void writes.current.catch(() => showToast({ style: Toast.Style.Failure, title: "草稿保存失败，请保持窗口打开" }));
  };
  async function submit(intent: "retry" | "new") {
    if (!ready || sending) return;
    setSending(true);
    const toast = await showToast({ style: Toast.Style.Animated, title: "正在发送…" });
    try {
      await writes.current;
      await send(content, files, () => LocalStorage.removeItem("note-draft"), intent);
      setContent(""); setFiles([]);
      toast.style = Toast.Style.Success; toast.title = "已发送到自己";
      await popToRoot().catch(() => {});
    } catch (error) {
      toast.style = Toast.Style.Failure; toast.title = "未能完成，请检查最近记录后重试";
      toast.message = error instanceof Error ? error.message : "请重试";
    } finally { setSending(false); }
  }
  return <Form isLoading={!ready || sending} actions={<ActionPanel><Action.SubmitForm title="发送或重试未确认" onSubmit={() => submit("retry")} /><Action.SubmitForm title="作为新内容发送" onSubmit={() => submit("new")} /></ActionPanel>}>
    <Form.TextArea id="content" title="内容" placeholder="想到什么就记下来，也可以粘贴链接" value={content} onChange={value => { if (!ready || sending) return; setContent(value); save(value, files); }} />
    <Form.FilePicker id="files" title="图片 / 文件" allowMultipleSelection canChooseDirectories={false} value={files} onChange={value => { if (!ready || sending) return; setFiles(value); save(content, value); }} />
    <Form.Description text="发送或重试会沿用最近的未确认请求；选择作为新内容发送会保留先前未确认请求。" />
  </Form>;
}
