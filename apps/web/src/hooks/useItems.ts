import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CreateItemInput, UpdateItemInput } from "@sendtomyself/shared";
import { api, type ListParams } from "../lib/api";

export function useItems(params: ListParams) {
  return useQuery({
    queryKey: ["items", params],
    queryFn: () => api.list(params),
  });
}

export function useItemMutations() {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ["items"] });
  return {
    create: useMutation({ mutationFn: (i: CreateItemInput) => api.create(i), onSuccess: invalidate }),
    upload: useMutation({
      mutationFn: (v: { content: string; files: File[] }) => api.upload(v.content, v.files),
      onSuccess: invalidate,
    }),
    update: useMutation({
      mutationFn: (v: { id: string; patch: UpdateItemInput }) => api.update(v.id, v.patch),
      onSuccess: invalidate,
    }),
    remove: useMutation({ mutationFn: (id: string) => api.remove(id), onSuccess: invalidate }),
    restore: useMutation({ mutationFn: (id: string) => api.restore(id), onSuccess: invalidate }),
    refetchPreview: useMutation({
      mutationFn: (id: string) => api.refetchPreview(id),
      onSuccess: invalidate,
    }),
  };
}
