import { useEffect, useMemo, useState } from "react";
import { Mic, MicOff, Video, VideoOff, Radio, Users, PlayCircle, ListOrdered } from "lucide-react";
import { PlatformIcon } from "@/components/SocialIcons";
import type { SocialPlatform } from "@shared/schema";

// A working mock of the control room, not a screenshot: everything here is
// drawn from the same parts the real studio uses, so it keeps looking like the
// product as the product moves. No video, no camera permission, no network.
//
// The tiles used to be flat colour swatches with initials on them, which is
// what a placeholder looks like — four mustard-and-purple rectangles read as
// "we had no picture" rather than "four people are on camera". They are now
// drawn as camera feeds: a dark room, one key light falling across it, and a
// figure framed head-and-shoulders. Nothing here pretends to be a photograph,
// but it reads as video at a glance, which is the whole job of this section.

const DESTINATIONS: SocialPlatform[] = ["youtube", "instagram", "linkedin", "x"];

interface Person {
  name: string;
  show: string;
  cam: boolean;
  mic: boolean;
  /** The wall behind them. Deep and desaturated — a lit room, not a colour. */
  room: string;
  /** The key light, and where it falls from. One warm source per tile. */
  key: string;
  keyX: number;
  /** Framing. Nobody sits at exactly the same distance from their webcam. */
  scale: number;
  dx: number;
}

const CAST: Person[] = [
  // The host carries the brand's amber, because he is the through-line of the
  // broadcast and the eye should land on him first.
  { name: "Riccoh P.", show: "Host", cam: true, mic: true, room: "#1a1206", key: "rgba(240,167,31,0.42)", keyX: 34, scale: 1, dx: 0 },
  { name: "Dana M.", show: "Devil Dawg Double Dare", cam: true, mic: true, room: "#081226", key: "rgba(86,150,232,0.34)", keyX: 68, scale: 1.08, dx: -4 },
  { name: "Luis A.", show: "Bounce Back", cam: true, mic: true, room: "#0d0a1f", key: "rgba(150,132,236,0.30)", keyX: 28, scale: 0.94, dx: 5 },
  { name: "Gen. Mixon", show: "Guest", cam: true, mic: false, room: "#07160f", key: "rgba(94,190,150,0.28)", keyX: 62, scale: 1.02, dx: -2 },
];

const WAITING: Person[] = [
  { name: "Kim R.", show: "American Warriors", cam: true, mic: true, room: "#1c0c0b", key: "rgba(214,110,98,0.34)", keyX: 40, scale: 1, dx: 0 },
  { name: "Terrence B.", show: "Fireteam Radio", cam: true, mic: false, room: "#07141c", key: "rgba(96,168,200,0.30)", keyX: 58, scale: 1.05, dx: 0 },
  { name: "Ava L.", show: "Spouse Life", cam: false, mic: true, room: "#180c17", key: "rgba(198,120,188,0.30)", keyX: 45, scale: 1, dx: 0 },
];

const CUE = [
  { at: "07:00", label: "Riccoh opens the hour", kind: "Live" },
  { at: "07:03", label: "Devil Dawg Double Dare — segment 1", kind: "Live" },
  { at: "07:25", label: "Sponsor reel — Semper Fi Fund", kind: "Video" },
  { at: "07:27", label: "Intro to Bounce Back", kind: "Live" },
  { at: "07:30", label: "Bounce Back — segment 1", kind: "Live" },
  { at: "07:55", label: "Station ident", kind: "Video" },
  { at: "07:58", label: "Handover to American Warriors", kind: "Live" },
];

/** Fine broadcast grain. Flat colour is the thing that reads as fake. */
const GRAIN =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='3'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")";

function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function slug(name: string): string {
  return name.replace(/[^a-z0-9]/gi, "").toLowerCase();
}

/**
 * One camera feed.
 *
 * Three layers, in the order a lit room actually produces them: the wall, the
 * light falling on it, then the person in front of both. The figure is a
 * silhouette rather than a face — a drawn face at this size lands in the
 * uncanny valley, and a shape lit from one side does not.
 */
function CameraFeed({ p, zoom = 1 }: { p: Person; zoom?: number }) {
  const id = slug(p.name);
  // Full framing sits the figure on the bottom edge; a close crop holds the
  // head instead and lets the shoulders run off the frame.
  const anchorY = zoom > 1 ? 40 : 90;
  return (
    <div className="absolute inset-0 overflow-hidden">
      <div className="absolute inset-0" style={{ background: p.room }} />
      <div
        className="absolute inset-0"
        style={{ background: `radial-gradient(85% 110% at ${p.keyX}% -15%, ${p.key}, transparent 62%)` }}
      />
      <svg
        viewBox="0 0 160 90"
        preserveAspectRatio="xMidYMax slice"
        className="absolute inset-0 h-full w-full"
        aria-hidden="true"
      >
        <defs>
          <linearGradient id={`fig-${id}`} x1={p.keyX / 100} y1="0" x2={1 - p.keyX / 100} y2="1">
            <stop offset="0%" stopColor="rgba(255,255,255,0.30)" />
            <stop offset="45%" stopColor="rgba(255,255,255,0.13)" />
            <stop offset="100%" stopColor="rgba(255,255,255,0.05)" />
          </linearGradient>
        </defs>
        <g
          transform={`translate(${80 + p.dx} ${anchorY}) scale(${p.scale * zoom}) translate(${-80} ${-anchorY})`}
        >
          <ellipse cx="80" cy="37" rx="14.5" ry="16.5" fill={`url(#fig-${id})`} />
          <path d="M80 54 c 22 0 36 14 39 36 H 41 c 3 -22 17 -36 39 -36 Z" fill={`url(#fig-${id})`} />
        </g>
      </svg>
      {/* The lens: darker at the corners than in the middle, always. */}
      <div className="absolute inset-0" style={{ boxShadow: "inset 0 0 55px 10px rgba(0,0,0,0.6)" }} />
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.16] mix-blend-overlay"
        style={{ backgroundImage: GRAIN }}
      />
    </div>
  );
}

/** What a tile looks like when somebody's camera is off. */
function CameraOff({ p, small }: { p: Person; small?: boolean }) {
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-[#04102b]">
      <span
        className={`flex items-center justify-center rounded-full bg-[#053877] font-semibold text-white/80 ${
          small ? "h-5 w-5 text-[9px]" : "h-12 w-12 text-sm"
        }`}
      >
        {initials(p.name)}
      </span>
    </div>
  );
}

/** Four bars that jump around, so a tile reads as "this person is talking". */
function Level({ active }: { active: boolean }) {
  return (
    <span aria-hidden="true" className="flex h-3 items-end gap-[2px]">
      {[0, 1, 2, 3].map((i) => (
        <span
          key={i}
          className={`w-[2px] rounded-full ${active ? "bg-[#F0A71F]" : "bg-white/25"}`}
          style={
            active
              ? { height: "100%", animation: `mvdemolevel ${0.5 + i * 0.13}s ease-in-out ${i * 0.07}s infinite alternate` }
              : { height: "35%" }
          }
        />
      ))}
    </span>
  );
}

export function StudioDemo() {
  // The demo runs itself: the speaker changes, one person is brought up from
  // the green room, and the clock ticks, all on a loop.
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 2400);
    return () => clearInterval(id);
  }, []);

  const speaking = tick % CAST.length;
  const promoted = tick % 7 === 6; // every so often, someone joins the stage
  const stage = useMemo(() => (promoted ? [...CAST, WAITING[0]] : CAST), [promoted]);
  const waiting = promoted ? WAITING.slice(1) : WAITING;
  const elapsed = 1_314 + tick * 2; // 21:54 and counting

  const clock = `${String(Math.floor(elapsed / 60)).padStart(2, "0")}:${String(elapsed % 60).padStart(2, "0")}`;

  return (
    <div className="overflow-hidden rounded-2xl border border-white/10 bg-[#050a18] shadow-[0_30px_80px_-24px_rgba(0,7,65,0.55)] ring-1 ring-black/40">
      <style>{`@keyframes mvdemolevel { from { height: 25% } to { height: 100% } }
        @keyframes mvdemopulse { 0%,100% { opacity: 1 } 50% { opacity: .35 } }`}</style>

      {/* window chrome */}
      <div className="flex items-center gap-3 border-b border-white/[0.07] bg-white/[0.03] px-4 py-2.5">
        <span className="flex gap-1.5" aria-hidden="true">
          <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#28c840]" />
        </span>
        <span className="truncate font-mono text-[12px] text-white/40">
          militaryvoice.ai/studio — Main studio
        </span>
        <span className="ml-auto flex items-center gap-2.5">
          <span className="flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full bg-[#ED1C24] px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.12em] text-white">
            <span className="h-1.5 w-1.5 rounded-full bg-white" style={{ animation: "mvdemopulse 1.6s infinite" }} />
            On air
          </span>
          <span className="text-[12px] tabular-nums text-white/55">{clock}</span>
        </span>
      </div>

      <div className="grid gap-px bg-white/[0.06] sm:grid-cols-[218px_minmax(0,1fr)] lg:grid-cols-[210px_minmax(0,1fr)_252px]">
        {/* --------------------------------------------------- green room rail */}
        {/* A column, so the standby card sits on the floor of the rail rather
            than halfway up it with dead space underneath. */}
        <div className="flex flex-col bg-[#080e1f] p-3.5">
          <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-white/40">
            <Users className="h-3 w-3" /> Green room ({waiting.length})
          </div>
          <div className="mt-3 space-y-1.5">
            {waiting.map((p) => (
              <div
                key={p.name}
                className="flex items-center gap-2.5 rounded-lg border border-white/[0.06] bg-white/[0.035] p-2 transition-colors"
              >
                {/* 16:9, not a 36px square: at avatar size a lit room reads
                    as a smudge, and the copy beside this promises you can see
                    their camera before they are on air. */}
                <span className="relative aspect-video w-14 shrink-0 overflow-hidden rounded-md brightness-[1.45] ring-1 ring-white/10">
                  {p.cam ? <CameraFeed p={p} zoom={1.9} /> : <CameraOff p={p} small />}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs font-semibold text-white/90">{p.name}</div>
                  <div className="truncate text-[11px] text-white/40">{p.show}</div>
                </div>
                <span className="flex flex-col gap-1" aria-hidden="true">
                  {p.cam ? (
                    <Video className="h-3 w-3 text-[#2fa37a]" />
                  ) : (
                    <VideoOff className="h-3 w-3 text-white/25" />
                  )}
                  {p.mic ? (
                    <Mic className="h-3 w-3 text-[#2fa37a]" />
                  ) : (
                    <MicOff className="h-3 w-3 text-[#ED1C24]" />
                  )}
                </span>
              </div>
            ))}
          </div>

          <p className="mt-3 text-[11px] leading-snug text-white/30">
            They can see and hear each other in here. None of it is on air.
          </p>

          {/* mt-auto only has slack to take when the rail is a column beside
              the stage; stacked on a phone it collapses to nothing and the
              card lands on the line above it. */}
          <div className="mt-3 rounded-xl border border-[#F0A71F]/30 bg-[#F0A71F]/[0.08] p-2.5 sm:mt-auto">
            <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-[#F0A71F]">
              <PlayCircle className="h-3 w-3" /> Standby
            </div>
            <p className="mt-1 text-[11px] leading-snug text-white/50">
              Sponsor reel is loaded. One button rolls it if anything goes wrong.
            </p>
          </div>
        </div>

        {/* ------------------------------------------------------------- stage */}
        <div className="bg-[#050a18] p-3.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-white/40">
              <Radio className="h-3 w-3" /> On stage ({stage.length}/5)
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] uppercase tracking-[0.12em] text-white/30">Going out to</span>
              {DESTINATIONS.map((d) => (
                <span
                  key={d}
                  className="flex h-5 w-5 items-center justify-center rounded-full bg-white/[0.08] text-white/70"
                >
                  <PlatformIcon platform={d} className="h-2.5 w-2.5" />
                </span>
              ))}
            </div>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2">
            {stage.map((p, i) => {
              const live = i === speaking;
              return (
                <div
                  key={p.name}
                  // No transition on the ring. It used to fade over 300ms
                  // while the LIVE badge and the level bars switched at once,
                  // so for a third of a second the amber outline sat on the
                  // previous speaker — and any screenshot that caught it looks
                  // like a bug, because it is one.
                  className={`relative aspect-video overflow-hidden rounded-xl bg-[#04102b] ${
                    // a fifth person joining mid-show takes the full row
                    i === 4 ? "col-span-2" : ""
                  } ${
                    live
                      ? "ring-2 ring-[#F0A71F] shadow-[0_0_0_1px_rgba(240,167,31,0.25),0_8px_30px_-8px_rgba(240,167,31,0.45)]"
                      : "ring-1 ring-white/10"
                  }`}
                >
                  {p.cam ? <CameraFeed p={p} /> : <CameraOff p={p} />}

                  {/* The lower third, as the real stage draws it: a gradient
                      rather than a floating pill, so the name sits on the
                      picture instead of on top of it. */}
                  <div className="absolute inset-x-0 bottom-0 flex items-end gap-2 bg-gradient-to-t from-black/85 via-black/45 to-transparent px-2.5 pb-2 pt-7">
                    <Level active={live} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12px] font-semibold leading-tight text-white">
                        {p.name}
                      </span>
                      <span className="block truncate text-[10px] leading-tight text-white/55">{p.show}</span>
                    </span>
                    {!p.mic && (
                      <span className="flex shrink-0 items-center gap-1 rounded bg-[#ED1C24]/90 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-white">
                        <MicOff className="h-2.5 w-2.5" />
                        <span className="hidden sm:inline">Muted</span>
                      </span>
                    )}
                  </div>

                  {live && (
                    <span className="absolute left-2 top-2 flex items-center gap-1 rounded bg-[#ED1C24] px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-white">
                      <span
                        className="h-1 w-1 rounded-full bg-white"
                        style={{ animation: "mvdemopulse 1.6s infinite" }}
                      />
                      Live
                    </span>
                  )}
                </div>
              );
            })}
          </div>

        </div>

        {/* ------------------------------------------------- run of show column */}
        {/* Its own column on a wide screen, the way the real studio arranges
            it: who is waiting, who is on, what is next. Underneath the stage
            it made the whole control room taller than a laptop screen, so you
            never saw the three things together — which is the one thing this
            section is here to show. */}
        <div className="bg-[#080e1f] p-3.5 sm:col-span-2 lg:col-span-1">
          <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-white/40">
            <ListOrdered className="h-3 w-3" /> Run of show
          </div>
          <div className="mt-3 space-y-0.5">
            {CUE.map((c, i) => {
              const onAir = i === 1;
              const done = i === 0;
              return (
                <div
                  key={c.at}
                  className={`flex items-start gap-2 rounded-md px-2 py-1.5 ${
                    onAir ? "bg-[#F0A71F]/[0.12] ring-1 ring-inset ring-[#F0A71F]/25" : ""
                  } ${done ? "opacity-40" : ""}`}
                >
                  <span
                    className={`mt-px shrink-0 text-[11px] tabular-nums ${
                      onAir ? "font-semibold text-[#F0A71F]" : "text-white/40"
                    }`}
                  >
                    {c.at}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span
                      className={`block text-[12px] leading-snug ${
                        onAir ? "font-medium text-white" : "text-white/55"
                      }`}
                    >
                      {c.label}
                    </span>
                    {onAir && (
                      <span className="mt-0.5 inline-flex items-center gap-1 rounded bg-[#ED1C24] px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-white">
                        On air
                      </span>
                    )}
                    {!onAir && c.kind === "Video" && (
                      <span className="mt-0.5 inline-flex items-center gap-1 rounded bg-[#053877] px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-[#F0A71F]">
                        Video
                      </span>
                    )}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* operator bar */}
      <div className="flex flex-wrap items-center gap-2 border-t border-white/[0.07] bg-white/[0.03] px-3.5 py-2.5">
        <span className="rounded-full bg-[#F0A71F] px-3 py-1.5 text-[12px] font-semibold text-[#1a1200]">
          Start video now
        </span>
        <span className="rounded-full bg-white/[0.08] px-3 py-1.5 text-[12px] text-white/65">Bring up next speaker</span>
        <span className="rounded-full bg-white/[0.08] px-3 py-1.5 text-[12px] text-white/65">Roll sponsor</span>
        <span className="ml-auto font-mono text-[11px] uppercase tracking-[0.12em] text-white/30">
          Demo — nothing here is recording
        </span>
      </div>
    </div>
  );
}
