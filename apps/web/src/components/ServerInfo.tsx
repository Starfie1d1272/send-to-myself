import { Dialog } from "./ui/Dialog";
import { InlineStatus } from "./ui/InlineStatus";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import type { RealtimeStatus } from "../lib/realtime";
import { useAuthAccess } from "../hooks/useAuth";

export function ServerInfo({ onClose, status }: { onClose: () => void; status: RealtimeStatus }) {
  const access = useAuthAccess();
  const info = useQuery({ queryKey: ["server", "info"], queryFn: api.info, enabled: access.authenticated && !access.reauthRequired && !access.exiting, retry: false });
  const mib = (n: number) => `${n / 1024 / 1024} MiB`;
  return <Dialog onClose={onClose} labelledBy="info-title">
    <div className="device-dialog__header"><h2 id="info-title">服务器信息</h2><button onClick={onClose}>关闭</button></div>
    <p>当前地址：{window.location.origin}</p>
    <p>实时连接：{status === "connected" ? "已连接" : status === "connecting" ? "正在连接" : "实时连接中断，正在重连"}</p>
    {info.isLoading && <p>正在读取…</p>}
    {info.isError && <InlineStatus tone="error">读取失败 <button onClick={() => void info.refetch()}>重试</button></InlineStatus>}
    {info.data && <><p>核心版本：{info.data.coreVersion}{info.data.buildRevision && ` · ${info.data.buildRevision.slice(0, 12)}`}</p>
      <p>单文件 {mib(info.data.maxUploadBytes)}；整批 {mib(info.data.maxUploadTotalBytes)}；最多 {info.data.maxUploadFiles} 件</p>
      <p>回收站：{info.data.trashRetentionDays ? `${info.data.trashRetentionDays} 天` : "自动到期清理已关闭"}</p></>}
  </Dialog>;
}
