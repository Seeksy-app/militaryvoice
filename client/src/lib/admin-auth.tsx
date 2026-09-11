import { createContext, useCallback, useContext, useMemo, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest, getQueryFn } from "@/lib/queryClient";

// Admin access is an httpOnly session cookie set by the one-time email code
// flow, so it survives a refresh and there's no shared password to circulate.
export interface AdminIdentity {
  email: string;
  name: string;
  isOwner: boolean;
}

interface AdminAuthValue {
  admin: AdminIdentity | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  requestCode: (email: string) => Promise<void>;
  verifyCode: (email: string, code: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AdminAuthContext = createContext<AdminAuthValue | null>(null);

export function AdminAuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery<AdminIdentity | null>({
    queryKey: ["/api/admin/me"],
    queryFn: getQueryFn({ on401: "returnNull" }),
    retry: false,
    staleTime: 60_000,
  });

  const requestCode = useCallback(async (email: string) => {
    await apiRequest("POST", "/api/admin/request-code", { email });
  }, []);

  const verifyCode = useCallback(
    async (email: string, code: string) => {
      await apiRequest("POST", "/api/admin/verify-code", { email, code });
      await queryClient.invalidateQueries({ queryKey: ["/api/admin/me"] });
    },
    [queryClient],
  );

  const logout = useCallback(async () => {
    await apiRequest("POST", "/api/admin/logout");
    queryClient.setQueryData(["/api/admin/me"], null);
    queryClient.removeQueries({ queryKey: ["/api/admin"] });
  }, [queryClient]);

  const value = useMemo(
    () => ({ admin: data ?? null, isAuthenticated: !!data, isLoading, requestCode, verifyCode, logout }),
    [data, isLoading, requestCode, verifyCode, logout],
  );

  return <AdminAuthContext.Provider value={value}>{children}</AdminAuthContext.Provider>;
}

export function useAdminAuth() {
  const ctx = useContext(AdminAuthContext);
  if (!ctx) throw new Error("useAdminAuth must be used within AdminAuthProvider");
  return ctx;
}
