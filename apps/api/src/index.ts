import { serve } from "@hono/node-server";
import "./db/migrate.js"; // 启动即迁移
import { createApp } from "./app.js";
import { env } from "./env.js";

serve({ fetch: createApp().fetch, port: env.port }, (info) => {
  console.log(`[api] listening on http://localhost:${info.port}`);
});
