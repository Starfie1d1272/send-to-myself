import { useEffect, useState } from "react";
import { copyText } from "../lib/clipboard";
import { clearEditDraft, draftGeneration, draftIsWritable, listEditDrafts, type EditDraft } from "../lib/draft";

/** Existing edit snapshots stay reachable even if their original card disappears. */
export function EditDraftRecovery() {
  const [drafts, setDrafts] = useState<EditDraft[]>([]);
  const [notice, setNotice] = useState("");
  useEffect(() => {
    let active = true;
    const refresh = () => {
      const generation = draftGeneration();
      void listEditDrafts().then(values => {
        if (active && draftIsWritable() && generation === draftGeneration()) setDrafts(values.sort((a, b) => b.savedAt - a.savedAt));
      }).catch(() => {});
    };
    refresh();
    window.addEventListener("send-to-myself:edit-drafts-changed", refresh);
    window.addEventListener("focus", refresh);
    return () => { active = false; window.removeEventListener("send-to-myself:edit-drafts-changed", refresh); window.removeEventListener("focus", refresh); };
  }, []);
  if (!drafts.length) return null;
  return <details>
    <summary>本机未保存的编辑（{drafts.length}）</summary>
    <p>原内容不可见时，可以复制编辑文字后另存。</p>
    <ul>{drafts.map((draft, index) => <li key={draft.itemId}>
      <details><summary>编辑草稿 {index + 1} · {new Date(draft.savedAt).toLocaleString()}</summary>
        <textarea readOnly aria-label={`编辑草稿 ${index + 1}`} value={draft.content} />
        <button type="button" onClick={async () => setNotice(await copyText(draft.content) ? "已复制编辑文字" : "复制失败，请手动选择文字复制")}>复制编辑文字</button>
        <details><summary>删除本机草稿</summary><p>删除后无法从本机恢复这份编辑文字。</p><button type="button" onClick={async () => {
          try { setNotice(await clearEditDraft(draft.itemId, draft) ? "已删除本机草稿" : "草稿已变化，请重新查看"); }
          catch { setNotice("删除失败，请重试"); }
        }}>确认删除本机草稿</button></details>
      </details>
    </li>)}</ul>
    {notice && <p role="status">{notice}</p>}
  </details>;
}
