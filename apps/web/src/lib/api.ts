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
  q?: string;
  cursor?: string;
  deleted?: boolean;
  limit?: number;
}

async function handle(r: Response) {
  if (!r.ok) throw new Error((await r.text().catch(() => "")) || r.statusText);
  return r.status === 204 ? null : r.json();
}

export const api = {
  list(p: ListParams = {}): Promise<ListResult> {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(p)) {
      if (v !== undefined && v !== "" && v !== false) q.set(k, String(v));
    }
    return fetch(`/api/items?${q.toString()}`).then(handle);
  },
  create(input: CreateItemInput): Promise<Item> {
    return fetch("/api/items", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    }).then(handle);
  },
  update(id: string, patch: UpdateItemInput): Promise<Item> {
    return fetch(`/api/items/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    }).then(handle);
  },
  remove(id: string): Promise<null> {
    return fetch(`/api/items/${id}`, { method: "DELETE" }).then(handle);
  },
  restore(id: string): Promise<Item> {
    return fetch(`/api/items/${id}/restore`, { method: "POST" }).then(handle);
  },
};
