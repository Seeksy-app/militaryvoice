import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { apiRequest } from "@/lib/queryClient";

// Password lives in memory only (no localStorage/cookies — sandboxed iframes
// block both). Re-entering it after a hard refresh is an acceptable tradeoff
// for a basic MVP admin dashboard.
interface AdminAuthValue {
  password: string | null;
  isAuthenticated: boolean;
  login: (password: string) => Promise<void>;
  logout: () => void;
}

const AdminAuthContext = createContext<AdminAuthValue | null>(null);

export function AdminAuthProvider({ children }: { children: ReactNode }) {
  const [password, setPassword] = useState<string | null>(null);

  const login = useCallback(async (candidate: string) => {
    await apiRequest("POST", "/api/admin/login", { password: candidate });
    setPassword(candidate);
  }, []);

  const logout = useCallback(() => setPassword(null), []);

  const value = useMemo(
    () => ({ password, isAuthenticated: !!password, login, logout }),
    [password, login, logout]
  );

  return <AdminAuthContext.Provider value={value}>{children}</AdminAuthContext.Provider>;
}

export function useAdminAuth() {
  const ctx = useContext(AdminAuthContext);
  if (!ctx) throw new Error("useAdminAuth must be used within AdminAuthProvider");
  return ctx;
}
