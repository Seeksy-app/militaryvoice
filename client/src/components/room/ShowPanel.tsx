import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, Search } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { BriefCard, useBriefAllowance } from "@/components/GuestBrief";
import { useCurrentStudioName } from "@/components/room/Setups";

/**
 * Show (Andrew, 26 Nov: "a dashboard at the top, above the banners… the studio name, the show name, and the upcoming
 * guest"): the studio's first panel, open when it loads. Compact (Andrew's minimalist rule): the studio and its show,
 * then the next guest from Invite a guest, with their brief when one exists. Host only; nothing here is on air.
 */
type NextGuest = { id: number; guestName: string; whenText: string; whenIso: string; briefId: number | null } | null;

const label = "text-[11px] font-semibold uppercase tracking-wide text-[#667085]";

function initials(name: string): string {
  const w = name.trim().split(/\s+/).filter(Boolean);
  return ((w[0]?.[0] ?? "") + (w.length > 1 ? w[w.length - 1][0] : "")).toUpperCase() || "?";
}

/** "Today · 2:00 PM EST", "Tomorrow · …", else "Tue, Dec 1 · …", in the host's own time zone. */
function when(iso: string, text: string): [string, string] {
  const t = Date.parse(iso);
  if (!t) return [text, ""];
  const d = new Date(t);
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(d) - day(new Date())) / 86_400_000);
  const date = diff === 0 ? "Today" : diff === 1 ? "Tomorrow" : d.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
  return [date, d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", timeZoneName: "short" })];
}

export function ShowPanel({ showTitle }: { showTitle: string }) {
  // The Studio line is the saved studio they're in, as named on the Studio page; never the room's own stored name,
  // which nobody can rename (it read "Veteran Benefits Podcast" under a studio renamed "Next Mile Podcast", 27 Nov).
  const studioName = useCurrentStudioName();
  const qc = useQueryClient();
  const next = useQuery<NextGuest>({ queryKey: ["/api/host/guest-invites/next"], staleTime: 60_000, queryFn: async () => (await apiRequest("GET", "/api/host/guest-invites/next")).json() });
  const allowance = useBriefAllowance();
  const [brief, setBrief] = useState(false);
  const g = next.data;
  const hasBrief = !!g?.briefId && allowance.data?.on === true;
  // One name when the studio is named after its show.
  const same = !studioName || !showTitle || studioName.trim().toLowerCase() === showTitle.trim().toLowerCase();
  return (
    <div className="flex flex-col gap-3 p-4" data-testid="show-panel">
      <div className="rounded-xl border border-[#e4e7ec] px-3.5 py-3">
        {!same && <><div className={label}>Studio</div><div className="text-[15px] font-bold text-[#101828]">{studioName}</div></>}
        <div className={`${same ? "" : "mt-2 "}${label}`}>Show</div>
        <div className="text-[15px] font-bold text-[#101828]" data-testid="show-panel-show">{same ? showTitle || studioName : showTitle}</div>
      </div>
      <div className="rounded-xl border border-[#e4e7ec] px-3.5 py-3">
        <div className={label}>Next guest</div>
        {next.isLoading ? (
          <div className="mt-1 h-10" />
        ) : !g ? (
          <div className="mt-1 flex flex-wrap items-center justify-between gap-x-2 gap-y-1 text-sm text-[#475467]" data-testid="show-panel-no-guest">No guest booked yet.
            <a href="/host/dashboard/podcast?tab=invite" className="font-bold text-[#053877] hover:underline">Invite a guest</a>
          </div>
        ) : (
          // The time is one unbroken line under the name (PM, 26 Nov: never break at the "·"); when the row is too
          // narrow for it and the button, the button drops to the next line instead.
          <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-2" data-testid="show-panel-guest">
            <div className="flex max-w-full items-center gap-2.5">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#eef3fb] text-sm font-bold text-[#053877]" aria-hidden>{initials(g.guestName)}</span>
              <div className="min-w-0">
                <div className="truncate text-[15px] font-bold text-[#101828]">{g.guestName}</div>
                <div className="flex items-center gap-1 whitespace-nowrap text-[13px] text-[#475467]"><CalendarClock className="h-3.5 w-3.5 shrink-0" />{(() => { const [d, t] = when(g.whenIso, g.whenText); return t ? `${d} · ${t}` : d; })()}</div>
              </div>
            </div>
            {hasBrief && (
              <button type="button" onClick={() => setBrief(!brief)} aria-expanded={brief} className="ml-auto flex shrink-0 items-center gap-1 rounded-lg border border-[#d0d5dd] px-2 py-1.5 text-[13px] font-bold text-[#053877] hover:bg-[#f9fafb]" data-testid="show-panel-brief">
                <Search className="h-3.5 w-3.5" />{brief ? "Hide brief" : "Guest brief"}
              </button>
            )}
          </div>
        )}
      </div>
      {hasBrief && brief && g?.briefId && <BriefCard id={g.briefId} onGone={() => { setBrief(false); void qc.invalidateQueries({ queryKey: ["/api/host/guest-invites/next"] }); }} />}
    </div>
  );
}
