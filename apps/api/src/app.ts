import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { env } from "./env.js";
import { authEnabled } from "./lib/auth.js";
import { requireAuth } from "./middleware/require-auth.js";
import { attachmentsRoute } from "./routes/attachments.js";
import { authRoute } from "./routes/auth.js";
import { itemsRoute } from "./routes/items.js";
import { realtimeRoute } from "./routes/realtime.js";

export function createApp() {
  const app = new Hono();

  app.use("*", logger());
  // 同源部署（反代/Docker）默认无需跨域；带 credentials 以携带 session cookie。
  app.use("/api/*", cors({ origin: (o) => o, credentials: true }));

  app.get("/health", (c) => c.json({ ok: true }));

  // 认证（不需登录即可访问）
  app.route("/api/auth", authRoute);

  // 受保护资源
  app.use("/api/items/*", requireAuth);
  app.use("/api/attachments/*", requireAuth);
  app.use("/api/realtime/*", requireAuth);

  app.route("/api/items", itemsRoute);
  app.route("/api/attachments", attachmentsRoute);
  app.route("/api/realtime", realtimeRoute);

  // 生产单容器部署：API 直接托管前端构建产物 + SPA 回退（SPEC §12.1, §21）。
  if (env.webDist) {
    app.use("/*", serveStatic({ root: env.webDist }));
    app.get("*", serveStatic({ path: "index.html", root: env.webDist }));
  }

  if (!authEnabled) {
    console.warn(
      "[auth] AUTH_PASSWORD 未设置：认证已关闭（仅限本地开发）。生产部署务必设置 AUTH_PASSWORD。",
    );
  }

  return app;
}
