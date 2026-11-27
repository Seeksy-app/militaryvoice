import { motion, useReducedMotion } from "framer-motion";
import { Check } from "lucide-react";
import { Art3D } from "@/components/ui/icon-tile";
import type { Icon3D } from "@/lib/icons3d";
import { SoonPill } from "@/components/platform/stockVideo";
import { PlatformIcon } from "@/components/SocialIcons";

/**
 * "What it is": the four pillars as Clay-style cards (Andrew, 21 Nov 2026: "clean this section up, make it more
 * engaging, use your imagination", with the 3D icons). Each card opens on a small working scene of the product,
 * a 3D icon floating over it, then a short title, one or two sentences and three points. The scenes are decorative
 * (aria-hidden); the words carry the meaning. Motion is gentle, stops for reduced motion, and runs once in view.
 */

type Pillar = { key: string; art: Icon3D; kicker: string; title: string; body: string; points: string[]; tint: string; Scene: () => JSX.Element };

const chip = "inline-flex items-center gap-1.5 rounded-full bg-white px-2.5 py-1 text-[11px] font-semibold text-[#000741] shadow-[0_1px_2px_rgba(0,7,65,0.08),0_4px_12px_rgba(0,7,65,0.06)] ring-1 ring-[#000741]/[0.06] dark:bg-[#0f1d4d] dark:text-white dark:ring-white/10";
const card = "rounded-2xl bg-white shadow-[0_1px_2px_rgba(0,7,65,0.08),0_10px_30px_rgba(0,7,65,0.08)] ring-1 ring-[#000741]/[0.06] dark:bg-[#0f1d4d] dark:ring-white/10";

/** Events: one show going out live, in everyone's own time, to the places they watch. */
function EventsScene() {
  return (
    <div className="flex w-full max-w-[19rem] flex-col gap-2">
      <div className={`${card} p-3`}>
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-xs font-semibold text-[#000741] dark:text-white">Veterans Day Live</span>
          <span className="inline-flex items-center gap-1 rounded-full bg-[#e5484d] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" /> Live
          </span>
        </div>
        <div className="mt-2 grid grid-cols-3 gap-1.5 text-center">
          {[["7:00 PM", "New York"], ["4:00 PM", "San Diego"], ["9:00 AM", "Okinawa"]].map(([t, c]) => (
            <span key={c} className="rounded-lg bg-[#eef3fb] px-1 py-1.5 dark:bg-white/5">
              <span className="block text-[11px] font-bold tabular-nums text-[#053877] dark:text-[#8fb5e8]">{t}</span>
              <span className="block text-[10px] text-[#53617a] dark:text-white/60">{c}</span>
            </span>
          ))}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className={chip}><PlatformIcon platform="youtube" className="h-3 w-3 text-[#FF0000]" /> YouTube</span>
        <span className={`${chip} text-[#53617a]`}>More places soon</span>
      </div>
    </div>
  );
}

/** Run by SI: the run of show writing itself, a row at a time. */
function SiScene() {
  const reduce = useReducedMotion();
  const rows = [["7:00", "Welcome and host lines"], ["7:25", "Panel: life after service"], ["7:55", "Clips for every speaker"]];
  return (
    <div className={`${card} w-full max-w-[19rem] p-3`}>
      <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#8a5a00] dark:text-[#F0A71F]">Run of show</p>
      <ul className="mt-2 space-y-1.5">
        {rows.map(([t, label], i) => (
          <motion.li
            key={t}
            initial={reduce ? false : { opacity: 0, x: -8 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.25 + i * 0.35, duration: 0.35 }}
            className={`flex items-center gap-2 rounded-lg px-2 py-1.5 ${i === 2 ? "bg-[#F0A71F]/15" : "bg-[#eef3fb] dark:bg-white/5"}`}
          >
            <span className={`rounded-md px-1.5 py-px text-[10px] font-bold tabular-nums ${i === 2 ? "bg-[#F0A71F] text-[#000741]" : "bg-white text-[#053877] dark:bg-white/10 dark:text-[#8fb5e8]"}`}>{t}</span>
            <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-[#000741] dark:text-white">{label}</span>
            <Check className="h-3.5 w-3.5 shrink-0 text-[#079455]" strokeWidth={3} />
          </motion.li>
        ))}
      </ul>
    </div>
  );
}

/** Discovery: a plain-English search, and the people it finds. */
function DiscoveryScene() {
  const people = [{ i: "JR", bg: "#cfdcf2", fg: "#053877", n: "48K" }, { i: "MT", bg: "#F0A71F", fg: "#000741", n: "112K", v: true }, { i: "DS", bg: "#d9f2e6", fg: "#067647", n: "23K" }];
  return (
    <div className="flex w-full max-w-[19rem] flex-col gap-2">
      <div className={`${card} flex items-center gap-2 px-3 py-2.5`}>
        <span className="min-w-0 flex-1 truncate text-[11px] text-[#000741] dark:text-white">Marine veterans who talk about transition</span>
        <span className="rounded-md bg-[#053877] px-1.5 py-0.5 text-[10px] font-semibold text-white">Search</span>
      </div>
      <div className="flex items-end gap-2">
        {people.map((p) => (
          <div key={p.i} className={`${card} relative flex flex-1 flex-col items-center px-2 pb-2 pt-3 ${p.v ? "-translate-y-1.5 ring-2 ring-[#F0A71F]" : ""}`}>
            {p.v && <span className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-[#F0A71F] ring-2 ring-white dark:ring-[#0f1d4d]"><Check className="h-3 w-3 text-[#000741]" strokeWidth={3.5} /></span>}
            <span className="flex h-8 w-8 items-center justify-center rounded-full text-[11px] font-bold" style={{ background: p.bg, color: p.fg }}>{p.i}</span>
            <span className="mt-1 text-[11px] font-bold tabular-nums text-[#000741] dark:text-white">{p.n}</span>
            <span className="text-[9px] text-[#53617a] dark:text-white/60">real reach</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Verified: the badge, on a speaker's card. */
function VerifiedScene() {
  return (
    <div className={`${card} w-full max-w-[19rem] p-3`}>
      <div className="flex items-center gap-3">
        <span className="relative">
          <span className="flex h-11 w-11 items-center justify-center rounded-full bg-[#cfdcf2] text-sm font-bold text-[#053877]">AK</span>
          <span className="absolute -bottom-0.5 -right-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-[#F0A71F] ring-2 ring-white dark:ring-[#0f1d4d]"><Check className="h-3 w-3 text-[#000741]" strokeWidth={3.5} /></span>
        </span>
        <span className="min-w-0">
          <span className="block truncate text-xs font-semibold text-[#000741] dark:text-white">Army veteran and podcast host</span>
          <span className="mt-0.5 inline-flex items-center gap-1 rounded-full bg-[#F0A71F]/20 px-2 py-0.5 text-[10px] font-semibold text-[#8a5a00] dark:text-[#F0A71F]">Verified on MilitaryVoices</span>
        </span>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-1.5">
        {["Identity checked", "Service checked"].map((t) => (
          <span key={t} className="flex items-center gap-1 rounded-lg bg-[#eef3fb] px-2 py-1.5 text-[10px] font-semibold text-[#053877] dark:bg-white/5 dark:text-[#8fb5e8]">
            <Check className="h-3 w-3 text-[#079455]" strokeWidth={3} /> {t}
          </span>
        ))}
      </div>
    </div>
  );
}

export const PILLARS: Pillar[] = [
  {
    key: "events", art: "video", kicker: "Events", tint: "from-[#e8effb] to-[#f6f9fe] dark:from-[#0d1a45] dark:to-[#0a1433]", Scene: EventsScene,
    title: "Live or pre-recorded, in the room or online",
    body: "Stream a virtual event, broadcast an in-person one, or both at once. Speakers claim their own slots in their own time zone, and the page and lineup build themselves.",
    points: ["Scheduling in every time zone", "Event pages that promote themselves", "One broadcast, every destination*"],
  },
  {
    key: "si", art: "sparkles", kicker: "Run by SI", tint: "from-[#fdf3df] to-[#fffaf0] dark:from-[#2a1f08] dark:to-[#0a1433]", Scene: SiScene,
    title: "The agenda and the show, handled",
    body: "Alex, our SI producer, turns your lineup into a minute-by-minute run of show, writes the host lines and reminders, and cuts the clips after the last segment. Your team steers.",
    points: ["Agenda and run of show from your lineup", "Host lines, reminders and follow-ups written for you", "Clips for every speaker, after the show"],
  },
  {
    key: "discovery", art: "search", kicker: "Discovery", tint: "from-[#e6f4fb] to-[#f5fbfe] dark:from-[#082a3a] dark:to-[#0a1433]", Scene: DiscoveryScene,
    title: "Find the right voices for it",
    body: "Search over 800 million creator profiles for veterans, service members and military spouses, and see the real audience behind every follower count.",
    points: ["Over 800 million creator profiles", "Audience quality, real reach and growth", "Brand deals, and the contact details creators publish"],
  },
  {
    key: "verified", art: "shield", kicker: "Verified", tint: "from-[#e7f6ee] to-[#f6fcf9] dark:from-[#0a2a1c] dark:to-[#0a1433]", Scene: VerifiedScene,
    title: "Every speaker becomes a verified voice",
    body: "Everyone on a MilitaryVoices event lineup gets the Verified badge. It goes with them, so brands and shows can find them.",
    points: ["Given for being on an event lineup", "A badge that travels with them", "Introductions made through us, with their say-so"],
  },
];

export function PillarCards() {
  const reduce = useReducedMotion();
  return (
    <div className="mt-12 grid gap-5 md:grid-cols-2">
      {PILLARS.map((p, i) => (
        <motion.article
          key={p.key}
          initial={reduce ? false : { opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-60px" }}
          transition={{ duration: 0.45, delay: i * 0.07 }}
          className="group flex flex-col overflow-hidden rounded-3xl border border-border bg-card shadow-sm transition-[box-shadow,transform] duration-300 hover:-translate-y-0.5 hover:shadow-[0_18px_40px_rgba(0,7,65,0.12)]"
          data-testid={`pillar-${p.key}`}
        >
          {/* The scene: a working bit of the product. Its 3D icon sits across the edge into the words, like a face over a cover. */}
          <div aria-hidden className={`relative flex h-56 items-center justify-center bg-gradient-to-b px-6 pb-8 pt-4 ${p.tint}`}>
            <p.Scene />
            <motion.span
              className="pointer-events-none absolute -bottom-8 left-6 z-10 sm:left-7"
              animate={reduce ? undefined : { y: [0, -4, 0], rotate: [0, -2, 0] }}
              transition={{ duration: 5, repeat: Infinity, ease: "easeInOut", delay: i * 0.6 }}
            >
              <Art3D name={p.art} size={64} className="drop-shadow-[0_8px_12px_rgba(0,7,65,0.2)] transition-transform duration-300 group-hover:-rotate-6 group-hover:scale-110" />
            </motion.span>
          </div>
          <div className="flex flex-1 flex-col px-6 pb-6 pt-11 sm:px-7 sm:pb-7">
            <span className="text-xs font-bold uppercase tracking-[0.16em] text-[#8a5a00] dark:text-[#F0A71F]">{String(i + 1).padStart(2, "0")} · {p.kicker}</span>
            <h3 className="mt-2 text-xl font-semibold tracking-tight text-balance sm:text-2xl">{p.title}</h3>
            <p className="mt-2 flex-1 text-[15px] leading-relaxed text-muted-foreground">{p.body}</p>
            <ul className="mt-5 flex flex-col gap-2">
              {p.points.map((pt) => (
                <li key={pt} className="flex items-start gap-2 text-sm">
                  <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-[#F0A71F]/20"><Check className="h-2.5 w-2.5 text-[#8a5a00] dark:text-[#F0A71F]" strokeWidth={3.5} /></span>
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-1">{pt.replace(/\*$/, "")}{pt.endsWith("*") && <SoonPill tone="light" />}</span>
                </li>
              ))}
            </ul>
          </div>
        </motion.article>
      ))}
    </div>
  );
}
