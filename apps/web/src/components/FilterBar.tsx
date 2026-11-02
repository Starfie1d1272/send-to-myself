import { useState } from "react";
import type { TimelineViewState } from "../lib/timeline";
import { IconSearch } from "./icons";

export function FilterBar({ state, onChange }: { state: TimelineViewState; onChange: (state: TimelineViewState) => void }) {
  const [open, setOpen] = useState(false);
  const set = (patch: Partial<TimelineViewState>) => onChange({ ...state, ...patch });
  const filtered = state.contentType !== "all" || state.category !== "all" || state.sensitiveOnly;
  return <div className="filterbar">
    <div className="chips chips--filter">
      {([['all','全部'],['todo','待办'],['favorites','收藏']] as const).map(([key,label]) => <button key={key} className={`chip${state.view === key ? ' chip--on' : ''}`} onClick={() => set(state.view === 'trash' ? { view: key, query: '', contentType: 'all', category: 'all', sensitiveOnly: false } : { view: key })}>{label}</button>)}
      {state.view === 'trash' && <span>回收站</span>}
    </div>
    {state.view === 'todo' && <div className="chips">{([['open','未完成'],['next7days','未来7天'],['completed','已完成']] as const).map(([key,label]) => <button key={key} className={`chip${state.todoScope === key ? ' chip--on' : ''}`} onClick={() => set({todoScope:key})}>{label}</button>)}</div>}
    <label className="search"><IconSearch width={16} height={16}/><input placeholder="搜索正文、链接、文件名…" value={state.query} onChange={e => set({query:e.target.value})}/></label>
    <button onClick={() => setOpen(!open)} aria-expanded={open}>筛选</button>
    {open && <div className="filter-panel">
      <div>内容 {([['all','全部'],['link','链接'],['image','图片'],['file','文件']] as const).map(([key,label]) => <button key={key} className={`chip${state.contentType === key ? ' chip--on' : ''}`} onClick={() => set({contentType:key})}>{label}</button>)}</div>
      <div>标记 {([['all','全部'],['idea','想法'],['read_later','稍后看']] as const).map(([key,label]) => <button key={key} className={`chip${state.category === key ? ' chip--on' : ''}`} onClick={() => set({category:key})}>{label}</button>)}</div>
      <label><input type="checkbox" checked={state.sensitiveOnly} onChange={e => set({sensitiveOnly:e.target.checked})}/> 仅敏感内容</label>
    </div>}
    {filtered && <div className="chips">{state.contentType !== 'all' && <button onClick={() => set({contentType:'all'})}>{{link:'链接',image:'图片',file:'文件'}[state.contentType]} ×</button>}{state.category !== 'all' && <button onClick={() => set({category:'all'})}>{state.category === 'idea' ? '想法' : '稍后看'} ×</button>}{state.sensitiveOnly && <button onClick={() => set({sensitiveOnly:false})}>敏感内容 ×</button>}<button onClick={() => set({contentType:'all',category:'all',sensitiveOnly:false})}>清除筛选</button></div>}
  </div>;
}
