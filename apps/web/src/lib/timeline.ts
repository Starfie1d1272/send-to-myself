import { api, type ListParams, type ListResult } from "./api";

export type TimelineViewState = {
  view: "all" | "todo" | "favorites" | "trash";
  todoScope: "open" | "next7days" | "completed";
  contentType: "all" | "link" | "image" | "file";
  category: "all" | "idea" | "read_later";
  sensitiveOnly: boolean;
  query: string;
};
export const initialTimelineState: TimelineViewState = { view: "all", todoScope: "open", contentType: "all", category: "all", sensitiveOnly: false, query: "" };

export function timelineParams(state: TimelineViewState, now = new Date()): ListParams {
  const p: ListParams = { limit: 100 };
  if (state.query.trim()) p.q = state.query.trim();
  if (state.view === "trash") p.deleted = true;
  if (state.view === "favorites") p.pinned = true;
  if (state.view === "todo") {
    p.isTodo = true;
    p.completed = state.todoScope === "completed";
    if (state.todoScope === "next7days") { p.dueFrom = now.toISOString(); p.dueBefore = new Date(now.getTime() + 168 * 3600000).toISOString(); }
  }
  if (state.contentType === "link") p.hasLinks = true;
  if (state.contentType === "image") p.hasImages = true;
  if (state.contentType === "file") p.hasFiles = true;
  if (state.category !== "all") p.category = state.category;
  if (state.sensitiveOnly) p.sensitive = true;
  return p;
}
export function itemPages(params: ListParams) {
  return { queryKey: ["items", params], initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }: { pageParam: string | undefined }) => api.list({ ...params, cursor: pageParam }),
    getNextPageParam: (page: ListResult) => page.nextCursor ?? undefined };
}
