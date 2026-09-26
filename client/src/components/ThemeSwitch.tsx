import { Moon, Sun, Monitor } from "lucide-react";
import { useTheme, type ThemeMode } from "@/lib/theme";

/** Sun, moon, auto: three small buttons, for the dark dashboard frame. */
export function ThemeSwitch({ className = "" }: { className?: string }) {
  const { mode, setMode } = useTheme();
  const opts: { m: ThemeMode; icon: typeof Sun; label: string }[] = [
    { m: "light", icon: Sun, label: "Light" },
    { m: "dark", icon: Moon, label: "Dark" },
    { m: "auto", icon: Monitor, label: "Auto (follow this device)" },
  ];
  return (
    <div className={`inline-flex items-center gap-0.5 rounded-full border border-white/15 bg-white/[0.06] p-0.5 ${className}`} role="group" aria-label="Theme" data-testid="theme-switch">
      {opts.map(({ m, icon: Icon, label }) => (
        <button
          key={m}
          type="button"
          onClick={() => setMode(m)}
          aria-pressed={mode === m}
          title={label}
          aria-label={label}
          className={`flex h-6 w-6 items-center justify-center rounded-full transition-colors ${mode === m ? "bg-white text-[#04102b]" : "text-white/60 hover:text-white"}`}
          data-testid={`theme-${m}`}
        >
          <Icon className="h-3.5 w-3.5" />
        </button>
      ))}
    </div>
  );
}
