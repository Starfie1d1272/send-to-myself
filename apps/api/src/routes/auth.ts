import { Hono } from "hono";
import type { Context } from "hono";
import { zValidator } from "@hono/zod-validator";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { z } from "zod";
import { env } from "../env.js";
import {
  authEnabled,
  createDeviceToken,
  createSession,
  destroySession,
  isLocked,
  listDeviceTokens,
  recordFail,
  recordSuccess,
  revokeDeviceToken,
  SESSION_COOKIE,
  sessionValid,
  verifyPassword,
} from "../lib/auth.js";

const loginInput = z.object({ password: z.string().min(1) });
const deviceInput = z.object({ name: z.string().min(1).max(40) });

function clientIp(c: Context): string {
  const xff = c.req.header("x-forwarded-for");
  if (xff) return xff.split(",")[0]?.trim() ?? "local";
  return c.req.header("x-real-ip") ?? "local";
}

function setSessionCookie(c: Context, token: string, maxAgeSec: number): void {
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "Lax",
    secure: env.secureCookie,
    path: "/",
    maxAge: maxAgeSec,
  });
}

export const authRoute = new Hono();

/** 是否需要登录 + 当前是否已登录。 */
authRoute.get("/me", (c) => {
  const authed = !authEnabled || sessionValid(getCookie(c, SESSION_COOKIE));
  return c.json({ authEnabled, authenticated: authed });
});

authRoute.post("/login", zValidator("json", loginInput), async (c) => {
  if (!authEnabled) return c.json({ ok: true, authEnabled: false });

  const ip = clientIp(c);
  const lockRemain = isLocked(ip);
  if (lockRemain > 0) {
    return c.json({ error: "locked", retryAfter: lockRemain }, 429);
  }

  const { password } = c.req.valid("json");
  if (!(await verifyPassword(password))) {
    recordFail(ip);
    return c.json({ error: "invalid_credentials" }, 401);
  }

  recordSuccess(ip);
  const { token, expiresAt } = createSession();
  setSessionCookie(c, token, expiresAt - Math.floor(Date.now() / 1000));
  return c.json({ ok: true });
});

authRoute.post("/logout", (c) => {
  destroySession(getCookie(c, SESSION_COOKIE));
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
  return c.json({ ok: true });
});

// —— 设备令牌管理（仅网页 session 可铸造/吊销，设备令牌自身无权管理）——

/** 仅放行已登录的网页会话；设备令牌（Bearer）不得管理令牌。 */
function sessionOnly(c: Context): boolean {
  return !authEnabled || sessionValid(getCookie(c, SESSION_COOKIE));
}

authRoute.get("/devices", (c) => {
  if (!sessionOnly(c)) return c.json({ error: "unauthorized" }, 401);
  return c.json({ devices: listDeviceTokens() });
});

/** 签发设备令牌。明文 token 仅此次返回，需立即拷贝到原生壳。 */
authRoute.post("/devices", zValidator("json", deviceInput), (c) => {
  if (!sessionOnly(c)) return c.json({ error: "unauthorized" }, 401);
  const { name } = c.req.valid("json");
  const { token, createdAt } = createDeviceToken(name);
  return c.json({ token, name, createdAt }, 201);
});

authRoute.delete("/devices/:tail", (c) => {
  if (!sessionOnly(c)) return c.json({ error: "unauthorized" }, 401);
  return revokeDeviceToken(c.req.param("tail"))
    ? c.body(null, 204)
    : c.json({ error: "not_found" }, 404);
});
