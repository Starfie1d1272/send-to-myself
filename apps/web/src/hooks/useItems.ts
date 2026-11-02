import { useMutation, useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import type { CreateItemInput, UpdateItemInput } from "@sendtomyself/shared";
import { api, type ListParams } from "../lib/api";
import { useAuthAccess } from "./useAuth";
import { ApiError } from "../lib/api";
import { itemPages } from "../lib/timeline";

export function useItems(params: ListParams) {
  const access = useAuthAccess();
  return useInfiniteQuery({ ...itemPages(params), enabled: access.authenticated && !access.reauthRequired && !access.exiting });
}

export function useItemMutations() {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ["items"] });
  const onError = (err: Error) => { if (err instanceof ApiError && err.status === 401) void qc.invalidateQueries({ queryKey: ["auth", "me"] }); };
  return {
    create: useMutation({ mutationFn: (i: CreateItemInput) => api.create(i), onError, onSuccess: invalidate }),
    upload: useMutation({
      mutationFn: (v: { content: string; files: File[]; dedupeKey?: string }) => api.upload(v.content, v.files, v.dedupeKey),
      onError, onSuccess: invalidate,
    }),
    update: useMutation({
      mutationFn: (v: { id: string; patch: UpdateItemInput }) => api.update(v.id, v.patch),
      onError, onSuccess: invalidate,
    }),
    remove: useMutation({ mutationFn: (id: string) => api.remove(id), onError, onSuccess: invalidate }),
    restore: useMutation({ mutationFn: (id: string) => api.restore(id), onError, onSuccess: invalidate }),
    refetchPreview: useMutation({
      mutationFn: (id: string) => api.refetchPreview(id),
      onError, onSuccess: invalidate,
    }),
  };
}
