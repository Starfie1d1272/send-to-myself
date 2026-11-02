import type { MiddlewareHandler } from "hono";
import { resolveCredential } from "../lib/auth.js";

export const requireAuth: MiddlewareHandler = async (c, next) => {
  if (resolveCredential(c)) return next();
  return c.json({ error: "unauthorized" }, 401);
};
