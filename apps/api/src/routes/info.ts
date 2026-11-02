import { readFileSync } from "node:fs";
import { Hono } from "hono";
import { env } from "../env.js";

const { version } = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as { version: string };
export const infoRoute = new Hono();
infoRoute.get("/", (c) => {
  c.header("Cache-Control", "no-store");
  return c.json({ service: "send-to-myself" as const, coreVersion: version,
    buildRevision: process.env.BUILD_REVISION || null, maxUploadBytes: env.maxUploadBytes,
    maxUploadTotalBytes: env.maxUploadTotalBytes, maxUploadFiles: env.maxUploadFiles,
    trashRetentionDays: env.trashRetentionDays });
});
