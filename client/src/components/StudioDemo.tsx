import { useEffect, useMemo, useState } from "react";
import { Mic, MicOff, Video, Radio, Users, PlayCircle, ListOrdered } from "lucide-react";
import { PlatformIcon } from "@/components/SocialIcons";
import type { SocialPlatform } from "@shared/schema";

// A working mock of the control room, not a screenshot: everything here is
// drawn from the same parts the real studio uses, so it keeps looking like the
// product as the product moves. No video, no camera permission, no network.

const DESTINATIONS: SocialPlatform[] = ["youtube", "instagram", "linkedin", "x"];

interface Person {
  name: string;
  show: string;
  tone: string;
  cam: boolean;
  mic: boolean;
}

const CAST: Person[] = [
  { name: "Riccoh P.", show: "Host", tone: "from-[#F0A71F] to-[#c9821a]", cam: true, mic: true },
  { name: "Dana M.", show: "Devil Dawg Double Dare", tone: "from-[#3f7fd6] to-[#1f4f96]", cam: true, mic: true },
  { name: "Luis A.", show: "Bounce Back", tone: "from-[#6f5bd6] to-[#3c2f8f]", cam: true, mic: true },
  { name: "Gen. Mixon", show: "Guest", tone: "from-[#2fa37a] to-[#166a4d]", cam: true, mic: false },
];

const WAITING: Person[] = [
  { name: "Kim R.", show: "American Warriors", tone: "from-[#d0574f] to-[#8f2f2a]", cam: true, mic: true },
  { name: "Terrence B.", show: "Fireteam Radio", tone: "from-[#4f8fb0] to-[#255870]", cam: true, mic: false },
  { name: "Ava L.", show: "Spouse Life", tone: "from-[#b06fa8] to-[#6f3268]", cam: false, mic: true },
];

const CUE = [
  { at: "07:00", label: "Riccoh opens the hour", kind: "Live" },
  { at: "07:03", label: "Devil Dawg Double Dare — segment 1", kind: "Live" },
  { at: "07:25", label: "Sponsor reel — Semper Fi Fund", kind: "Video" },
  { at: "07:27", label: "Intro to Bounce Back", kind: "Live" },
];

function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function Avatar({ p, className = "" }: { p: Person; className?: string }) {
  return (
    <div
      className={`flex items-center justify-center rounded-full bg-gradient-to-br font-semibold text-white/95 ${p.tone} ${className}`}
    >
      {initials(p.name)}
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
    <div className="overflow-hidden rounded-2xl border border-white/12 bg-[#080d20] shadow-2xl ring-1 ring-black/40">
      <style>{`@keyframes mvdemolevel { from { height: 25% } to { height: 100% } }
        @keyframes mvdemopulse { 0%,100% { opacity: 1 } 50% { opacity: .35 } }`}</style>

      {/* window chrome */}
      <div className="flex items-center gap-3 border-b border-white/10 bg-white/[0.04] px-4 py-2.5">
        <span className="flex gap-1.5" aria-hidden="true">
          <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#28c840]" />
        </span>
        <span className="truncate font-mono text-[11px] text-white/45">
          militaryvoice.ai/studio — Main studio
        </span>
        <span className="ml-auto flex items-center gap-2">
          <span className="flex items-center gap-1.5 rounded-full bg-[#ED1C24] px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-white">
            <span className="h-1.5 w-1.5 rounded-full bg-white" style={{ animation: "mvdemopulse 1.6s infinite" }} />
            On air
          </span>
          <span className="text-[11px] tabular-nums text-white/60">{clock}</span>
        </span>
      </div>

      <div className="grid gap-px bg-white/[0.06] sm:grid-cols-[190px_1fr]">
        {/* green room rail */}
        <div className="bg-[#0b1226] p-3">
          <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-white/45">
            <Users className="h-3 w-3" /> Green room ({waiting.length})
          </div>
          <div className="mt-3 space-y-2">
            {waiting.map((p) => (
              <div key={p.name} className="flex items-center gap-2.5 rounded-lg bg-white/[0.05] p-2">
                <Avatar p={p} className="h-8 w-8 text-[11px]" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs font-medium text-white/90">{p.name}</div>
                  <div className="truncate text-[10px] text-white/45">{p.show}</div>
                </div>
                <span className="flex flex-col gap-1" aria-hidden="true">
                  <Video className={`h-3 w-3 ${p.cam ? "text-[#2fa37a]" : "text-white/25"}`} />
                  {p.mic ? (
                    <Mic className="h-3 w-3 text-[#2fa37a]" />
                  ) : (
                    <MicOff className="h-3 w-3 text-[#ED1C24]" />
                  )}
                </span>
              </div>
            ))}
          </div>

          <div className="mt-4 rounded-lg border border-[#F0A71F]/40 bg-[#F0A71F]/10 p-2.5">
            <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-[#F0A71F]">
              <PlayCircle className="h-3 w-3" /> Standby
            </div>
            <p className="mt-1 text-[10px] leading-snug text-white/55">
              Sponsor reel is loaded. One button rolls it if anything goes wrong.
            </p>
          </div>
        </div>

        {/* stage */}
        <div className="bg-[#080d20] p-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-white/45">
              <Radio className="h-3 w-3" /> On stage ({stage.length}/5)
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] uppercase tracking-[0.12em] text-white/35">Going out to</span>
              {DESTINATIONS.map((d) => (
                <span
                  key={d}
                  className="flex h-5 w-5 items-center justify-center rounded-full bg-white/10 text-white/80"
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
                  className={`relative aspect-video overflow-hidden rounded-xl bg-gradient-to-br ${p.tone} ${
                    // a fifth person joining mid-show takes the full row
                    i === 4 ? "col-span-2" : ""
                  } ${live ? "ring-2 ring-[#F0A71F]" : "ring-1 ring-white/10"}`}
                >
                  <div className="absolute inset-0 bg-black/40" />
                  <div
                    aria-hidden="true"
                    className="absolute inset-0 bg-[radial-gradient(60%_70%_at_50%_35%,rgba(255,255,255,0.14),transparent_70%)]"
                  />
                  <div className="absolute inset-0 flex items-center justify-center">
                    <span className="text-lg font-semibold text-white/90">{initials(p.name)}</span>
                  </div>
                  <div className="absolute inset-x-1.5 bottom-1.5 flex items-center gap-1.5 rounded-md bg-black/55 px-1.5 py-1 backdrop-blur-sm">
                    <Level active={live} />
                    <span className="min-w-0 flex-1 truncate text-[10px] font-medium text-white">{p.name}</span>
                    {!p.mic && <MicOff className="h-2.5 w-2.5 shrink-0 text-[#ED1C24]" />}
                  </div>
                  {live && (
                    <span className="absolute left-1.5 top-1.5 rounded bg-[#ED1C24] px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wider text-white">
                      Live
                    </span>
                  )}
                </div>
              );
            })}
          </div>

          {/* run of show */}
          <div className="mt-3 rounded-xl border border-white/10 bg-white/[0.03] p-3">
            <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-white/45">
              <ListOrdered className="h-3 w-3" /> Run of show
            </div>
            <div className="mt-2 space-y-1">
              {CUE.map((c, i) => (
                <div
                  key={c.at}
                  className={`flex items-center gap-2.5 rounded-md px-2 py-1.5 ${
                    i === 1 ? "bg-[#F0A71F]/15" : ""
                  }`}
                >
                  <span className="text-[10px] tabular-nums text-white/45">{c.at}</span>
                  <span className={`min-w-0 flex-1 truncate text-[11px] ${i === 1 ? "text-white" : "text-white/60"}`}>
                    {c.label}
                  </span>
                  <span
                    className={`rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider ${
                      c.kind === "Video" ? "bg-[#053877] text-[#F0A71F]" : "bg-white/10 text-white/60"
                    }`}
                  >
                    {i === 1 ? "On air" : c.kind}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* operator bar */}
      <div className="flex flex-wrap items-center gap-2 border-t border-white/10 bg-white/[0.04] px-3 py-2.5">
        <span className="rounded-full bg-[#F0A71F] px-3 py-1.5 text-[11px] font-semibold text-[#1a1200]">
          Start video now
        </span>
        <span className="rounded-full bg-white/10 px-3 py-1.5 text-[11px] text-white/70">Bring up next speaker</span>
        <span className="rounded-full bg-white/10 px-3 py-1.5 text-[11px] text-white/70">Roll sponsor</span>
        <span className="ml-auto font-mono text-[10px] uppercase tracking-[0.12em] text-white/35">
          Demo — nothing here is recording
        </span>
      </div>
    </div>
  );
}
