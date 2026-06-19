import type { ReactNode } from "react";
import { useAuth } from "../hooks/useAuth";
import { LoginView } from "./LoginView";

/** 认证闸门：未登录时拦截到登录页；认证关闭或已登录时放行（SPEC §12.3）。 */
export function AuthGate({ children }: { children: ReactNode }) {
  const { data, isLoading, isError } = useAuth();

  if (isLoading) {
    return (
      <div className="app">
        <div className="grain" aria-hidden />
        <div className="state state--load" style={{ paddingTop: 160 }}>
          正在连接…
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="app">
        <div className="grain" aria-hidden />
        <div className="state" style={{ paddingTop: 140 }}>
          <p className="state__title">无法连接服务</p>
          <p className="state__sub">请确认后端已启动，然后刷新页面。</p>
        </div>
      </div>
    );
  }

  if (data && data.authEnabled && !data.authenticated) {
    return <LoginView />;
  }

  return <>{children}</>;
}
