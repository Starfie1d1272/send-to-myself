import { useState } from "react";
import { IconLock } from "./icons";

export function LoginView({ submit, native, pending, error, modal = false, notice = "" }: {
  submit: (password: string) => Promise<boolean>; native: boolean; pending: boolean; error: string; modal?: boolean; notice?: string;
}) {
  const [pw, setPw] = useState("");
  const form = <main className="login" role={modal ? "dialog" : undefined} aria-modal={modal || undefined} aria-label={modal ? "重新登录" : undefined}>
    <div className="login__card">
      <span className="login__mark"><IconLock width={22} height={22} /></span>
      <h1 className="login__title">{modal ? "登录已过期，重新登录后继续" : "发给自己"}</h1>
      <p className="login__sub">{native ? "请在应用中重新登录" : "SendToMyself · 请输入口令"}</p>
      <form className="login__form" onSubmit={e => { e.preventDefault(); void submit(pw).then(clear => { if (clear) setPw(""); }); }}>
        {!native && <input type="password" aria-label="口令" className="login__input" placeholder="口令" value={pw} autoFocus onChange={e => setPw(e.target.value)} />}
        <button className="send login__btn" type="submit" disabled={pending || (!native && !pw)}>{pending ? "登录中…" : native ? "在应用中重新登录" : "进入"}</button>
      </form>
      {error && <p className="login__error" role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {error.includes("Cookie") && <a href="https://github.com/Starfie1d1272/send-to-myself/blob/main/docs/DEPLOY.md">查看部署说明</a>}
    </div>
  </main>;
  return modal ? <dialog ref={el => { if (el && !el.open) el.showModal(); }} onCancel={e => e.preventDefault()} style={{ position: "fixed", inset: 0, width: "100%", height: "100%", maxWidth: "none", maxHeight: "none", border: 0, padding: 0, background: "#f6f1e8" }}>{form}</dialog> : <div className="app"><div className="grain" aria-hidden />{form}</div>;
}
