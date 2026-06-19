import type { CreateItemInput, Item, UpdateItemInput } from "@sendtomyself/shared";

export interface ListResult {
  items: Item[];
  nextCursor: string | null;
}

export interface ListParams {
  kind?: string;
  category?: string;
  isTodo?: boolean;
  completed?: boolean;
  pinned?: boolean;
  sensitive?: boolean;
  q?: string;
  cursor?: string;
  deleted?: boolean;
  limit?: number;
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** 所有请求都带 cookie（session）。 */
const opts = (init?: RequestInit): RequestInit => ({ credentials: "include", ...init });

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

  // —— 时间线 ——
  list(p: ListParams = {}): Promise<ListResult> {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(p)) {
      if (v !== undefined && v !== "" && v !== false) q.set(k, String(v));
    }
    return fetch(`/api/items?${q.toString()}`, opts()).then(handle);
  },
  create(input: CreateItemInput): Promise<Item> {
    return fetch(
      "/api/items",
      opts({
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      }),
    ).then(handle);
  },
  /** 带附件发送（multipart）。 */
  upload(content: string, files: File[]): Promise<Item> {
    const fd = new FormData();
    fd.set("content", content);
    for (const f of files) fd.append("files", f);
    return fetch("/api/items/upload", opts({ method: "POST", body: fd })).then(handle);
  },
  update(id: string, patch: UpdateItemInput): Promise<Item> {
    return fetch(
      `/api/items/${id}`,
      opts({
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
      }),
    ).then(handle);
  },
  remove(id: string): Promise<null> {
    return fetch(`/api/items/${id}`, opts({ method: "DELETE" })).then(handle);
  },
  restore(id: string): Promise<Item> {
    return fetch(`/api/items/${id}/restore`, opts({ method: "POST" })).then(handle);
  },
  refetchPreview(id: string): Promise<Item> {
    return fetch(`/api/items/${id}/refetch-preview`, opts({ method: "POST" })).then(handle);
  },
};

// —— 附件 URL（直接给 <img src> / 下载链接用）——
export const attachmentThumbUrl = (id: string) => `/api/attachments/${id}/thumb`;
export const attachmentRawUrl = (id: string) => `/api/attachments/${id}/raw`;
export const attachmentDownloadUrl = (id: string) => `/api/attachments/${id}/raw?download=1`;

/** 链接预览封面/favicon 经服务端代理加载，绕过图床防盗链与混合内容（SPEC §7）。 */
export const previewImageUrl = (raw: string) =>
  `/api/preview/image?url=${encodeURIComponent(raw)}`;
