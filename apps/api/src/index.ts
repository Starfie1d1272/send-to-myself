import { serve } from "@hono/node-server";
import "./db/migrate.js"; // 启动即迁移
import { createApp } from "./app.js";
import { env } from "./env.js";
import { purgeExpiredSessions } from "./lib/auth.js";

import { initializeRetention, startTrashScan } from "./services/trash.js";

purgeExpiredSessions();
initializeRetention();

const server = serve({ fetch: createApp().fetch, port: env.port }, (info) => {
  const stopTrashScan = startTrashScan();
  server.once("close", stopTrashScan);
  console.log(`[api] listening on http://localhost:${info.port}`);
});
