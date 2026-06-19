import { Hono } from "hono";
import type { Context } from "hono";
import { zValidator } from "@hono/zod-validator";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { z } from "zod";
import { env } from "../env.js";
import {
  authEnabled,
  createSession,
  destroySession,
  isLocked,
  recordFail,
  recordSuccess,
  SESSION_COOKIE,
  sessionValid,
  verifyPassword,
} from "../lib/auth.js";

const loginInput = z.object({ password: z.string().min(1) });

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
