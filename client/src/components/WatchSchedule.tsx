import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest, resolveUploadUrl } from "@/lib/queryClient";
import { AgendaSignupActions } from "@/components/AgendaSignupActions";
import { slotStart, onAirWindow, formatTimeInZone, detectLocalTimeZone } from "@/lib/schedule";
import type { PublicEvent, PublicSignup } from "@shared/schema";
import { Radio } from "lucide-react";

// The running order, under the player, read like a TV guide.
//
// Someone who lands on the watch page before their show is on has two
// questions — when is it, and how do I not miss it — and until now the page
// answered neither. So each row is one line: the time, who's on, and a bell.
//
// Times are in the viewer's own zone, not ours. A guide that prints Eastern to
// someone in Okinawa is a guide they have to do arithmetic on.

interface Row {
  signup: PublicSignup;
  start: Date;
  end: Date;
}

export function WatchSchedule({ slug }: { slug?: string }) {
  const zone = useMemo(detectLocalTimeZone, []);

  const { data: event } = useQuery<PublicEvent>({
    queryKey: ["/api/event", slug ?? "featured"],
    queryFn: async () => (await apiRequest("GET", `/api/event${slug ? `?slug=${slug}` : ""}`)).json(),
  });

  const { data: signups } = useQuery<PublicSignup[]>({
    queryKey: ["/api/signups", event?.id ?? "none"],
    queryFn: async () => (await apiRequest("GET", `/api/signups?eventId=${event!.id}`)).json(),
    enabled: !!event,
  });

  // The "on now" marker has to move on its own — nobody reloads a page they
  // are watching. A minute is close enough for a half-hour slot.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);

  const rows: Row[] = useMemo(() => {
    if (!event || !signups) return [];
    return signups
      .filter((s) => s.status !== "cancelled")
      .sort((a, b) => a.slotIndex - b.slotIndex)
      .map((s) => {
        const air = onAirWindow(slotStart(event.startAtUtc, event.slotMinutes, s.slotIndex), {
          onAirMinutes: event.onAirMinutes,
          bufferMinutes: event.bufferMinutes,
          bufferPosition: event.bufferPosition,
        });
        return { signup: s, start: air.start, end: air.end };
      });
  }, [event, signups]);

  if (rows.length === 0) return null;

  const onNow = rows.find((r) => now >= r.start.getTime() && now < r.end.getTime());
  const nextUp = rows.find((r) => r.start.getTime() > now);

  // Slots run through the night, so the guide is broken by day — otherwise
  // "2:00 AM" sits under "11:30 PM" with nothing saying the date turned over.
  const days: { label: string; rows: Row[] }[] = [];
  for (const r of rows) {
    const label = new Intl.DateTimeFormat(undefined, { weekday: "long", month: "long", day: "numeric", timeZone: zone }).format(r.start);
    const last = days[days.length - 1];
    if (last?.label === label) last.rows.push(r);
    else days.push({ label, rows: [r] });
  }

  return (
    <section className="mt-10" data-testid="section-watch-schedule">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-white/80">The running order</h2>
        <p className="text-xs text-white/40">All times in your own time zone · {rows.length} shows</p>
      </div>

      <div className="mt-4 overflow-hidden rounded-2xl border border-white/12 bg-white/[0.03]">
        {days.map((day) => (
          <div key={day.label}>
            <div className="border-b border-white/10 bg-white/[0.04] px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-white/45">
              {day.label}
            </div>
            <ul>
              {day.rows.map((r) => {
                const isNow = onNow?.signup.id === r.signup.id;
                const isNext = !onNow && nextUp?.signup.id === r.signup.id;
                const done = r.end.getTime() <= now;
                return (
                  <li
                    key={r.signup.id}
                    className={`flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-white/[0.07] px-4 py-3 last:border-0 ${
                      isNow ? "bg-[#F0A71F]/[0.12]" : done ? "opacity-45" : ""
                    }`}
                    data-testid={`guide-row-${r.signup.slotIndex}`}
                  >
                    {/* One fixed column for the time so the whole guide reads
                        down the left edge the way a listing should. */}
                    <span className="w-[4.75rem] shrink-0 text-sm font-semibold tabular-nums text-white/85">
                      {formatTimeInZone(r.start, zone)}
                    </span>

                    {r.signup.photoUrl ? (
                      <img
                        src={resolveUploadUrl(r.signup.photoUrl)}
                        alt=""
                        loading="lazy"
                        className="h-9 w-9 shrink-0 rounded-full object-cover ring-1 ring-white/20"
                      />
                    ) : (
                      <span className="h-9 w-9 shrink-0 rounded-full bg-white/10" />
                    )}

                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[15px] font-medium text-white">{r.signup.podcastName}</span>
                      <span className="block truncate text-xs text-white/45">{r.signup.hostName}</span>
                    </span>

                    {isNow && (
                      <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-[#ED1C24] px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-white">
                        <Radio className="h-3 w-3" /> On now
                      </span>
                    )}
                    {isNext && (
                      <span className="shrink-0 rounded-full bg-white/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-white/70">
                        Up next
                      </span>
                    )}

                    {/* Nothing to remind anyone about once a slot has run. */}
                    {!done && (
                      <span className="shrink-0">
                        <AgendaSignupActions
                          signup={r.signup}
                          shareText={`${r.signup.podcastName} is on at ${formatTimeInZone(r.start, zone)} during the Podcast Marathon — watch free at militaryvoices.ai/watch`}
                        />
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}
