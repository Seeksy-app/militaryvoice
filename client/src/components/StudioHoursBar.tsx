import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Clock, X } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";

/**
 * Studio hours (Andrew, 25 Nov 2026: Growth 2, Scale 4, Pro 10 a month). Counted while the Studio records or is live.
 * The Studio shows a quiet bar when 30 minutes or less are left and when they're used up; the plan page shows the line.
 * A show that's running is never stopped: only a new Record or Go live waits.
 */
export type StudioHours = {
  plan: string;
  capMin: number | null;
  usedMin: number;
  leftMin: number | null;
  near: boolean;
  over: boolean;
  resetsAt: string;
  upgradeTo: { name: string; hours: number } | null;
};

export const STUDIO_HOURS_KEY = ["/api/host/studio-hours"];
export function useStudioHours(enabled = true) {
  return useQuery<StudioHours>({
    queryKey: STUDIO_HOURS_KEY,
    queryFn: async () => (await apiRequest("GET", "/api/host/studio-hours")).json(),
    enabled,
    refetchInterval: 60_000,
  });
}

/** "1 h 42 min", "18 min", "2 h". */
export function hm(min: number): string {
  const h = Math.floor(min / 60);
  const m = Math.max(0, Math.round(min - h * 60));
  if (!h) return `${m} min`;
  return m ? `${h} h ${m} min` : `${h} h`;
}
export const hoursWord = (n: number) => `${n} Studio hour${n === 1 ? "" : "s"}`;
export const resetDay = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: "UTC" });
const PLANS_URL = "/host/dashboard/billing";

/** The Studio's notice. `busy`: recording or live right now. Never mount on a filmed page. */
export function StudioHoursBar({ busy }: { busy: boolean }) {
  const { data: h } = useStudioHours();
  const [hidden, setHidden] = useState<"" | "near" | "over">("");
  if (!h || h.capMin === null || !(h.near || h.over)) return null;
  const state = h.over ? "over" : "near";
  if (hidden === state) return null;
  const cap = Math.round(h.capMin / 60);
  const line = !h.over
    ? <><span className="font-semibold text-[#101828]">{hm(h.leftMin ?? 0)} of Studio time left this month.</span> {busy ? "Your show keeps going." : `They come back on ${resetDay(h.resetsAt)}.`}</>
    : busy
      ? <><span className="font-semibold text-[#101828]">You've used this month's {hoursWord(cap)}.</span> Your show keeps going. To record or go live again, {h.upgradeTo ? "upgrade or " : ""}wait for {resetDay(h.resetsAt)}.</>
      : <><span className="font-semibold text-[#101828]">You've used this month's {hoursWord(cap)} on {h.plan}.</span> {h.upgradeTo ? `Upgrade to ${h.upgradeTo.name} for ${hoursWord(h.upgradeTo.hours)} a month, or they come back on ${resetDay(h.resetsAt)}.` : `They come back on ${resetDay(h.resetsAt)}.`}</>;
  return (
    <div role="status" className={`fixed bottom-4 left-1/2 z-[79] flex w-max max-w-[calc(100vw-32px)] -translate-x-1/2 items-center gap-3 rounded-xl border bg-white py-2 pl-3 pr-2 text-[13px] text-[#344054] shadow-[0_8px_24px_rgba(16,24,40,0.14)] ${h.over ? "border-[#fda29b]" : "border-[#fedf89]"}`} data-testid="studio-hours-bar">
      <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${h.over ? "bg-[#fef3f2] text-[#d92d20]" : "bg-[#fffaeb] text-[#b54708]"}`} aria-hidden><Clock className="h-4 w-4" /></span>
      <span className="min-w-0">{line}</span>
      {h.upgradeTo && (
        <a href={PLANS_URL} target="_blank" rel="noreferrer" className="flex h-8 shrink-0 items-center rounded-lg bg-[#053877] px-3 text-[12px] font-bold text-white hover:bg-[#0a4a99]" data-testid="studio-hours-upgrade">
          {h.over ? "Upgrade" : "See plans"}
        </a>
      )}
      <button type="button" onClick={() => setHidden(state)} aria-label="Not now" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[#667085] hover:bg-[#f2f4f7]"><X className="h-4 w-4" /></button>
    </div>
  );
}
