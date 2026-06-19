import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { db } from "./client.js";

const here = dirname(fileURLToPath(import.meta.url));
const migrationsFolder = resolve(here, "../../drizzle");

/** 启动时运行迁移（SPEC §13：Schema 迁移从第一天起）。 */
migrate(db, { migrationsFolder });

console.log("[db] migrations applied");
