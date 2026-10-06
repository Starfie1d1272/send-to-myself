import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { clearDraft } from "../lib/draft";
import { api } from "../lib/api";

export function useAuth() {
  return useQuery({
    queryKey: ["auth", "me"],
    queryFn: () => api.me(),
    staleTime: 30_000,
    retry: false,
  });
}

export function useAuthActions() {
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: ["auth", "me"] });
  return {
    login: useMutation({ mutationFn: (pw: string) => api.login(pw), onSuccess: refresh }),
    logout: useMutation({
      mutationFn: () => api.logout(),
      onSuccess: async () => {
        await clearDraft().catch(() => {});
        qc.clear();
        void refresh();
      },
    }),
  };
}
