import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { itemsRoute } from "./routes/items.js";
import { realtimeRoute } from "./routes/realtime.js";

export function createApp() {
  const app = new Hono();

  app.use("*", logger());
  app.use("/api/*", cors());

  app.get("/health", (c) => c.json({ ok: true }));

  app.route("/api/items", itemsRoute);
  app.route("/api/realtime", realtimeRoute);

  return app;
}
