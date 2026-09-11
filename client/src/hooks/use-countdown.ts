import { useEffect, useState } from "react";

export type CountdownPhase = "loading" | "upcoming" | "live" | "done";

export interface Countdown {
  phase: CountdownPhase;
  label: string; // e.g. "Starts in 23d 19h 12m" / "On the air right now"
  days: number;
  hours: number;
  minutes: number;
}

/** Ticks every 30s. Shared by the schedule hero and the landing page. */
export function useCountdown(startAtUtc?: string, durationHours?: number): Countdown {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(id);
  }, []);
  if (!startAtUtc || !durationHours) return { phase: "loading", label: "", days: 0, hours: 0, minutes: 0 };

  const start = new Date(startAtUtc);
  const end = new Date(start.getTime() + durationHours * 3600000);

  if (now < start) {
    const diffMs = start.getTime() - now.getTime();
    const days = Math.floor(diffMs / 86400000);
    const hours = Math.floor((diffMs % 86400000) / 3600000);
    const minutes = Math.floor((diffMs % 3600000) / 60000);
    const parts = [];
    if (days > 0) parts.push(`${days}d`);
    parts.push(`${hours}h`, `${minutes}m`);
    return { phase: "upcoming", label: `Starts in ${parts.join(" ")}`, days, hours, minutes };
  }
  if (now >= start && now < end) {
    return { phase: "live", label: "On the air right now", days: 0, hours: 0, minutes: 0 };
  }
  return { phase: "done", label: "This marathon has wrapped", days: 0, hours: 0, minutes: 0 };
}
