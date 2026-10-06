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
  async function submit() {
    if (!ready || sending) return;
    setSending(true);
    const toast = await showToast({ style: Toast.Style.Animated, title: "正在发送…" });
    try {
      await writes.current;
      await send(content, files);
      await LocalStorage.removeItem("note-draft");
      toast.style = Toast.Style.Success; toast.title = "已发送到自己";
      await popToRoot();
    } catch (error) {
      toast.style = Toast.Style.Failure; toast.title = "发送失败，草稿已保留";
      toast.message = error instanceof Error ? error.message : "请重试";
    } finally { setSending(false); }
  }
  return <Form isLoading={!ready || sending} actions={<ActionPanel><Action.SubmitForm title="发送到自己" onSubmit={submit} /></ActionPanel>}>
    <Form.TextArea id="content" title="内容" placeholder="想到什么就记下来，也可以粘贴链接" value={content} onChange={value => { if (!ready || sending) return; setContent(value); save(value, files); }} />
    <Form.FilePicker id="files" title="图片 / 文件" allowMultipleSelection canChooseDirectories={false} value={files} onChange={value => { if (!ready || sending) return; setFiles(value); save(content, value); }} />
    <Form.Description text="发送失败可直接重试；文字草稿和所选文件路径会在本机保留。" />
  </Form>;
}
