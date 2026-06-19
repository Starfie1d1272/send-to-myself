import { resolve } from "node:path";

const num = (v: string | undefined, d: number) => (v ? Number(v) : d);

/** 运行时配置（SPEC §12.1, §8, §13）。 */
export const env = {
  port: num(process.env.PORT, 8787),
  dbPath: process.env.DB_PATH ?? resolve("data/app.db"),
  /** 附件存储根；实际位置 = storageRoot + storageKey。 */
  storageRoot: process.env.STORAGE_ROOT ?? resolve("data/uploads"),
  trashRetentionDays: num(process.env.TRASH_RETENTION_DAYS, 30),

  // —— 附件（SPEC §8）——
  /** 单文件大小上限（字节），默认 50MB。 */
  maxUploadBytes: num(process.env.MAX_UPLOAD_BYTES, 50 * 1024 * 1024),

  // —— 认证（SPEC §12.3）——
  /**
   * 登录口令明文。设置后开启认证；留空=认证关闭（仅本地开发，启动时告警）。
   * 生产部署务必设置。口令在启动时用 argon2id 哈希后仅留内存。
   */
  authPassword: process.env.AUTH_PASSWORD ?? "",
  /** session 有效期（天）。 */
  sessionTtlDays: num(process.env.SESSION_TTL_DAYS, 30),
  /** cookie 是否要求 HTTPS（生产置 true，由反代终止 TLS）。 */
  secureCookie: process.env.SECURE_COOKIE === "true",
  /** 登录失败锁定阈值与窗口（SPEC §12.3 登录限速 + 失败锁定）。 */
  loginMaxFails: num(process.env.LOGIN_MAX_FAILS, 5),
  loginLockMinutes: num(process.env.LOGIN_LOCK_MINUTES, 15),

  // —— 链接预览（SPEC §7）——
  /** 抓取总超时（毫秒）。 */
  previewTimeoutMs: num(process.env.PREVIEW_TIMEOUT_MS, 6000),
  /** 抓取响应大小上限（字节）。 */
  previewMaxBytes: num(process.env.PREVIEW_MAX_BYTES, 2 * 1024 * 1024),
  /** 最大重定向跳数。 */
  previewMaxRedirects: num(process.env.PREVIEW_MAX_REDIRECTS, 5),

  /** 生产/开发标志。 */
  isProd: process.env.NODE_ENV === "production",

  /** 生产环境下由 API 直接托管的前端构建目录（Docker 单容器部署）；留空=不托管。 */
  webDist: process.env.WEB_DIST ?? "",
};
