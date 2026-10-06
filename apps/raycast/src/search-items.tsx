import { Action, ActionPanel, Clipboard, List, showToast, Toast } from "@raycast/api";
import { useEffect, useRef, useState } from "react";
import type { Item } from "./lib/types";
import { client, download } from "./lib/runtime";

export default function Command() {
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<Item[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const current = useRef(0);
  const paging = useRef(false);
  useEffect(() => {
    const version = ++current.current;
    const controller = new AbortController();
    paging.current = false;
    setLoading(true); setItems([]); setCursor(null); setError("");
    void (async () => {
      try { const result = await client().list(query, undefined, controller.signal);
        if (version === current.current) { setItems(result.items); setCursor(result.nextCursor); }
      } catch (cause) { if (!controller.signal.aborted && version === current.current) setError(cause instanceof Error ? cause.message : "加载失败"); }
      finally { if (version === current.current) setLoading(false); }
    })();
    return () => { controller.abort(); current.current++; };
  }, [query, revision]);
  async function more() {
    if (!cursor || paging.current) return;
    const version = current.current;
    paging.current = true; setLoading(true);
    try { const result = await client().list(query, cursor);
      if (version === current.current) { setItems(previous => [...previous, ...result.items]); setCursor(result.nextCursor); }
    } catch (cause) { await showToast({ style: Toast.Style.Failure, title: "加载失败", message: cause instanceof Error ? cause.message : "请重试" }); }
    finally { if (version === current.current) { paging.current = false; setLoading(false); } }
  }
  async function copyFile(id: string, filename: string) {
    const toast = await showToast({ style: Toast.Style.Animated, title: "正在获取文件…" });
    try { const path = await download(id, filename); await Clipboard.copy({ file: path }); toast.style = Toast.Style.Success; toast.title = "文件已复制"; }
    catch (cause) { toast.style = Toast.Style.Failure; toast.title = "复制失败"; toast.message = cause instanceof Error ? cause.message : "请重试"; }
  }
  return <List isLoading={loading} onSearchTextChange={setQuery} throttle searchBarPlaceholder="搜索文字、链接和文件名" pagination={{ pageSize: 30, hasMore: !!cursor, onLoadMore: more }}>
    {!items.length && <List.EmptyView title={error || "没有记录"} description="从其他设备发送后刷新，或换个关键词。" actions={<ActionPanel><Action title="刷新" onAction={() => setRevision(v => v + 1)} /></ActionPanel>} />}
    {items.map(item => <List.Item key={item.id} id={item.id} title={item.sensitive ? "敏感内容（在主窗口查看）" : item.content.split("\n")[0] || item.attachments?.[0]?.filename || "附件"} subtitle={item.sensitive ? undefined : item.kind} actions={<ActionPanel>
      {!item.sensitive && item.content && <><Action.CopyToClipboard title="复制内容" content={item.content} /><Action.Paste title="粘贴到当前应用" content={item.content} /></>}
      {!item.sensitive && item.attachments?.map(a => <Action key={a.id} title={`复制文件：${a.filename}`} onAction={() => copyFile(a.id, a.filename)} />)}
      <Action.OpenInBrowser title="打开主窗口网页" url={client().server} />
      <Action title="刷新记录" onAction={() => setRevision(v => v + 1)} />
    </ActionPanel>} />)}
  </List>;
}
