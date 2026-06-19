import type { MiddlewareHandler } from "hono";
import { getCookie } from "hono/cookie";
import { authEnabled, SESSION_COOKIE, sessionValid } from "../lib/auth.js";

/** 保护需登录的路由（SPEC §12.3）。认证关闭时直接放行。 */
export const requireAuth: MiddlewareHandler = async (c, next) => {
  if (!authEnabled) return next();
  if (sessionValid(getCookie(c, SESSION_COOKIE))) return next();
  return c.json({ error: "unauthorized" }, 401);
};
