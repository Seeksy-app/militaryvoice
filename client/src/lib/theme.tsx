import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

/** Light, dark, or follow the device (auto). Remembered on this device. */
export type ThemeMode = "light" | "dark" | "auto";

interface ThemeValue {
  theme: "light" | "dark";
  mode: ThemeMode;
  setMode: (m: ThemeMode) => void;
  toggle: () => void;
}

const ThemeContext = createContext<ThemeValue | null>(null);
const KEY = "mv_theme";

const systemDark = () => typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches;

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>(() => {
    try { const v = localStorage.getItem(KEY); return v === "light" || v === "dark" ? v : "auto"; } catch { return "auto"; }
  });
  const [sysDark, setSysDark] = useState(systemDark);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const on = () => setSysDark(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  const theme: "light" | "dark" = mode === "auto" ? (sysDark ? "dark" : "light") : mode;

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
  }, [theme]);

  const value = useMemo(() => {
    const setMode = (m: ThemeMode) => {
      setModeState(m);
      try { localStorage.setItem(KEY, m); } catch { /* private window */ }
    };
    return { theme, mode, setMode, toggle: () => setMode(theme === "dark" ? "light" : "dark") };
  }, [theme, mode]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}
