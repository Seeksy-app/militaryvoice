import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Clapperboard,
  Plus,
  Search,
  Video,
  VideoOff,
  Mic,
  Headphones,
  Settings2,
  Users,
  Radio,
  Captions,
  Rows3,
  Layers,
  Image as ImageIcon,
  Upload,
  LogOut,
  ArrowRight,
  Film,
} from "lucide-react";
import { StageGrid, type RoomMeta } from "@/components/StageView";
import { CAST, castTile, useFakeCamera, useTicker } from "./fakeCamera";
import { SCENE_STILLS, VCAST, useClipTrack, vcastTile } from "./stockVideo";

// The control room, drawn from the same parts as the real console: the scene
// rail down the left, the programme in the middle with Restream's six layouts
// under it and the host seats beside them, graphics down the right. It steps
// through the layouts by itself so the section shows what one press does.

const LAYOUTS: { key: string; label: string; icon: ReactNode }[] = [
  { key: "showtime", label: "Showtime", icon: <span className="relative block h-full w-full"><span className="absolute left-[8%] top-[14%] h-[72%] w-[56%] rounded-[2px] bg-current" /><span className="absolute left-[52%] top-[30%] h-[44%] w-[34%] rounded-[2px] bg-current ring-2 ring-[#1b2140]" /></span> },
  { key: "contain", label: "Contain", icon: <span className="flex h-full w-full items-center gap-[3px] px-[8%]"><span className="h-[40%] flex-1 rounded-[2px] bg-current" /><span className="h-[40%] flex-1 rounded-[2px] bg-current" /></span> },
  { key: "cover", label: "Cover", icon: <span className="flex h-full w-full gap-[3px] px-[8%] py-[14%]"><span className="flex-1 rounded-[2px] bg-current" /><span className="flex-1 rounded-[2px] bg-current" /></span> },
  { key: "sidebar", label: "Sidebar", icon: <span className="flex h-full w-full gap-[3px] px-[8%] py-[14%]"><span className="flex-[3] rounded-[2px] bg-current" /><span className="flex-1 rounded-[2px] bg-current" /></span> },
  { key: "pip", label: "Picture-in-Picture", icon: <span className="relative block h-full w-full px-[8%] py-[14%]"><span className="block h-full w-full rounded-[2px] bg-current" /><span className="absolute bottom-[10%] right-[5%] h-[22%] w-[18%] rounded-[1px] bg-current ring-2 ring-[#1b2140]" /></span> },
  { key: "thumbnails", label: "Thumbnails", icon: <span className="flex h-full w-full items-center gap-[3px] px-[8%] py-[14%]"><span className="h-full flex-[5] rounded-[2px] bg-current" /><span className="h-[22%] flex-1 rounded-[1px] bg-current" /></span> },
];

const SCENES = [
  { n: 1, title: "Opening panel — Main stage", time: "8:30 AM", kind: "Cameras", thumb: SCENE_STILLS.conference },
  { n: 2, title: "Welcome — Sofia Reyes", time: "9:00 AM", kind: "Cameras", thumb: CAST.sofia.cam, face: CAST.sofia.face },
  { n: 3, title: "Two Tours — Ray Castillo", time: "9:05 AM", kind: "Cameras", thumb: VCAST.ray.poster, face: VCAST.ray.face, live: true },
  { n: 4, title: "Sponsor — Ironside Coffee, veteran-owned", time: "9:30 AM", kind: "Video", thumb: SCENE_STILLS.sponsor },
  { n: 5, title: "Ruck Talk — Jordan Blake", time: "9:35 AM", kind: "Cameras", thumb: VCAST.jordan.poster, face: VCAST.jordan.face },
];

const TOOLS = [
  { icon: Captions, label: "Lower third" },
  { icon: Rows3, label: "Ticker" },
  { icon: Layers, label: "Background" },
  { icon: ImageIcon, label: "Logo" },
  { icon: Upload, label: "Media" },
];

export function StudioConsoleMock() {
  const ray = useClipTrack(VCAST.ray.src, VCAST.ray.poster);
  const jordan = useClipTrack(VCAST.jordan.src, VCAST.jordan.poster);
  const host = useFakeCamera(CAST.sofia.cam);
  // On a narrow screen the column layouts shrink their side tiles below the
  // size a name fits in, so a phone gets the three two-shot layouts only.
  const boxRef = useRef<HTMLDivElement | null>(null);
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const el = boxRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([e]) => setNarrow(e.contentRect.width < 760));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const shown = narrow ? LAYOUTS.slice(0, 3) : LAYOUTS;
  const auto = useTicker(shown.length, 3200);
  const [picked, setPicked] = useState<string | null>(null);
  const layout = (picked && shown.some((l) => l.key === picked) ? picked : null) ?? shown[auto % shown.length].key;
  const talking = useTicker(3, 3700);

  const meta: RoomMeta = {
    stageLayout: layout,
    backgroundUrl: "#0a1a44",
    logoUrl: "/logo-wave.png?v=2",
    logoCorner: "top-right",
    logoSize: 90,
    stageOrder: "ray,jordan,sofia",
  };
  // Showtime, picture-in-picture, Contain and Cover read best as two-shots:
  // with a third camera they leave a sliver or an empty quarter. The second
  // guest steps back to the green room for those, as a producer would, and
  // comes up for Sidebar and Thumbnails, which are built for a column.
  const twoShot = layout !== "sidebar" && layout !== "thumbnails";
  const tiles = [
    vcastTile("ray", ray, talking === 0),
    ...(twoShot ? [] : [vcastTile("jordan", jordan, talking === 1)]),
    castTile("sofia", host, talking === 2 || (twoShot && talking === 1), true),
  ];

  return (
    <div ref={boxRef} className="overflow-hidden rounded-2xl border border-white/10 bg-[#000741] text-white shadow-[0_50px_100px_-30px_rgba(0,0,0,0.85)]">
      {/* Top bar */}
      <div className="flex items-center gap-3 border-b border-white/10 px-3 py-2 sm:px-4">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/10"><Clapperboard className="h-4 w-4 text-[#F0A71F]" /></span>
        <div className="min-w-0 leading-tight">
          <p className="truncate text-sm font-semibold">Main studio</p>
          <p className="flex items-center gap-1.5 truncate text-[11px] text-white/55"><span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400" /> <span className="truncate">Camera and sound connected</span></p>
        </div>
        <span className="ml-auto hidden items-center gap-1.5 text-xs text-white/60 md:flex"><LogOut className="h-3.5 w-3.5" /> Leave the room</span>
        <span className="ml-auto inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full bg-[#ED1C24] px-3 py-1.5 text-xs font-bold text-white md:ml-0">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" /> <span>Live<span className="hidden sm:inline"> on YouTube</span></span>
        </span>
      </div>

      <div className="grid lg:grid-cols-[13.5rem_minmax(0,1fr)_4.5rem]">
        {/* Scene rail */}
        <aside className="relative hidden border-r border-white/10 bg-[#050e2e] lg:block">
          {/* Out of the flow, so the rail never makes the stage taller than it is. */}
          <div className="absolute inset-0 flex flex-col gap-2 p-2.5">
          <div className="flex items-center justify-between px-1 pt-0.5">
            <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-white/70">Scenes <span className="rounded bg-white/10 px-1.5 text-white/80">24</span></span>
            <span className="flex items-center gap-1 text-[11px] text-white/70"><Plus className="h-3 w-3" /> Add scene</span>
          </div>
          <div className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-2 py-1.5 text-[11px] text-white/35"><Search className="h-3 w-3" /> Find a scene or a name…</div>
          <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden">
          {SCENES.map((s) => (
            <div key={s.n} className={`relative shrink-0 overflow-hidden rounded-lg ${s.live ? "ring-2 ring-[#ED1C24]" : "ring-1 ring-white/10"}`}>
              <img src={s.thumb} alt="" loading="lazy" className="aspect-[16/8] w-full object-cover" />
              <div className="absolute inset-0 bg-gradient-to-t from-[#04102b] via-[#04102b]/40 to-transparent" />
              <span className="absolute left-1.5 top-1.5 rounded bg-black/60 px-1.5 text-[9px] font-bold">{s.n}</span>
              {s.live && <span className="absolute right-1.5 top-1.5 rounded bg-[#ED1C24] px-1.5 py-px text-[9px] font-bold uppercase tracking-wider">On air</span>}
              <div className="absolute inset-x-2 bottom-1.5 flex items-end gap-1.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[11px] font-semibold leading-tight">{s.title}</p>
                  <p className="flex items-center gap-1 text-[9.5px] text-white/60"><span className="text-[#F0A71F]">{s.time}</span> · {s.kind === "Video" ? <Film className="h-2.5 w-2.5" /> : <Video className="h-2.5 w-2.5" />} {s.kind}</p>
                </div>
                {s.face && <img src={s.face} alt="" className="h-5 w-5 rounded-full object-cover ring-1 ring-white/40" />}
              </div>
            </div>
          ))}
          </div>
          <div className="flex shrink-0 items-center justify-between gap-1 rounded-full bg-[#F0A71F] px-3 py-1.5 text-[11px] font-semibold text-[#1a1200]">
            <span className="truncate">Next · Sponsor, Ironside Coffee</span> <ArrowRight className="h-3 w-3 shrink-0" />
          </div>
          </div>
        </aside>

        {/* Programme + layout bar */}
        <div className="min-w-0 bg-black">
          <div className="relative aspect-video overflow-hidden bg-[#04102b]">
            <StageGrid tiles={tiles} meta={meta} muted />
          </div>
          <div className="flex items-center gap-3 overflow-hidden px-2 py-2 sm:px-3">
            <div className="flex min-w-0 flex-1 items-center justify-center gap-1 sm:gap-1.5">
              {shown.map((l) => (
                <button
                  key={l.key}
                  type="button"
                  title={l.label}
                  aria-label={`${l.label} layout`}
                  aria-pressed={layout === l.key}
                  onClick={() => setPicked(l.key)}
                  className={`h-7 w-10 shrink-0 rounded-md border-2 bg-[#1b2140] transition-colors sm:h-9 sm:w-14 ${
                    layout === l.key ? "border-[#3B82F6] text-white/85" : "border-transparent text-white/30 hover:text-white/60"
                  }`}
                >
                  {l.icon}
                </button>
              ))}
            </div>
            {/* Host seats: green on stage, red off it. */}
            <div className="hidden shrink-0 items-center gap-1.5 border-l border-white/15 pl-3 sm:flex">
              <span className="hidden text-[9px] font-bold uppercase tracking-[0.14em] text-white/45 xl:block">Hosts</span>
              {[
                { f: CAST.sofia.face, on: true, n: CAST.sofia.name },
                { f: CAST.dana.face, on: false, n: `${CAST.dana.name} (co-host)` },
              ].map((h) => (
                <span key={h.f} title={`${h.n} — ${h.on ? "on stage" : "off stage"}`} className={`relative h-8 w-8 overflow-hidden rounded-full ring-2 ${h.on ? "ring-emerald-400" : "ring-[#ED1C24]"}`}>
                  <img src={h.f} alt="" className="h-full w-full object-cover" />
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* Graphics */}
        <aside className="hidden flex-col items-center gap-4 border-l border-white/10 bg-[#050e2e] py-4 lg:flex">
          {TOOLS.map(({ icon: Icon, label }) => (
            <span key={label} className="flex flex-col items-center gap-1 text-[10px] text-white/60">
              <Icon className="h-4 w-4 text-white/80" /> {label}
            </span>
          ))}
        </aside>
      </div>

      {/* Bottom bar */}
      <div className="flex items-center gap-4 border-t border-white/10 px-3 py-2 text-[10px] text-white/65 sm:px-4">
        <div className="flex flex-1 items-center justify-center gap-5">
          <span className="flex flex-col items-center gap-0.5"><VideoOff className="h-4 w-4 text-[#ED1C24]" /> Camera off</span>
          <span className="flex flex-col items-center gap-0.5"><Mic className="h-4 w-4 text-white/85" /> Mic</span>
          <span className="hidden flex-col items-center gap-0.5 sm:flex"><Headphones className="h-4 w-4 text-white/85" /> Hear me</span>
          <span className="hidden flex-col items-center gap-0.5 sm:flex"><Plus className="h-4 w-4 text-white/85" /> Add</span>
          <span className="flex flex-col items-center gap-0.5"><Settings2 className="h-4 w-4 text-white/85" /> Settings</span>
        </div>
        <span className="relative flex flex-col items-center gap-0.5">
          <Users className="h-4 w-4 text-white/85" /> Green room
          <span className="absolute -right-1.5 -top-1 rounded-full bg-emerald-500 px-1 text-[9px] font-bold leading-4 text-white">3</span>
        </span>
        <span className="hidden flex-col items-center gap-0.5 sm:flex"><Radio className="h-4 w-4 text-white/85" /> Watch page</span>
      </div>
    </div>
  );
}
