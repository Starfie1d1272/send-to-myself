import { useState } from "react";
import { IconLock } from "./icons";
import { InlineStatus } from "./ui/InlineStatus";

export function LoginView({
  submit,
  native,
  pending,
  error,
  modal = false,
  notice = "",
}: {
  submit: (password: string) => Promise<boolean>;
  native: boolean;
  pending: boolean;
  error: string;
  modal?: boolean;
  notice?: string;
}) {
  const [pw, setPw] = useState("");
  const card = (
    <div className="login__card">
      <span className="login__mark">
        <IconLock width={22} height={22} />
      </span>
      <h1 className="login__title">{modal ? "登录已过期，重新登录后继续" : "SendToMyself"}</h1>
      <p className="login__sub">
        {native ? "请在应用中重新登录" : "NAS 上的跨设备收件箱 · 请输入口令"}
      </p>
      <form
        className="login__form"
        onSubmit={(e) => {
          e.preventDefault();
          void submit(pw).then((clear) => {
            if (clear) setPw("");
          });
        }}
      >
        {!native && (
          <input
            type="password"
            aria-label="口令"
            className="login__input"
            placeholder="口令"
            value={pw}
            autoFocus
            onChange={(e) => setPw(e.target.value)}
          />
        )}
        <button className="send login__btn" type="submit" disabled={pending || (!native && !pw)}>
          {pending ? "登录中…" : native ? "在应用中重新登录" : "进入"}
        </button>
      </form>
      {error && (
        <p className="login__error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <div className="inline-status--spaced">
          <InlineStatus>{notice}</InlineStatus>
        </div>
      )}
      {error.includes("Cookie") && (
        <a
          className="login__doc-link"
          href="https://github.com/Starfie1d1272/send-to-myself/blob/main/docs/DEPLOY.md"
          target="_blank"
          rel="noreferrer"
        >
          查看部署说明
        </a>
      )}
    </div>
  );
  return modal ? (
    <dialog
      ref={(el) => {
        if (el && !el.open) el.showModal();
      }}
      aria-label="重新登录"
      onCancel={(e) => e.preventDefault()}
      style={{
        position: "fixed",
        inset: 0,
        width: "100%",
        height: "100%",
        maxWidth: "none",
        maxHeight: "none",
        border: 0,
        padding: 0,
        background: "var(--paper)",
      }}
    >
      <div className="login">{card}</div>
    </dialog>
  ) : (
    <div className="app">
      <div className="grain" aria-hidden />
      <main className="login">{card}</main>
    </div>
  );
}
