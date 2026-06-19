import { resolve } from "node:path";

/** 运行时配置（SPEC §12.1, §8, §13）。 */
export const env = {
  port: Number(process.env.PORT ?? 8787),
  dbPath: process.env.DB_PATH ?? resolve("data/app.db"),
  /** 附件存储根；实际位置 = storageRoot + storageKey。 */
  storageRoot: process.env.STORAGE_ROOT ?? resolve("data/uploads"),
  trashRetentionDays: Number(process.env.TRASH_RETENTION_DAYS ?? 30),
};
