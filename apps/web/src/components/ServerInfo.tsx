import { Dialog } from "./ui/Dialog";
import { InlineStatus } from "./ui/InlineStatus";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import type { RealtimeStatus } from "../lib/realtime";
import { useAuthAccess } from "../hooks/useAuth";

declare const __WEB_VERSION__: string;
declare const __BUILD_REVISION__: string | null;

export function ServerInfo({ onClose, status }: { onClose: () => void; status: RealtimeStatus }) {
  const access = useAuthAccess();
  const info = useQuery({ queryKey: ["server", "info"], queryFn: api.info, enabled: access.authenticated && !access.reauthRequired && !access.exiting, retry: false });
  const mib = (n: number) => `${n / 1024 / 1024} MiB`;
  return <Dialog onClose={onClose} labelledBy="info-title">
    <div className="device-dialog__header"><h2 id="info-title">服务器信息</h2><button onClick={onClose}>关闭</button></div>
    <dl className="info-list">
      <div><dt>当前地址</dt><dd>{window.location.origin}</dd></div>
      <div><dt>实时连接</dt><dd>{status === "connected" ? "已连接" : status === "connecting" ? "正在连接" : "实时连接中断，正在重连"}</dd></div>
      <div><dt>当前页面版本</dt><dd>{__WEB_VERSION__}{__BUILD_REVISION__ && ` · ${__BUILD_REVISION__.slice(0, 12)}`}</dd></div>
      {info.data && <><div><dt>核心版本</dt><dd>{info.data.coreVersion}{info.data.buildRevision && ` · ${info.data.buildRevision.slice(0, 12)}`}</dd></div>
        <div><dt>上传限制</dt><dd>单文件 {mib(info.data.maxUploadBytes)} · 整批 {mib(info.data.maxUploadTotalBytes)} · 最多 {info.data.maxUploadFiles} 件</dd></div>
        <div><dt>回收站保留时间</dt><dd>{info.data.trashRetentionDays ? `${info.data.trashRetentionDays} 天` : "不限时"}</dd></div></>}
    </dl>
    {info.isLoading && <p>正在读取…</p>}
    {info.isError && <InlineStatus tone="error">读取失败 <button className="button" onClick={() => void info.refetch()}>重试</button></InlineStatus>}
  </Dialog>;
}
