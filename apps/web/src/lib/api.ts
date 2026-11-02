import { itemSchema } from "@sendtomyself/shared";
import type { CreateItemInput, DetectionContext, Item, UpdateItemInput, ItemPage, TimelineFilter, ServerInfo } from "@sendtomyself/shared";

export type ListResult = ItemPage;
export type ListParams = TimelineFilter;

export class ApiError extends Error {
  constructor(public status: number, message: string, public code?: string, public details?: Record<string, unknown>) {
    super(message);
  }
}

/** 所有请求都带 cookie（session）。 */
const opts = (init?: RequestInit): RequestInit => ({ credentials: "include", ...init });

let businessController = new AbortController();
let businessFrozen = false;
export function freezeBusiness(frozen: boolean) {
  businessFrozen = frozen;
  if (frozen) businessController.abort();
  else if (businessController.signal.aborted) businessController = new AbortController();
}
const businessOpts = (init?: RequestInit): RequestInit => {
  if (businessFrozen) throw new Error("Business requests are paused");
  return opts({ ...init, signal: businessController.signal });
};

function responseError(status: number, text: string): ApiError {
  try {
    const value: unknown = JSON.parse(text);
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const { error, ...details } = value as Record<string, unknown>;
      return new ApiError(status, JSON.stringify(value), typeof error === "string" ? error : undefined, details);
    }
  } catch { /* Non-JSON responses must not expose proxy content. */ }
  return new ApiError(status, `HTTP ${status}`);
}
async function handle(r: Response) {
  if (!r.ok) throw responseError(r.status, await r.text().catch(() => ""));
  return r.status === 204 ? null : r.json();
}
function validItem(value: unknown): Item {
  const parsed = itemSchema.safeParse(value);
  if (!parsed.success) throw new Error("Invalid item response");
  return parsed.data;
}
export interface UploadOptions {
  detectionContext?: DetectionContext;
  signal?: AbortSignal;
  onProgress?: (progress: { loaded: number; total?: number }) => void;
}

export interface AuthState {
  authEnabled: boolean;
  authenticated: boolean;
}

export const api = {
  info(): Promise<ServerInfo> { return fetch("/api/info", businessOpts()).then(handle); },
  // —— 认证 ——
  me(): Promise<AuthState> {
    return fetch("/api/auth/me", opts()).then(handle);
  },
  login(password: string): Promise<{ ok: boolean }> {
    return fetch(
      "/api/auth/login",
      opts({
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password }),
      }),
    ).then(handle);
  },
  logout(): Promise<unknown> {
    return fetch("/api/auth/logout", opts({ method: "POST" })).then(handle);
  },

  devices(): Promise<{ devices: Array<{ name: string; tail: string; createdAt: number; lastUsedAt: number | null }> }> {
    return fetch("/api/auth/devices", businessOpts()).then(handle);
  },
  createDevice(name: string): Promise<{ token: string; name: string; createdAt: number }> {
    return fetch("/api/auth/devices", businessOpts({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name }) })).then(handle);
  },
  revokeDevice(tail: string): Promise<null> {
    return fetch(`/api/auth/devices/${encodeURIComponent(tail)}`, businessOpts({ method: "DELETE" })).then(handle);
  },

  // —— 时间线 ——
  list(p: ListParams = {}): Promise<ListResult> {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(p)) {
      if (v !== undefined && v !== "") q.set(k, String(v));
    }
    return fetch(`/api/items?${q.toString()}`, businessOpts()).then(handle);
  },
  create(input: CreateItemInput): Promise<Item> {
    return fetch(
      "/api/items",
      businessOpts({
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      }),
    ).then(handle).then(validItem);
  },
  /** 带附件发送（multipart）。 */
  upload(content: string, files: File[], dedupeKey?: string, options?: UploadOptions): Promise<Item> {
    if (businessFrozen) return Promise.reject(new Error("Business requests are paused"));
    const globalSignal = businessController.signal;
    const fd = new FormData();
    fd.set("content", content);
    if (dedupeKey) fd.set("dedupeKey", dedupeKey);
    if (options?.detectionContext) fd.set("detectionContext", JSON.stringify(options.detectionContext));
    for (const f of files) fd.append("files", f);
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      let settled = false;
      const abort = () => xhr.abort();
      const cleanup = () => {
        options?.signal?.removeEventListener("abort", abort);
        globalSignal.removeEventListener("abort", abort);
        xhr.upload.onprogress = null; xhr.onload = null; xhr.onerror = null; xhr.onabort = null;
      };
      const finish = (fn: () => void) => { if (!settled) { settled = true; cleanup(); fn(); } };
      xhr.open("POST", "/api/items/upload");
      xhr.withCredentials = true;
      xhr.upload.onprogress = event => options?.onProgress?.({ loaded: event.loaded, ...(event.lengthComputable ? { total: event.total } : {}) });
      xhr.onload = () => finish(() => {
        if (xhr.status < 200 || xhr.status >= 300) { reject(responseError(xhr.status, xhr.responseText)); return; }
        try { resolve(validItem(JSON.parse(xhr.responseText))); } catch (error) { reject(error); }
      });
      xhr.onerror = () => finish(() => reject(new Error("Network error")));
      xhr.onabort = () => finish(() => reject(new DOMException("Aborted", "AbortError")));
      options?.signal?.addEventListener("abort", abort);
      globalSignal.addEventListener("abort", abort);
      if (options?.signal?.aborted || globalSignal.aborted) { finish(() => reject(new DOMException("Aborted", "AbortError"))); return; }
      xhr.send(fd);
    });
  },
  update(id: string, patch: UpdateItemInput): Promise<Item> {
    return fetch(
      `/api/items/${id}`,
      businessOpts({
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
      }),
    ).then(handle);
  },
  remove(id: string): Promise<null> {
    return fetch(`/api/items/${id}`, businessOpts({ method: "DELETE" })).then(handle);
  },
  permanentlyRemove(id: string): Promise<null> {
    return fetch(`/api/items/${id}/permanent`, businessOpts({ method: "DELETE" })).then(handle);
  },
  restore(id: string): Promise<Item> {
    return fetch(`/api/items/${id}/restore`, businessOpts({ method: "POST" })).then(handle);
  },
  refetchPreview(id: string): Promise<Item> {
    return fetch(`/api/items/${id}/refetch-preview`, businessOpts({ method: "POST" })).then(handle);
  },
};

// —— 附件 URL（直接给 <img src> / 下载链接用）——
export const attachmentThumbUrl = (id: string) => `/api/attachments/${id}/thumb`;
export const attachmentRawUrl = (id: string) => `/api/attachments/${id}/raw`;
export const attachmentDownloadUrl = (id: string) => `/api/attachments/${id}/raw?download=1`;

/** 链接预览封面/favicon 经服务端代理加载，绕过图床防盗链与混合内容（SPEC §7）。 */
export const previewImageUrl = (raw: string) =>
  `/api/preview/image?url=${encodeURIComponent(raw)}`;
