import { Dialog } from "./ui/Dialog";
import { InlineStatus } from "./ui/InlineStatus";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuthAccess } from "../hooks/useAuth";
import { api, ApiError } from "../lib/api";
import { copyText } from "../lib/clipboard";

/** Token plaintext exists only in this mounted dialog and is never persisted. */
export function AccessTokens({ onClose }: { onClose: () => void }) {
  const access = useAuthAccess();
  const [name, setName] = useState("");
  const [token, setToken] = useState("");
  const [message, setMessage] = useState("");
  const [copying, setCopying] = useState(false);
  const qc = useQueryClient();
  const devices = useQuery({ queryKey: ["devices"], queryFn: api.devices, enabled: access.authenticated && !access.reauthRequired && !access.exiting, retry: false });
  const create = useMutation({ networkMode: "always", mutationFn: () => api.createDevice(name.trim()), onSuccess: result => {
    setToken(result.token); setMessage(""); void qc.invalidateQueries({ queryKey: ["devices"] });
  } });
  const revoke = useMutation({ networkMode: "always", mutationFn: api.revokeDevice, onSuccess: () => {
    setToken(""); void qc.invalidateQueries({ queryKey: ["devices"] });
  } });
  return <Dialog onClose={onClose} labelledBy="device-title">
    <div className="device-dialog__header"><h2 id="device-title">接入令牌</h2><button onClick={onClose} aria-label="关闭接入令牌">关闭</button></div>
    <p>供 Raycast 和 API 工具使用，每个工具单独创建。不是所有已登录设备的列表。</p>
    <a href="https://github.com/Starfie1d1272/send-to-myself/blob/main/apps/raycast/README.md" target="_blank" rel="noreferrer">Raycast 安装说明</a>
    <form onSubmit={event => { event.preventDefault(); if (name.trim() && !create.isPending) create.mutate(); }}>
      <label>设备名称<input value={name} placeholder="例如：书房 Mac 的 Raycast" maxLength={40} onChange={event => setName(event.target.value)} autoFocus /></label>
      <button className="send" type="submit" disabled={!name.trim() || create.isPending || !!token}>{create.isPending ? "创建中…" : "创建接入令牌"}</button>
    </form>
    {token && <div className="device-dialog__token"><p>令牌仅显示这一次，请复制到 Raycast 的“接入令牌”设置。拥有此令牌即可访问全部内容。</p>
      <input aria-label="新接入令牌" type="password" readOnly value={token} onFocus={event => event.target.select()} />
      <button disabled={copying} onClick={async () => { setCopying(true); try { setMessage(await copyText(token) ? "已复制令牌" : "复制失败，请手动复制令牌"); } finally { setCopying(false); } }}>{copying ? "复制中…" : "复制令牌"}</button>
      <button onClick={() => { setToken(""); setMessage(""); }}>已保存</button>
    </div>}
    {devices.error && <InlineStatus tone="error">{devices.error instanceof ApiError && devices.error.status === 401 ? "请在浏览器打开同一地址，用口令登录后管理接入令牌" : <>读取接入令牌失败。 <button className="button" disabled={devices.isFetching} onClick={() => void devices.refetch()}>{devices.isFetching ? "重试中…" : "重试读取"}</button></>}</InlineStatus>}
    {create.error && <InlineStatus tone="error">{create.error instanceof ApiError && create.error.status === 401 ? "请在浏览器打开同一地址，用口令登录后管理接入令牌" : "创建令牌失败，请重试。"}</InlineStatus>}
    {revoke.error && <InlineStatus tone="error">{revoke.error instanceof ApiError && revoke.error.status === 401 ? "请在浏览器打开同一地址，用口令登录后管理接入令牌" : "吊销令牌失败，请重试。"}</InlineStatus>}
    {message && <InlineStatus>{message}</InlineStatus>}
    {devices.isLoading ? <p>加载设备…</p> : <ul>{devices.data?.devices.map(device => <li key={device.tail}>
      <span>{device.name} · 尾号 {device.tail} · 创建于 {new Date(device.createdAt * 1000).toLocaleString()} · 最近使用 {device.lastUsedAt === null ? "尚未使用" : new Date(device.lastUsedAt * 1000).toLocaleString()}</span><button disabled={revoke.isPending} onClick={() => revoke.mutate(device.tail)}>吊销</button>
    </li>)}</ul>}
  </Dialog>;
}
