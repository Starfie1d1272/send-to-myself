import type { CreateItemInput, Item, UpdateItemInput, ItemPage, TimelineFilter, ServerInfo } from "@sendtomyself/shared";

export type ListResult = ItemPage;
export type ListParams = TimelineFilter;

export class ApiError extends Error {
  constructor(public status: number, message: string) {
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

async function handle(r: Response) {
  if (!r.ok) {
    const text = await r.text().catch(() => "");
    throw new ApiError(r.status, text || r.statusText);
  }
  return r.status === 204 ? null : r.json();
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
    ).then(handle);
  },
  /** 带附件发送（multipart）。 */
  upload(content: string, files: File[], dedupeKey?: string): Promise<Item> {
    const fd = new FormData();
    fd.set("content", content);
    if (dedupeKey) fd.set("dedupeKey", dedupeKey);
    for (const f of files) fd.append("files", f);
    return fetch("/api/items/upload", businessOpts({ method: "POST", body: fd })).then(handle);
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
