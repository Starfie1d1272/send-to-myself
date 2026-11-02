import { useMutation, useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import type { CreateItemInput, UpdateItemInput } from "@sendtomyself/shared";
import { api, type ListParams, type UploadOptions } from "../lib/api";
import { useAuthAccess } from "./useAuth";
import { ApiError } from "../lib/api";
import { itemPages } from "../lib/timeline";

export function useItems(params: ListParams) {
  const access = useAuthAccess();
  const qc = useQueryClient();
  const pages = itemPages(params);
  return useInfiniteQuery({ ...pages, queryFn: async context => {
    try { return await pages.queryFn(context); }
    catch (error) { if (error instanceof ApiError && error.status === 401) void qc.invalidateQueries({ queryKey: ["auth", "me"] }); throw error; }
  }, placeholderData: (previous) => previous, enabled: access.authenticated && !access.reauthRequired && !access.exiting });
}

export function useItemMutations() {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ["items"] });
  const onError = (err: Error) => { if (err instanceof ApiError && err.status === 401) void qc.invalidateQueries({ queryKey: ["auth", "me"] }); if (err instanceof ApiError && ((err.status === 409 && (err.code === "purge_in_progress" || err.code === "not_in_trash")) || (err.status === 503 && err.code === "cleanup_failed"))) void invalidate(); };
  return {
    create: useMutation({ networkMode: "always", mutationFn: (i: CreateItemInput) => api.create(i), onError, onSuccess: invalidate }),
    upload: useMutation({
      networkMode: "always",
      mutationFn: (v: { content: string; files: File[]; dedupeKey?: string; options?: UploadOptions }) => api.upload(v.content, v.files, v.dedupeKey, v.options),
      onError, onSuccess: invalidate,
    }),
    update: useMutation({
      networkMode: "always",
      mutationFn: (v: { id: string; patch: UpdateItemInput }) => api.update(v.id, v.patch),
      onError, onSuccess: invalidate,
    }),
    remove: useMutation({ networkMode: "always", mutationFn: (id: string) => api.remove(id), onError, onSuccess: invalidate }),
    permanent: useMutation({ networkMode: "always", mutationFn: (id: string) => api.permanentlyRemove(id), onError, onSuccess: invalidate }),
    restore: useMutation({ networkMode: "always", mutationFn: (id: string) => api.restore(id), onError, onSuccess: invalidate }),
    refetchPreview: useMutation({
      networkMode: "always",
      mutationFn: (id: string) => api.refetchPreview(id),
      onError, onSuccess: invalidate,
    }),
  };
}
