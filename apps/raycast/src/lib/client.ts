import type { Item } from "./types";

export function normalizeServer(raw: string): string {
  const url = new URL(raw.includes("://") ? raw.trim() : `https://${raw.trim()}`);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error("请填写 HTTP/HTTPS 服务器地址，不包含账户、查询参数或片段。");
  }
  return url.href.replace(/\/+$/, "");
}
export class InboxClient {
  readonly server: string;
  constructor(server: string, private token: string, private transport: typeof fetch = fetch) {
    this.server = normalizeServer(server);
    if (!token.trim()) throw new Error("请先在扩展设置中填写设备令牌。");
  }
  private async request(path: string, init: RequestInit = {}): Promise<Response> {
    let response: Response;
    try {
      response = await this.transport(`${this.server}${path}`, {
        ...init, headers: { ...init.headers, authorization: `Bearer ${this.token.trim()}` },
        redirect: "error", signal: init.signal ?? AbortSignal.timeout(30_000),
      });
    } catch (error) {
      if (init.signal?.aborted) throw error;
      throw new Error("无法连接服务器。发送结果可能尚未确认，请保持内容不变后重试。");
    }
    if (!response.ok) {
      throw new Error(response.status === 401 ? "设备令牌无效或已吊销，请更新扩展设置。" :
        response.status === 413 ? "附件超过服务器上传限制，请减少文件后重试。" :
        `请求失败（${response.status}），请重试。`);
    }
    return response;
  }
  async list(q = "", cursor?: string, signal?: AbortSignal): Promise<{ items: Item[]; nextCursor: string | null }> {
    const params = new URLSearchParams({ q, limit: "30" });
    if (cursor) params.set("cursor", cursor);
    return (await this.request(`/api/items?${params}`, { signal })).json();
  }
  async send(content: string, files: File[], dedupeKey: string): Promise<Item> {
    if (!content.trim() && !files.length) throw new Error("请填写内容或选择文件。");
    if (files.length) {
      const body = new FormData();
      body.set("content", content); body.set("dedupeKey", dedupeKey);
      files.forEach(file => body.append("files", file));
      return (await this.request("/api/items/upload", { method: "POST", body })).json();
    }
    return (await this.request("/api/items", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ content, dedupeKey }) })).json();
  }
  async attachment(id: string): Promise<Blob> {
    return (await this.request(`/api/attachments/${encodeURIComponent(id)}/raw`)).blob();
  }
}
