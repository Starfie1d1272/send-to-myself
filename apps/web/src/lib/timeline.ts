import type { FilterKey } from "../components/FilterBar";
import { api, type ListParams, type ListResult } from "./api";

export function timelineParams(filter: FilterKey, query: string, now = new Date()): ListParams {
  const base: ListParams = { limit: 100 };
  if (query) base.q = query;
  switch (filter) {
    case "todo": return { ...base, isTodo: true, completed: false };
    case "due": {
      const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 8);
      return { ...base, isTodo: true, completed: false, dueBefore: end.toISOString() };
    }
    case "link": return { ...base, hasLinks: true };
    case "idea": case "read_later": return { ...base, category: filter };
    case "image": case "file": return { ...base, kind: filter };
    case "secret": return { ...base, sensitive: true };
    case "pinned": return { ...base, pinned: true };
    case "completed": return { ...base, completed: true };
    case "trash": return { ...base, deleted: true };
    default: return base;
  }
}

export function itemPages(params: ListParams) {
  return {
    queryKey: ["items", params],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }: { pageParam: string | undefined }) => api.list({ ...params, cursor: pageParam }),
    getNextPageParam: (page: ListResult) => page.nextCursor ?? undefined,
  };
}
