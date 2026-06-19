import type { MiddlewareHandler } from "hono";
import { getCookie } from "hono/cookie";
import {
  authEnabled,
  deviceTokenValid,
  SESSION_COOKIE,
  sessionValid,
} from "../lib/auth.js";

/** 从 `Authorization: Bearer <token>` 取设备令牌。 */
function bearer(c: Parameters<MiddlewareHandler>[0]): string | undefined {
  const h = c.req.header("authorization");
  if (!h) return undefined;
  const m = /^Bearer\s+(.+)$/i.exec(h);
  return m?.[1];
}

/**
 * 保护需登录的路由（SPEC §12.3）。认证关闭时直接放行。
 * 两种凭据均可：网页 session cookie，或原生壳的 Bearer 设备令牌。
 */
export const requireAuth: MiddlewareHandler = async (c, next) => {
  if (!authEnabled) return next();
  if (sessionValid(getCookie(c, SESSION_COOKIE))) return next();
  if (deviceTokenValid(bearer(c))) return next();
  return c.json({ error: "unauthorized" }, 401);
};
