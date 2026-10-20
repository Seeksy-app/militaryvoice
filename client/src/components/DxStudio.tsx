import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Destinations } from "@/components/Destinations";
import { Bot, ExternalLink, Loader2, Radio, Users } from "lucide-react";

// Admin → Studio for a Live From Anywhere day: not the Marathon's console (no
// scenes, no desk, no standby cards). The AI producer runs the day by the
// clock (server/dxBroadcast.ts, client/src/pages/Program.tsx); this is where
// you watch it, step in, and set where it streams.

type Day = {
  eventId: number; name: string; startAtUtc: string; endAtUtc: string; onAir: boolean;
  air: { started?: string; done?: string; error?: string }; destinationsEventId: number; streams: string[];
  bookings: { id: number; show: string; host: string; email: string; photo: string; startAtUtc: string; endAtUtc: string; inBooth: number }[];
};

const ET = "America/New_York";
const hm = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { timeZone: ET, hour: "numeric", minute: "2-digit" });

export function DxStudio({ eventId, adminGet, adminSend }: { eventId: number; adminGet: <T>(path: string) => Promise<T>; adminSend: (method: string, path: string, body?: unknown) => Promise<unknown> }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const { data: d } = useQuery<Day>({ queryKey: ["/api/admin/dx", eventId], queryFn: () => adminGet<Day>(`/api/admin/dx/${eventId}`), refetchInterval: 10_000 });
  // The destinations panel is shared with the Marathon's console: point it at the week's list.
  useEffect(() => { void qc.invalidateQueries({ queryKey: ["/api/admin/destinations"] }); }, [qc, d?.destinationsEventId]);
  if (!d) return <div className="flex justify-center p-10"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;

  const destEvent = d.destinationsEventId;
  const scoped = (p: string) => /^\/api\/admin\/(destinations|studio\/youtube)/.test(p);
  const get = <T,>(p: string) => adminGet<T>(scoped(p) ? `${p}${p.includes("?") ? "&" : "?"}eventId=${destEvent}` : p);
  const send = (m: string, p: string, body?: unknown) => adminSend(m, p, scoped(p) ? { ...(body as object ?? {}), eventId: destEvent } : body) as Promise<Response>;

  const air = async (action: "start" | "stop") => {
    if (action === "stop" && !window.confirm("Take this day off air? The stream and the recording stop.")) return;
    setBusy(true);
    try {
      const r = (await adminSend("POST", `/api/admin/dx/${eventId}/air`, { action })) as { did?: string };
      toast({ title: action === "start" ? "On air" : "Off air", description: r?.did });
      await qc.invalidateQueries({ queryKey: ["/api/admin/dx", eventId] });
    } catch (e) {
      toast({ title: "Couldn't do that", description: (e as Error).message, variant: "destructive" });
    } finally { setBusy(false); }
  };

  const now = Date.now();
  const current = d.bookings.find((b) => now >= Date.parse(b.startAtUtc) && now < Date.parse(b.endAtUtc));
  return (
    <div className="space-y-5" data-testid="dx-studio">
      <div className={`flex flex-wrap items-center justify-between gap-3 rounded-2xl p-4 ${d.onAir ? "bg-[#ED1C24] text-white" : "border border-border bg-card"}`}>
        <div>
          <p className="flex items-center gap-2 text-lg font-bold">{d.onAir ? <><Radio className="h-5 w-5 animate-pulse" /> On air</> : "Off air"}</p>
          <p className={`text-sm ${d.onAir ? "text-white/85" : "text-muted-foreground"}`}>
            <Bot className="mr-1 inline h-4 w-4" />The AI producer runs this day: on air automatically {hm(d.startAtUtc)}–{hm(d.endAtUtc)} ET, bringing each show on and off by the clock.
          </p>
          {d.air.error && <p className="mt-1 text-xs font-semibold">{d.air.error}</p>}
        </div>
        {d.onAir
          ? <Button variant="outline" className="border-white/40 bg-transparent text-white hover:bg-white/10 hover:text-white" disabled={busy} onClick={() => void air("stop")}>Take off air</Button>
          : <Button className="bg-[#ED1C24] text-white hover:bg-[#c8151c]" disabled={busy} onClick={() => void air("start")} title="Starts the stream and recording now (a rehearsal, or a restart)">Go on air now</Button>}
      </div>

      <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
        <div>
          <p className="mb-2 text-sm font-semibold">What's going out</p>
          <div className="relative aspect-video overflow-hidden rounded-xl border border-border bg-black">
            {/* The program page at 1920 wide, scaled into the box. */}
            <iframe title="Program" src={`/dx/program?eventId=${eventId}`} className="absolute left-0 top-0 origin-top-left border-0" style={{ width: 1920, height: 1080, transform: "scale(var(--s))" }}
              ref={(el) => { if (el?.parentElement) el.style.setProperty("--s", String(el.parentElement.clientWidth / 1920)); }} />
          </div>
          <p className="mt-1 text-xs text-muted-foreground">The cards and timing, live. Podcasters' cameras appear on the real stream once they're in their booth.</p>
        </div>
        <div>
          <p className="mb-2 text-sm font-semibold">Streams to</p>
          <p className="mb-2 text-xs text-muted-foreground">{d.streams.length ? d.streams.join(" · ") : "Nowhere yet: add LiveOne and YouTube below."} Set once for the whole week.</p>
          <Destinations adminGet={get} adminSend={send} broadcasting={d.onAir} signups={[]} />
        </div>
      </div>

      <div>
        <p className="mb-2 flex items-center gap-2 text-sm font-semibold"><Users className="h-4 w-4" /> Lineup · {d.bookings.length} {d.bookings.length === 1 ? "show" : "shows"}</p>
        {d.bookings.length === 0 ? <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">No one has booked this day yet.</p> : (
          <ul className="divide-y divide-border rounded-xl border border-border">
            {d.bookings.map((b) => (
              <li key={b.id} className={`flex flex-wrap items-center gap-3 p-3 ${current?.id === b.id ? "bg-[#ED1C24]/5" : ""}`}>
                <span className="w-32 shrink-0 text-sm font-semibold tabular-nums">{hm(b.startAtUtc)}–{hm(b.endAtUtc)}</span>
                {b.photo ? <img src={b.photo} alt="" className="h-9 w-9 rounded-full object-cover" /> : <span className="h-9 w-9 rounded-full bg-muted" />}
                <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{b.show}</span><span className="block truncate text-xs text-muted-foreground">{b.host} · {b.email}</span></span>
                <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${b.inBooth ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400" : "bg-muted text-muted-foreground"}`}>{b.inBooth ? `${b.inBooth} in booth` : "Not in booth"}</span>
                {current?.id === b.id && <span className="rounded-full bg-[#ED1C24] px-2.5 py-1 text-xs font-bold text-white">Now</span>}
                <a href={`/booth/${b.id}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline">Open booth <ExternalLink className="h-3 w-3" /></a>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
