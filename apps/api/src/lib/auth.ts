import { randomBytes } from "node:crypto";
import argon2 from "argon2";
import { desc, eq, lt } from "drizzle-orm";
import { db } from "../db/client.js";
import { type DeviceTokenRow, deviceTokens, sessions } from "../db/schema.js";
import { env } from "../env.js";

/**
 * 单用户认证（SPEC §12.3）：argon2id 口令哈希 + session cookie + 登录限速锁定。
 * 口令明文仅来自 env，启动时哈希后保留在内存（不落盘）。
 * 未设 AUTH_PASSWORD 时认证关闭（仅本地开发，app 启动会告警）。
 */

export const authEnabled = env.authPassword.length > 0;
export const SESSION_COOKIE = "stm_session";

let hashPromise: Promise<string> | null = null;
function passwordHash(): Promise<string> {
  if (!hashPromise) {
    hashPromise = argon2.hash(env.authPassword, { type: argon2.argon2id });
  }
  return hashPromise;
}

const nowSec = () => Math.floor(Date.now() / 1000);

export async function verifyPassword(pw: string): Promise<boolean> {
  if (!authEnabled) return true;
  try {
    return await argon2.verify(await passwordHash(), pw);
  } catch {
    return false;
  }
}

export function createSession(): { token: string; expiresAt: number } {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = nowSec() + env.sessionTtlDays * 86_400;
  db.insert(sessions).values({ token, createdAt: nowSec(), expiresAt }).run();
  return { token, expiresAt };
}

export function sessionValid(token: string | undefined): boolean {
  if (!token) return false;
  const row = db.select().from(sessions).where(eq(sessions.token, token)).get();
  if (!row) return false;
  if (row.expiresAt <= nowSec()) {
    db.delete(sessions).where(eq(sessions.token, token)).run();
    return false;
  }
  return true;
}

export function destroySession(token: string | undefined): void {
  if (token) db.delete(sessions).where(eq(sessions.token, token)).run();
}

/** 清理过期 session（启动时调一次）。 */
export function purgeExpiredSessions(): void {
  db.delete(sessions).where(lt(sessions.expiresAt, nowSec())).run();
}

// —— 设备令牌（原生壳 Bearer 认证，SPEC §12.3 扩展）——

/** 签发设备令牌。需已登录（仅网页会话可铸造）。token 明文仅此处返回一次。 */
export function createDeviceToken(name: string): { token: string; createdAt: number } {
  const token = randomBytes(32).toString("base64url");
  const createdAt = nowSec();
  db.insert(deviceTokens).values({ token, name, createdAt, lastUsedAt: null, expiresAt: null }).run();
  return { token, createdAt };
}

/** 校验 Bearer 设备令牌；命中则顺带刷新 lastUsedAt。 */
export function deviceTokenValid(token: string | undefined): boolean {
  if (!token) return false;
  const row = db.select().from(deviceTokens).where(eq(deviceTokens.token, token)).get();
  if (!row) return false;
  if (row.expiresAt != null && row.expiresAt <= nowSec()) {
    db.delete(deviceTokens).where(eq(deviceTokens.token, token)).run();
    return false;
  }
  db.update(deviceTokens).set({ lastUsedAt: nowSec() }).where(eq(deviceTokens.token, token)).run();
  return true;
}

/** 列出设备令牌（不回传完整 token，仅尾 6 位用于辨识）。 */
export function listDeviceTokens(): Array<
  Pick<DeviceTokenRow, "name" | "createdAt" | "lastUsedAt"> & { tail: string }
> {
  return db
    .select()
    .from(deviceTokens)
    .orderBy(desc(deviceTokens.createdAt))
    .all()
    .map((r) => ({ name: r.name, createdAt: r.createdAt, lastUsedAt: r.lastUsedAt, tail: r.token.slice(-6) }));
}

/** 按尾 6 位吊销设备令牌（列表里展示的就是尾号）。返回是否命中。 */
export function revokeDeviceToken(tail: string): boolean {
  const row = db.select().from(deviceTokens).all().find((r) => r.token.slice(-6) === tail);
  if (!row) return false;
  db.delete(deviceTokens).where(eq(deviceTokens.token, row.token)).run();
  return true;
}

// —— 登录限速 / 失败锁定（内存态，单用户足够）——

interface Attempt {
  fails: number;
  lockedUntil: number; // ms
}
const attempts = new Map<string, Attempt>();

export function isLocked(ip: string): number {
  const a = attempts.get(ip);
  if (a && a.lockedUntil > Date.now()) return Math.ceil((a.lockedUntil - Date.now()) / 1000);
  return 0;
}

export function recordFail(ip: string): void {
  const a = attempts.get(ip) ?? { fails: 0, lockedUntil: 0 };
  a.fails += 1;
  if (a.fails >= env.loginMaxFails) {
    a.lockedUntil = Date.now() + env.loginLockMinutes * 60_000;
    a.fails = 0;
  }
  attempts.set(ip, a);
}

export function recordSuccess(ip: string): void {
  attempts.delete(ip);
}
