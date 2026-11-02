import { Dialog } from "./ui/Dialog";
import { InlineStatus } from "./ui/InlineStatus";
import { useState } from "react";
import { clientReleases } from "../config/client-releases";
import { copyText } from "../lib/clipboard";

export function ConnectDevices({ onClose }: { onClose: () => void }) {
  const [message, setMessage] = useState("");
  return <Dialog onClose={onClose} labelledBy="connect-title">
    <div className="device-dialog__header"><h2 id="connect-title">连接手机 / 电脑</h2><button onClick={onClose}>关闭</button></div>
    <label>当前访问地址<input readOnly value={window.location.origin} onFocus={e => e.target.select()} /></label>
    <button onClick={async () => setMessage(await copyText(window.location.origin) ? "已复制地址" : "复制失败，请手动选择地址复制")}>复制地址</button>
    {message && <InlineStatus>{message}</InlineStatus>}
    <p>在另一台设备打开这个地址，用同一个口令登录。</p>
    {clientReleases.map(client => <div key={client.platform}><strong>{client.label}</strong> {client.releaseUrl && <a href={client.releaseUrl} target="_blank" rel="noreferrer">{client.status === "preview" ? "查看开发预览" : "查看下载"}</a>}<p>{client.note}</p></div>)}
    <p>连接第二台设备 → 发一张图片和一个文件 → 在当前设备打开/保存</p>
    <p>局域网地址通常需要连接同一网络；外出访问请使用你已配置且验证可用的 NAS 访问地址。<a href="https://github.com/Starfie1d1272/send-to-myself/blob/main/docs/DEPLOY.md" target="_blank" rel="noreferrer">部署说明</a></p>
  </Dialog>;
}
