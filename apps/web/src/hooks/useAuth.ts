import { createContext, useContext } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";

export function useAuth() {
  return useQuery({ queryKey: ["auth", "me"], queryFn: api.me, staleTime: 30_000, retry: false });
}
export interface AuthAccess {
  authenticated: boolean;
  reauthRequired: boolean;
  exiting: boolean;
  logout: () => void;
  logoutPending: boolean;
  logoutError: string;
}
export const AuthAccessContext = createContext<AuthAccess | null>(null);
export function useAuthAccess(): AuthAccess {
  const access = useContext(AuthAccessContext);
  if (!access) throw new Error("AuthGate missing");
  return access;
}
