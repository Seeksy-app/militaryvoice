import { ArrowLeft, CalendarDays, Clock, Mic2, PlayCircle, Radio, Handshake, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { resolveUploadUrl } from "@/lib/queryClient";
import { formatDateInZone, formatTimeInZone } from "@/lib/schedule";
import { StudioIcon } from "@/components/GreenRoomButton";

const ET = "America/New_York";

export interface CohostShow {
  signupId: number;
  slotIndex: number;
  podcastName: string;
  hostName: string;
  photoUrl: string;
  showFormat: string;
  onAirStartUtc: string;
  onAirEndUtc: string;
  line: string;
  sponsor: { name: string; readLine: string } | null;
}
export interface CohostInfo {
  isCohost: boolean;
  name?: string;
  event?: { id: number; name: string; startAtUtc: string; slotMinutes: number; durationHours: number; slug: string };
  hours?: { blockIndex: number; startAtUtc: string; endAtUtc: string; shows: CohostShow[] }[];
  shared?: CohostShow[];
  studioId?: number | null;
}

/**
 * The co-host's dashboard: the hours they hold at the desk, the shows inside
 * each, the line to bring each one on with and the sponsor to thank, and the
 * green room door. In those hours they are the host; this is what a host
 * needs in front of them and nothing else.
 */
export function CohostDashboard({ info, onBack }: { info: CohostInfo; onBack?: () => void }) {
  const ev = info.event!;
  const hours = info.hours ?? [];
  const shared = info.shared ?? [];
  const start = new Date(ev.startAtUtc);
  const daysToGo = Math.max(0, Math.ceil((start.getTime() - Date.now()) / 86_400_000));
  const greenRoom = info.studioId ? `/studio?studioId=${info.studioId}` : "/studio";
  const first = (info.name || "").trim().split(/\s+/)[0] || "there";
  const range = hours.length ? `${formatTimeInZone(new Date(hours[0].startAtUtc), ET)} to ${formatTimeInZone(new Date(hours[hours.length - 1].endAtUtc), ET)} ET` : "";
  const showCount = hours.reduce((n, h) => n + h.shows.length, 0);

  const Show = ({ s }: { s: CohostShow }) => (
    <div className="flex gap-3 rounded-xl border border-border bg-background p-3" data-testid={`cohost-show-${s.signupId}`}>
      {s.photoUrl ? <img src={resolveUploadUrl(s.photoUrl)} alt="" className="h-14 w-14 shrink-0 rounded-full object-cover ring-2 ring-[#F0A71F]/40" /> : <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-muted"><Mic2 className="h-5 w-5" /></div>}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className="text-sm font-bold tabular-nums">{formatTimeInZone(new Date(s.onAirStartUtc), ET)}–{formatTimeInZone(new Date(s.onAirEndUtc), ET)}</span>
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${s.showFormat === "prerecorded" ? "bg-muted text-muted-foreground" : "bg-[#ED1C24]/10 text-[#ED1C24]"}`}>{s.showFormat === "prerecorded" ? "Recorded" : "Live"}</span>
        </div>
        <p className="truncate text-sm font-semibold">{s.podcastName.trim() || s.hostName}</p>
        <p className="truncate text-xs text-muted-foreground">with {s.hostName}</p>
        {s.line && (
          <p className="mt-2 rounded-lg bg-[#F0A71F]/10 px-3 py-2 text-sm leading-relaxed text-[#6b4600]"><span className="mr-1 text-[10px] font-bold uppercase tracking-wide">Say</span>{s.line}</p>
        )}
        {s.sponsor && (
          <p className="mt-2 flex items-start gap-1.5 text-xs text-muted-foreground"><Handshake className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#053877]" /><span><span className="font-semibold text-foreground">Sponsor: {s.sponsor.name}.</span> {s.sponsor.readLine || "Thank them at the handoff."}</span></p>
        )}
        <p className="mt-1.5 text-xs text-muted-foreground">{s.showFormat === "prerecorded" ? "The producer rolls the episode. You bring it on, and take it out at the end." : "They're live from the green room. Bring them on, and the handoff at the end is yours."}</p>
      </div>
    </div>
  );

  return (
    <div data-testid="cohost-dashboard">
      {onBack && (
        <button type="button" onClick={onBack} className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-primary" data-testid="cohost-back"><ArrowLeft className="h-4 w-4" /> Back to your show</button>
      )}

      {/* The command center: who, when, and the one door that matters. */}
      <section className="overflow-hidden rounded-2xl bg-[#04102b] text-white">
        <div className="flex flex-col gap-5 p-6 sm:flex-row sm:items-end sm:justify-between sm:p-8">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#F0A71F]">Co-host · {ev.name}</p>
            <h2 className="mt-2 text-2xl font-bold tracking-tight sm:text-3xl" style={{ fontFamily: "'General Sans', 'Inter', sans-serif" }}>
              {hours.length > 0 ? `${first}, the desk is yours ${range}.` : `${first}, you're at the desk with Riccoh.`}
            </h2>
            <p className="mt-2 max-w-xl text-sm text-white/75">
              {hours.length > 0
                ? `Those are hours Riccoh can't be on. You're the host: bring each show on, do the handoff, keep the day moving. ${showCount} ${showCount === 1 ? "show" : "shows"} in your hours.`
                : "You share the segment with him. Be in the green room fifteen minutes before it starts."}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <div className="rounded-xl bg-white/10 px-4 py-3 text-center">
              <p className="text-2xl font-bold tabular-nums">{daysToGo}</p>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-white/70">days to go</p>
            </div>
            <a href={greenRoom} target="_blank" rel="noreferrer" data-testid="cohost-green-room">
              <Button className="h-12 gap-2 rounded-full bg-[#15834f] px-5 text-white hover:bg-[#126e42]"><StudioIcon className="h-6 w-6 rounded-md" tone="green" /> Green room</Button>
            </a>
          </div>
        </div>
      </section>

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="flex flex-col gap-6">
          {shared.length > 0 && (
            <section className="rounded-2xl border border-border bg-card p-5">
              <h3 className="flex items-center gap-2 text-base font-bold"><Radio className="h-4 w-4 text-primary" /> With Riccoh</h3>
              <div className="mt-3 flex flex-col gap-3">{shared.map((s) => <Show key={s.signupId} s={s} />)}</div>
            </section>
          )}
          {hours.map((h) => (
            <section key={h.blockIndex} className="rounded-2xl border border-border bg-card p-5" data-testid={`cohost-hour-${h.blockIndex}`}>
              <h3 className="flex items-center gap-2 text-base font-bold"><Clock className="h-4 w-4 text-primary" /> {formatTimeInZone(new Date(h.startAtUtc), ET)} – {formatTimeInZone(new Date(h.endAtUtc), ET)} ET <span className="text-xs font-normal text-muted-foreground">· {formatDateInZone(new Date(h.startAtUtc), ET)}</span></h3>
              {h.shows.length === 0 ? (
                <p className="mt-3 text-sm text-muted-foreground">Nothing booked in this hour yet. You hold the desk; the producer will have the filler ready.</p>
              ) : (
                <div className="mt-3 flex flex-col gap-3">{h.shows.map((s) => <Show key={s.signupId} s={s} />)}</div>
              )}
            </section>
          ))}
        </div>

        <aside className="flex flex-col gap-4">
          <section className="rounded-2xl border border-border bg-card p-5">
            <h3 className="text-sm font-bold">What a host does</h3>
            <ul className="mt-3 flex flex-col gap-2.5 text-sm text-muted-foreground">
              {[
                "Be in the green room 15 minutes before your first hour, camera and mic on.",
                "Two minutes before each show: check the podcaster is in the green room.",
                "On the top of the slot, bring them on with the line. Then it's theirs.",
                "At the end: thank them, thank the sponsor if there is one, and tee up what's next.",
                "If a recording is rolling, the producer takes it. You open and close it.",
                "Running long? The clock wins. The producer will give you the wrap.",
              ].map((t) => <li key={t} className="flex gap-2"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[#15834f]" /><span>{t}</span></li>)}
            </ul>
          </section>
          <a href="/agenda" target="_blank" rel="noreferrer" className="flex items-center gap-3 rounded-2xl border border-border bg-card p-4 hover:border-primary/40" data-testid="cohost-agenda">
            <CalendarDays className="h-5 w-5 text-[#053877]" /><span><span className="block text-sm font-semibold">Full agenda</span><span className="block text-xs text-muted-foreground">Every show, every time</span></span>
          </a>
          <a href="/watch" target="_blank" rel="noreferrer" className="flex items-center gap-3 rounded-2xl border border-border bg-card p-4 hover:border-primary/40" data-testid="cohost-watch">
            <PlayCircle className="h-5 w-5 text-[#053877]" /><span><span className="block text-sm font-semibold">Watch page</span><span className="block text-xs text-muted-foreground">What the audience sees</span></span>
          </a>
        </aside>
      </div>
    </div>
  );
}
