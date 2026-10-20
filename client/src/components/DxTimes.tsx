import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CalendarPlus, Radio, Share2 } from "lucide-react";
import { DxShare } from "@/components/DxShare";
import { apiRequest } from "@/lib/queryClient";

// The Digital Experience on someone's own dashboard: the times they booked,
// with the calendar buttons, so a booking made on /digital-experience is in
// their account too. Nothing shows when they have none.

export type DxCal = { google: string; outlook: string; ics: string };
type Booking = { id: number; startAtUtc: string; endAtUtc: string; show: string; host: string; photo: string; calendar: DxCal };

const ET = "America/New_York";
const time = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { timeZone: ET, hour: "numeric", minute: "2-digit" });
const day = (iso: string) => new Date(iso).toLocaleDateString("en-US", { timeZone: ET, weekday: "long", month: "short", day: "numeric" });

export function CalendarButtons({ cal }: { cal: DxCal }) {
  const b = "inline-flex h-9 items-center gap-1.5 rounded-full border border-border bg-background px-3.5 text-sm font-semibold hover:bg-muted";
  return (
    <div className="flex flex-wrap gap-2">
      <a className={b} href={cal.google} target="_blank" rel="noreferrer"><CalendarPlus className="h-4 w-4" /> Google</a>
      <a className={b} href={cal.outlook} target="_blank" rel="noreferrer"><CalendarPlus className="h-4 w-4" /> Outlook</a>
      <a className={b} href={cal.ics}><CalendarPlus className="h-4 w-4" /> Apple / other</a>
    </div>
  );
}

/** Their booth for that booking: opens an hour before (the page says so until then). */
export function BoothButton({ id }: { id: number }) {
  return <a href={`/booth/${id}`} className="inline-flex h-9 items-center gap-1.5 rounded-full bg-[#053877] px-3.5 text-sm font-semibold text-white hover:bg-[#0a4a99]" data-testid={`dx-booth-${id}`}><Radio className="h-4 w-4" /> Your booth</a>;
}

export function DxTimes() {
  const [sharing, setSharing] = useState<number | null>(null);
  const { data } = useQuery<{ bookings: Booking[] }>({ queryKey: ["/api/dx/mine"], queryFn: async () => (await apiRequest("GET", "/api/dx/mine")).json(), retry: false });
  if (!data?.bookings.length) return null;
  return (
    <div className="mt-6 rounded-2xl border border-[#F0A71F]/60 bg-[#fff7e6] p-4 dark:bg-[#F0A71F]/10" data-testid="dashboard-dx-times">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-sm font-bold"><Radio className="h-4 w-4 text-[#b36b00]" /> Digital Experience: your times</p>
        <a href="/digital-experience" className="text-xs font-semibold text-[#053877] underline dark:text-[#F0A71F]">See the schedule</a>
      </div>
      <ul className="mt-3 space-y-3">
        {data.bookings.map((b) => (
          <li key={b.id} className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm"><span className="font-semibold">{day(b.startAtUtc)}</span>, {time(b.startAtUtc)}–{time(b.endAtUtc)} ET · {b.show}</span>
            <span className="flex flex-wrap gap-2"><BoothButton id={b.id} /><button type="button" onClick={() => setSharing(sharing === b.id ? null : b.id)} className="inline-flex h-9 items-center gap-1.5 rounded-full border border-border bg-background px-3.5 text-sm font-semibold hover:bg-muted"><Share2 className="h-4 w-4" /> Share</button><CalendarButtons cal={b.calendar} /></span>
            {sharing === b.id && <div className="w-full rounded-xl bg-background p-3"><DxShare b={b} /></div>}
          </li>
        ))}
      </ul>
    </div>
  );
}
