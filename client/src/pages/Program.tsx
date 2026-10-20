import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { StageGrid, useStageRoom } from "@/components/StageView";

// The Digital Bureau on air: what the broadcast films all day.
//
// No producer and no scenes. The clock reads the day's bookings (from
// /api/booth/program) and decides: the station's intro card for the first
// three minutes of a booking, that booking's people live (only their sound
// and pictures; everyone else in the room is waiting), the outro card for the
// last three, and filler when nobody is booked.
//
// Same contract as StudioComposite with LiveKit's recorder: START_RECORDING
// once ready to be filmed. ?eventId=N without a token previews the cards;
// add &at=<ISO time> to see any moment of the day.

type Booking = { id: number; show: string; host: string; photo: string; startAtUtc: string; endAtUtc: string; onAirAtUtc: string; offAirAtUtc: string };
type Program = { eventId: number; day: string; startAtUtc: string; endAtUtc: string; fillerUrl: string; bookings: Booking[] };

const ET = "America/New_York";
const hm = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { timeZone: ET, hour: "numeric", minute: "2-digit" });
const mmss = (ms: number) => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };
function roomFromToken(token: string | null): string {
  try { return token ? (JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))) as { video?: { room?: string } }).video?.room ?? "" : ""; } catch { return ""; }
}

function Face({ photo, size = 220 }: { photo: string; size?: number }) {
  return photo
    ? <img src={photo} alt="" className="rounded-full object-cover shadow-2xl ring-8 ring-[#F0A71F]/80" style={{ width: size, height: size }} />
    : <div className="rounded-full bg-white/10 ring-8 ring-[#F0A71F]/60" style={{ width: size, height: size }} />;
}

function Card({ eyebrow, title, sub, photo, foot }: { eyebrow: string; title: string; sub?: string; photo?: string; foot?: string }) {
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-[radial-gradient(ellipse_at_top,#0a2a6b_0%,#000741_60%)] px-24 text-white">
      <div className="flex items-center gap-16">
        {photo !== undefined && <Face photo={photo} />}
        <div className="max-w-[1000px]">
          <p className="text-2xl font-extrabold uppercase tracking-[0.22em] text-[#F0A71F]">{eyebrow}</p>
          <p className="mt-4 text-7xl font-black leading-[1.05] [text-wrap:balance]">{title}</p>
          {sub && <p className="mt-5 text-4xl font-semibold text-white/85 [text-wrap:balance]">{sub}</p>}
          {foot && <p className="mt-10 text-3xl font-bold text-[#F0A71F]">{foot}</p>}
        </div>
      </div>
      <p className="absolute bottom-10 left-24 text-xl font-bold uppercase tracking-[0.18em] text-white/60">MilitaryVoices Digital Bureau · On air. On screen. On stage. On location.</p>
    </div>
  );
}

export default function Program() {
  (window as unknown as { __mvBroadcast?: boolean }).__mvBroadcast = true;
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const url = params.get("url");
  const token = params.get("token");
  const room = roomFromToken(token);
  const eventId = params.get("eventId");
  const program = useQuery<Program>({
    queryKey: ["/api/booth/program", room, eventId],
    queryFn: async () => (await fetch(`/api/booth/program?${room ? `room=${encodeURIComponent(room)}` : `eventId=${eventId ?? ""}`}`)).json(),
    refetchInterval: 30_000,
  });

  // Preview only (no recorder token): ?at=2026-10-26T13:01:00Z plays the day as if it were then.
  const shift = useMemo(() => { const at = Date.parse(params.get("at") ?? ""); return !token && Number.isFinite(at) ? at - Date.now() : 0; }, [params, token]);
  const [now, setNow] = useState(Date.now() + shift);
  useEffect(() => { const t = setInterval(() => setNow(Date.now() + shift), 500); return () => clearInterval(t); }, [shift]);

  const bookings = program.data?.bookings ?? [];
  const current = bookings.find((b) => now >= Date.parse(b.startAtUtc) && now < Date.parse(b.endAtUtc));
  const next = bookings.find((b) => Date.parse(b.startAtUtc) > now && b.id !== current?.id);
  const phase: "intro" | "live" | "outro" | "filler" = !current ? "filler" : now < Date.parse(current.onAirAtUtc) ? "intro" : now < Date.parse(current.offAirAtUtc) ? "live" : "outro";

  // Only the booking on the clock is on air, and only while it's live.
  const onAir = phase === "live" ? current!.id : -1;
  const { tiles, connected, failed, caption } = useStageRoom(url, token, false, undefined, true, (a) => Number(a.signupId) === onAir, String(onAir));

  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    if ((connected || failed || !token) && program.data) {
      started.current = true;
      console.log("START_RECORDING");
    }
  }, [connected, failed, token, program.data]);

  const nextLine = next ? `Up next at ${hm(next.startAtUtc)}: ${next.show}` : "Back weekdays at 7 am Eastern";
  return (
    <div className="relative h-screen w-screen overflow-hidden bg-[#000741]">
      {phase === "live" && tiles.length > 0 && <StageGrid tiles={tiles} meta={{ status: "Live" }} caption={caption} />}
      {phase === "live" && tiles.length === 0 && <Card eyebrow="Live now" title={current!.show} sub={`with ${current!.host}`} photo={current!.photo} foot="Joining in a moment" />}
      {phase === "intro" && <Card eyebrow="Coming up" title={current!.show} sub={`with ${current!.host}`} photo={current!.photo} foot={`Live in ${mmss(Date.parse(current!.onAirAtUtc) - now)}`} />}
      {phase === "outro" && <Card eyebrow="Thank you" title={current!.host} sub={current!.show} photo={current!.photo} foot={nextLine} />}
      {phase === "filler" && (program.data?.fillerUrl
        ? <>
            <video src={program.data.fillerUrl} autoPlay loop playsInline className="absolute inset-0 h-full w-full object-cover" />
            <div className="absolute bottom-8 left-8 rounded-2xl bg-[#000741]/85 px-7 py-4 text-3xl font-bold text-white">{nextLine}</div>
          </>
        : <Card eyebrow="MilitaryVoices Digital Bureau" title="Military voices, live from anywhere." sub={nextLine} />)}

      <img src="/logo-wave.png?v=2" alt="" className="pointer-events-none absolute right-6 top-5 h-10 w-auto opacity-90 drop-shadow-lg" />
      {phase === "live" && (
        <div className="pointer-events-none absolute left-6 top-5 flex items-center gap-2 rounded-full bg-[#ED1C24] px-4 py-1.5">
          <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-white" />
          <span className="text-sm font-bold uppercase tracking-[0.14em] text-white">Live</span>
        </div>
      )}
    </div>
  );
}
