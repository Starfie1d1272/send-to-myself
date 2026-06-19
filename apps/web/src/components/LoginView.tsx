import { useState } from "react";
import { ApiError } from "../lib/api";
import { useAuthActions } from "../hooks/useAuth";
import { IconLock } from "./icons";

export function LoginView() {
  const { login } = useAuthActions();
  const [pw, setPw] = useState("");
  const [error, setError] = useState("");

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!pw || login.isPending) return;
    setError("");
    login.mutate(pw, {
      onError: (err) => {
        if (err instanceof ApiError && err.status === 429) {
          setError("尝试过多，已临时锁定，请稍后再试");
        } else {
          setError("口令不正确");
        }
        setPw("");
      },
    });
  };

  return (
    <div className="app">
      <div className="grain" aria-hidden />
      <main className="login">
        <div className="login__card">
          <span className="login__mark">
            <IconLock width={22} height={22} />
          </span>
          <h1 className="login__title">SendToMyself</h1>
          <p className="login__sub">发给自己 · 请输入口令</p>
          <form className="login__form" onSubmit={submit}>
            <input
              type="password"
              className="login__input"
              placeholder="口令"
              value={pw}
              autoFocus
              onChange={(e) => setPw(e.target.value)}
            />
            <button className="send login__btn" type="submit" disabled={!pw || login.isPending}>
              {login.isPending ? "登录中…" : "进入"}
            </button>
          </form>
          {error && <p className="login__error">{error}</p>}
        </div>
      </main>
    </div>
  );
}
