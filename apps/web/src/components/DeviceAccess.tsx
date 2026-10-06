import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { copyText } from "../lib/clipboard";

/** Token plaintext exists only in this mounted dialog and is never persisted. */
export function DeviceAccess({ onClose }: { onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState("Raycast Mac");
  const [token, setToken] = useState("");
  const [message, setMessage] = useState("");
  const qc = useQueryClient();
  const devices = useQuery({ queryKey: ["devices"], queryFn: api.devices });
  const create = useMutation({ mutationFn: () => api.createDevice(name.trim()), onSuccess: result => {
    setToken(result.token); setMessage(""); void qc.invalidateQueries({ queryKey: ["devices"] });
  } });
  const revoke = useMutation({ mutationFn: api.revokeDevice, onSuccess: () => {
    setToken(""); void qc.invalidateQueries({ queryKey: ["devices"] });
  } });
  return <dialog ref={element => { dialog.current = element; if (element && !element.open) element.showModal(); }} className="device-dialog" onCancel={onClose} aria-labelledby="device-title">
    <div className="device-dialog__header"><h2 id="device-title">设备接入</h2><button onClick={onClose} aria-label="关闭设备接入">关闭</button></div>
    <p>在 Raycast 扩展设置中填写服务器地址和设备令牌。每台设备分别创建，随时可吊销。</p>
    <label>服务器地址<input readOnly value={window.location.origin} onFocus={event => event.target.select()} /></label>
    <form onSubmit={event => { event.preventDefault(); if (name.trim() && !create.isPending) create.mutate(); }}>
      <label>设备名称<input value={name} maxLength={40} onChange={event => setName(event.target.value)} autoFocus /></label>
      <button className="send" type="submit" disabled={!name.trim() || create.isPending || !!token}>{create.isPending ? "创建中…" : "创建设备令牌"}</button>
    </form>
    {token && <div className="device-dialog__token"><p>令牌仅显示这一次，请复制到 Raycast 的“设备令牌”设置。拥有此令牌即可访问全部内容。</p>
      <input aria-label="新设备令牌" type="password" readOnly value={token} onFocus={event => event.target.select()} />
      <button onClick={async () => setMessage(await copyText(token) ? "已复制令牌" : "复制失败，请手动复制令牌")}>复制令牌</button>
      <button onClick={() => { setToken(""); setMessage(""); }}>已保存</button>
    </div>}
    {(devices.isError || create.isError || revoke.isError) && <p role="alert">操作失败，请确认使用密码登录的会话后重试。</p>}
    {message && <p role="status">{message}</p>}
    {devices.isLoading ? <p>加载设备…</p> : <ul>{devices.data?.devices.map(device => <li key={device.tail}>
      <span>{device.name} · 尾号 {device.tail}</span><button disabled={revoke.isPending} onClick={() => revoke.mutate(device.tail)}>吊销</button>
    </li>)}</ul>}
  </dialog>;
}
