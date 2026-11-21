import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Clapperboard, Loader2, Music2, Play, Plus, Repeat, Square, Trash2, Volume2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { BACKGROUNDS, LIMITS, backgroundShelf, sceneLive, type AssetKind, type Background, type LibraryItem, type LibrarySource, type MusicItem, type PlaySlot, type RoomKit, type SoundItem, type VideoClip } from "./look";
import { AddFile, Banners, LogoSection, Removable, Swatch } from "./LookPanel";

/**
 * Media (Studio phase 3, mockup approved 21 Nov; replaces "Your look" when STUDIO_V3 is on):
 * logo, banners, video clips (intro and outro are tagged clips, each with Loop), our ready-made
 * cards and the countdown, the background of the scene on stage, sounds and music. Sounds and
 * music play through the studio's player, so everyone hears them and they're in the recording.
 */
const label = "mt-6 text-xs font-bold uppercase tracking-[0.06em] text-[#667085]";
const EVERYONE = "Everyone in your studio hears it, and it goes into your recording and live show.";
const mmss = (sec?: number) => (sec ? `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, "0")}` : "");

/** Our cards, drawn live in your style. They never switch a scene. */
const CARDS: { slot: PlaySlot; title: string; short: string }[] = [
  { slot: "brb", title: "Be right back", short: "Be right back" },
  { slot: "soon", title: "Starting soon", short: "Starting soon" },
  { slot: "thanks", title: "Thank you for watching", short: "Thank you" },
];

export function MediaPanel({ kit }: { kit: RoomKit }) {
  const look = kit.look!;
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-5 pb-6 pt-5" data-testid="media-panel">
      <p className="text-lg font-bold tracking-tight">Media</p>
      <p className="mt-0.5 text-[13px] text-[#667085]">Changes show on the stage right away.</p>

      <p className={label}>Logo</p>
      <LogoSection kit={kit} />

      <details className="group/b mt-6" data-testid="media-banners">
        <summary className="flex cursor-pointer list-none items-center justify-between text-xs font-bold uppercase tracking-[0.06em] text-[#667085]">
          <span>Banners{look.banners.length ? ` · ${look.banners.length}` : ""}</span><span className="text-[11px] font-semibold normal-case tracking-normal text-[#053877] group-open/b:hidden">Show</span>
        </summary>
        <Banners kit={kit} />
      </details>

      <p className={label}>Video clips</p>
      <Clips kit={kit} />

      <p className={label}>Background</p>
      <SceneBackground kit={kit} />

      <p className={label}>Sounds</p>
      <Sounds kit={kit} />

      <p className={label}>Background music</p>
      <MusicList kit={kit} />
    </div>
  );
}

/* ── Video clips: uploads (intro and outro are tagged ones), our cards, the countdown ── */

function Clips({ kit }: { kit: RoomKit }) {
  const look = kit.look!;
  const videos = look.videos ?? [];
  const playing = kit.live.playing;
  const setClip = (id: string, p: Partial<VideoClip>) => kit.change((l) => {
    let vs = (l.videos ?? []).map((v) => (v.asset.id === id ? { ...v, ...p } : v));
    // One intro and one outro: tagging a clip untags the old one.
    if (p.role) vs = vs.map((v) => (v.asset.id !== id && v.role === p.role ? { ...v, role: "" as const } : v));
    const pick = (r: "intro" | "outro") => vs.find((v) => v.role === r)?.asset ?? null;
    return { ...l, videos: vs, intro: pick("intro"), outro: pick("outro") };
  });
  return (
    <div className="mt-2.5 flex flex-col gap-2" data-testid="media-clips">
      {videos.map((v) => {
        const slot = v.role || null;
        const on = !!slot && playing?.slot === slot;
        return (
          <div key={v.asset.id} className={`group flex items-center gap-2 rounded-xl border px-2 py-2 ${on ? "border-[#053877] bg-[#f5f8fd]" : "border-[#e4e7ec]"}`} data-testid="clip-row">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[7px] bg-[#101828] text-white"><Clapperboard className="h-3.5 w-3.5" /></div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-semibold">{v.asset.name || "Video"}</p>
              <div className="flex items-center gap-1.5 text-xs text-[#667085]">
                <select value={v.role} onChange={(e) => setClip(v.asset.id, { role: e.target.value as VideoClip["role"] })} aria-label="Use as" className="h-6 rounded-md border border-[#e4e7ec] bg-white px-1 text-[11px]">
                  <option value="">Clip</option><option value="intro">Intro</option><option value="outro">Outro</option>
                </select>
                {on ? "Playing now" : mmss(v.asset.sec)}
              </div>
            </div>
            <button type="button" onClick={() => { if (window.confirm("Delete this clip?")) void kit.removeAsset("video", v.asset.id); }} aria-label="Delete clip" className="hidden shrink-0 text-[#98a2b3] hover:text-[#b42318] group-focus-within:block group-hover:block"><Trash2 className="h-4 w-4" /></button>
            <LoopButton on={v.loop} onClick={() => setClip(v.asset.id, { loop: !v.loop })} />
            {slot && <PlayButton on={on} label={slot} onClick={() => kit.play(on ? null : slot)} />}
          </div>
        );
      })}
      {videos.length < 12 && <RightsUpload kind="video" accept="video/*" kit={kit} label="Upload a clip" />}

      <p className="mt-2 text-[12px] font-semibold text-[#475467]">Ready-made, in your style</p>
      <div className="grid grid-cols-3 gap-1.5">
        {CARDS.map((c) => {
          const on = playing?.slot === c.slot;
          return (
            <button key={c.slot} type="button" onClick={() => kit.play(on ? null : c.slot)} aria-pressed={on} aria-label={on ? `Stop ${c.title}` : `Show ${c.title}`} className={`flex h-[52px] flex-col items-center justify-center gap-1 whitespace-nowrap rounded-xl border px-1 text-center text-[11.5px] font-bold leading-tight ${on ? "border-[#053877] bg-[#053877] text-white" : "border-[#e4e7ec] bg-white text-[#344054] hover:border-[#98a2b3]"}`} data-testid={`card-${c.slot}`}>
              {on ? <Square className="h-3 w-3 fill-current" /> : <Play className="h-3 w-3 fill-current text-[#053877]" />}
              {c.short}
            </button>
          );
        })}
      </div>
      <Countdown kit={kit} />
    </div>
  );
}

/** The countdown ends on "We're starting" and lights up the next scene. The host takes it; it never switches on its own. */
function Countdown({ kit }: { kit: RoomKit }) {
  const look = kit.look!;
  const [minutes, setMinutes] = useState(5);
  const playing = kit.live.playing;
  const on = playing?.slot === "countdown";
  const scenes = [...look.scenes].sort((a, b) => a.n - b.n);
  const cur = sceneLive(look, kit.live);
  const next = scenes[(scenes.findIndex((s) => s.id === cur?.id) + 1) % scenes.length];
  const nextName = look.scenes.find((s) => s.id === (on ? playing?.next : next?.id))?.name;
  return (
    <div className={`rounded-xl border px-3 py-2.5 ${on ? "border-[#053877] bg-[#f5f8fd]" : "border-[#e4e7ec]"}`} data-testid="card-countdown">
      <div className="flex items-center gap-2">
        <p className="min-w-0 flex-1 text-[13px] font-semibold">Countdown</p>
        {!on && (
          <select value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} aria-label="Minutes" className="h-8 rounded-lg border border-[#d0d5dd] bg-white px-1.5 text-[12px]">
            {[1, 2, 3, 5, 10, 15].map((m) => <option key={m} value={m}>{m} minute{m > 1 ? "s" : ""}</option>)}
          </select>
        )}
        <button type="button" onClick={() => kit.play(on ? null : "countdown", on ? undefined : { minutes, next: next?.id })} className={`h-8 rounded-lg px-3 text-[12px] font-bold ${on ? "bg-[#053877] text-white" : "border border-[#053877] text-[#053877] hover:bg-[#eef3fb]"}`} data-testid="countdown-start">{on ? "Stop" : "Start"}</button>
      </div>
      <p className="mt-1 text-[11px] leading-snug text-[#667085]">Ends on "We're starting".{nextName ? ` Then take ${nextName} when you're ready.` : ""}</p>
    </div>
  );
}

/* ── Background for the scene on stage ── */

function SceneBackground({ kit }: { kit: RoomKit }) {
  const look = kit.look!;
  const scene = sceneLive(look, kit.live);
  const bg = scene?.look?.background ?? look.background;
  const same = (a: Background, b: Background) => (a.kind === "color" && b.kind === "color" ? a.value === b.value : a.kind === "image" && b.kind === "image" && a.asset.id === b.asset.id);
  const use = (b: Background) => scene && kit.change((l) => ({ ...l, scenes: l.scenes.map((s) => (s.id === scene.id ? { ...s, look: { ...s.look, background: b } } : s)) }));
  const all = () => kit.change((l) => ({ ...l, background: bg, scenes: l.scenes.map((s) => ({ ...s, look: { ...s.look, background: bg } })) }));
  const differs = look.scenes.some((s) => !same(s.look?.background ?? look.background, bg));
  return (
    <>
      <p className="mt-1 text-[12px] text-[#667085]">For <strong className="text-[#344054]">{scene?.name ?? "this scene"}</strong>, the scene on stage</p>
      <div className="mt-2 flex flex-wrap gap-1.5" data-testid="media-background">
        {(["blue", "dark", "light"] as const).map((c) => (
          <Swatch key={c} on={same(bg, { kind: "color", value: c })} onClick={() => use({ kind: "color", value: c })} label={c[0].toUpperCase() + c.slice(1)} className="h-10 w-12" style={{ background: BACKGROUNDS[c] }} />
        ))}
        {backgroundShelf(look).map((a) => (
          <Removable key={a.id} onRemove={() => { if (window.confirm("Delete this picture?")) void kit.removeAsset("background", a.id); }}>
            <Swatch on={same(bg, { kind: "image", asset: a })} onClick={() => use({ kind: "image", asset: a })} label={`Use ${a.name || "this picture"}`} className="h-10 w-12" style={{ background: `center / cover url("${a.url}")` }} />
          </Removable>
        ))}
        {backgroundShelf(look).length < LIMITS.backgrounds && <AddFile kind="background" accept="image/png,image/jpeg,image/webp" kit={kit} label="Add a picture" className="h-10 w-10" onAdded={(a) => use({ kind: "image", asset: a })} />}
      </div>
      {look.scenes.length > 1 && (differs
        ? <button type="button" onClick={all} className="mt-2 self-start text-[12px] font-semibold text-[#053877] hover:underline" data-testid="background-all">Use on all scenes</button>
        : <p className="mt-2 text-[12px] text-[#98a2b3]">All your scenes use this background.</p>)}
    </>
  );
}

/* ── Sounds and music ── */

/** Our CC0 / public-domain library (only items with a full licence line are listed; it can be empty). */
function useLibrary() {
  return useQuery<{ items: LibraryItem[] }>({ queryKey: ["/api/host/room/library"], staleTime: 300_000, retry: false, queryFn: async () => (await apiRequest("GET", "/api/host/room/library")).json() }).data?.items ?? [];
}
const LIMIT = 12;

/** "Title · Artist · CC0 1.0 · source", with source opening the item's own page. */
function SourceLine({ s, name }: { s?: LibrarySource; name: string }) {
  if (!s) return <>Your upload</>;
  return <>{s.title && s.title !== name ? `${s.title} · ` : ""}{s.artist} · {s.licence} · <a href={s.page} target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-[#053877]">source</a></>;
}

/** Add one of our library items that isn't in the studio yet. */
function AddFromLibrary({ items, onAdd, what }: { items: LibraryItem[]; onAdd: (x: LibraryItem) => void; what: string }) {
  const [open, setOpen] = useState(false);
  if (!items.length) return null;
  if (!open) return <button type="button" onClick={() => setOpen(true)} className="flex h-10 w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-[#98a2b3] bg-white text-[13px] font-semibold text-[#475467] hover:bg-[#f9fafb]" data-testid={`library-${what}`}><Plus className="h-4 w-4" /> Add free {what}</button>;
  return (
    <div className="rounded-xl border border-[#e4e7ec] bg-[#fcfcfd] p-1.5" data-testid={`library-${what}-list`}>
      {items.map((x) => (
        <button key={x.id} type="button" onClick={() => { onAdd(x); if (items.length === 1) setOpen(false); }} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-white">
          <Plus className="h-3.5 w-3.5 shrink-0 text-[#053877]" />
          <span className="min-w-0 flex-1"><span className="block truncate text-[13px] font-semibold">{x.name}</span><span className="block truncate text-[11px] text-[#667085]">{x.source.artist} · {x.source.licence}</span></span>
        </button>
      ))}
      <button type="button" onClick={() => setOpen(false)} className="mt-1 h-8 w-full text-[12px] font-semibold text-[#475467]">Done</button>
    </div>
  );
}

function Sounds({ kit }: { kit: RoomKit }) {
  const look = kit.look!;
  const pads = look.sounds ?? [];
  const lib = useLibrary().filter((x) => x.kind === "sound" && !pads.some((p) => p.id === x.id));
  const [flash, setFlash] = useState("");
  const hit = (id: string) => { kit.playSound(id); setFlash(id); window.setTimeout(() => setFlash((f) => (f === id ? "" : f)), 700); };
  const drop = (x: SoundItem) => {
    if (!window.confirm(`Take ${x.name || "this sound"} off your pads?`)) return;
    if (x.source) kit.change((l) => ({ ...l, sounds: (l.sounds ?? []).filter((p) => p.id !== x.id) }));
    else void kit.removeAsset("sound", x.asset.id);
  };
  return (
    <div className="mt-2.5 flex flex-col gap-2" data-testid="media-sounds">
      {pads.length > 0 ? (
        <div className="grid grid-cols-3 gap-1.5">
          {pads.map((x) => (
            <div key={x.id} className="group relative">
              <button type="button" onClick={() => hit(x.id)} title={x.source ? `${x.source.title} · ${x.source.artist} · ${x.source.licence}` : "Your upload"} className={`flex h-12 w-full items-center justify-center rounded-xl border px-1.5 text-center text-[12px] font-bold leading-tight transition-colors ${flash === x.id ? "border-[#053877] bg-[#053877] text-white" : "border-[#e4e7ec] bg-white text-[#344054] hover:border-[#98a2b3]"}`} data-testid="sound-pad">{x.name || "Sound"}</button>
              <DeleteDot onClick={() => drop(x)} />
            </div>
          ))}
        </div>
      ) : <p className="rounded-xl bg-[#f9fafb] px-3 py-2.5 text-[12px] text-[#667085]">No sounds yet. Upload one, and it becomes a pad you press on air.</p>}
      {pads.length > 0 && <Volume value={Math.round((look.soundVolume ?? 0.8) * 100)} onChange={(v) => kit.change((l) => ({ ...l, soundVolume: v / 100 }))} />}
      {pads.some((x) => x.source) && <p className="text-[11px] text-[#98a2b3]">Free sounds from {pads.filter((x) => x.source).map((x) => x.source!.site).filter((v, i, a) => a.indexOf(v) === i).join(", ")}, each {pads.find((x) => x.source)!.source!.licence}. Hover a pad for its source.</p>}
      {pads.length < LIMIT && <AddFromLibrary items={lib} what="sounds" onAdd={(x) => kit.change((l) => ({ ...l, sounds: [...(l.sounds ?? []), { id: x.id, name: x.name, asset: x.asset, source: x.source }].slice(0, LIMIT) }))} />}
      {pads.length < LIMIT && <RightsUpload kind="sound" accept="audio/*" kit={kit} label="Upload a sound" />}
      <p className="text-[12px] leading-snug text-[#667085]">{EVERYONE}</p>
    </div>
  );
}

function MusicList({ kit }: { kit: RoomKit }) {
  const look = kit.look!;
  const tracks = look.music ?? [];
  const lib = useLibrary().filter((x) => x.kind === "music" && !tracks.some((t) => t.id === x.id));
  const now = kit.live.music?.id ?? null;
  const loop = look.musicLoop !== false;
  const drop = (x: MusicItem) => {
    if (!window.confirm(`Take ${x.name || "this track"} off your list?`)) return;
    if (x.source) kit.change((l) => ({ ...l, music: (l.music ?? []).filter((t) => t.id !== x.id) }));
    else void kit.removeAsset("music", x.asset.id);
  };
  return (
    <div className="mt-2.5 flex flex-col gap-2" data-testid="media-music">
      {tracks.map((x) => {
        const on = now === x.id;
        return (
          <div key={x.id} className={`group flex items-center gap-2 rounded-xl border px-2 py-2 ${on ? "border-[#053877] bg-[#f5f8fd]" : "border-[#e4e7ec]"}`} data-testid="music-row">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[7px] bg-[#eef3fb] text-[#053877]"><Music2 className="h-3.5 w-3.5" /></div>
            <div className="min-w-0 flex-1"><p className="truncate text-[13px] font-semibold">{x.name || "Track"}</p><p className="truncate text-[11px] text-[#667085]">{on ? "Playing now" : <SourceLine s={x.source} name={x.name} />}</p></div>
            {!on && <button type="button" onClick={() => drop(x)} aria-label="Remove track" className="hidden shrink-0 text-[#98a2b3] hover:text-[#b42318] group-focus-within:block group-hover:block"><Trash2 className="h-4 w-4" /></button>}
            <PlayButton on={on} label={x.name || "this track"} onClick={() => kit.playMusic(on ? null : x.id)} />
          </div>
        );
      })}
      {tracks.length > 0 && (
        <div className="flex items-center gap-3">
          <div className="flex-1"><Volume value={Math.round((look.musicVolume ?? 0.25) * 100)} onChange={(v) => kit.change((l) => ({ ...l, musicVolume: v / 100 }))} /></div>
          <LoopButton on={loop} onClick={() => kit.change((l) => ({ ...l, musicLoop: !loop }))} />
        </div>
      )}
      {tracks.length < LIMIT && <AddFromLibrary items={lib} what="music" onAdd={(x) => kit.change((l) => ({ ...l, music: [...(l.music ?? []), { id: x.id, name: x.name, asset: x.asset, source: x.source }].slice(0, LIMIT) }))} />}
      {tracks.length < LIMIT && <RightsUpload kind="music" accept="audio/*" kit={kit} label="Upload your own music" />}
      <p className="text-[12px] leading-snug text-[#667085]">Music dips while someone talks. Everyone in your studio hears it.</p>
    </div>
  );
}

/* ── Small parts ── */

/** Their own clip, sound or music: they tick "I have the rights to use this" before choosing the file. */
function RightsUpload({ kind, accept, kit, label: l }: { kind: AssetKind; accept: string; kit: RoomKit; label: string }) {
  const { toast } = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [rights, setRights] = useState(false);
  const [pct, setPct] = useState<number | null>(null);
  const pick = async (f?: File) => {
    if (!f) return;
    setPct(0);
    try { await kit.addAsset(kind, f, setPct, true); setOpen(false); }
    catch (e) { toast({ title: "Couldn't add that file", description: (e as Error).message, variant: "destructive" }); }
    finally { setPct(null); if (input.current) input.current.value = ""; }
  };
  if (pct !== null) return <div className="flex h-10 items-center justify-center gap-1.5 rounded-xl border border-dashed border-[#d0d5dd] text-[13px] font-semibold text-[#667085]"><Loader2 className="h-4 w-4 animate-spin" /> {pct}%</div>;
  if (!open) return <button type="button" onClick={() => setOpen(true)} className="flex h-10 w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-[#98a2b3] bg-white text-[13px] font-semibold text-[#475467] hover:bg-[#f9fafb]" data-testid={`upload-${kind}`}><Plus className="h-4 w-4" /> {l}</button>;
  return (
    <div className="rounded-xl border border-[#e4e7ec] bg-[#fcfcfd] p-3" data-testid={`upload-${kind}-rights`}>
      <input ref={input} type="file" accept={accept} className="hidden" onChange={(e) => void pick(e.target.files?.[0])} />
      <label className="flex items-start gap-2 text-[13px] font-semibold text-[#344054]">
        <input type="checkbox" checked={rights} onChange={(e) => setRights(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[#053877]" data-testid="rights-tick" />
        I have the rights to use this
      </label>
      <div className="mt-2.5 flex items-center gap-2">
        <button type="button" disabled={!rights} onClick={() => input.current?.click()} className="h-9 rounded-lg bg-[#053877] px-3.5 text-[13px] font-bold text-white disabled:opacity-40">Choose a file</button>
        <button type="button" onClick={() => setOpen(false)} className="h-9 px-2 text-[13px] font-semibold text-[#475467]">Cancel</button>
      </div>
    </div>
  );
}

function PlayButton({ on, label: l, onClick }: { on: boolean; label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} aria-label={on ? `Stop ${l}` : `Play ${l}`} title={on ? "Stop" : "Play"} className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${on ? "bg-[#053877] text-white" : "border border-[#053877] text-[#053877] hover:bg-[#eef3fb]"}`}>
      {on ? <Square className="h-3 w-3 fill-current" /> : <Play className="h-3.5 w-3.5 translate-x-px fill-current" />}
    </button>
  );
}

function LoopButton({ on, onClick }: { on: boolean; onClick: () => void }) {
  return <button type="button" onClick={onClick} aria-pressed={on} aria-label="Loop" title={on ? "Loops" : "Plays once"} className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${on ? "bg-[#eef3fb] text-[#053877]" : "text-[#98a2b3] hover:bg-[#f2f4f7]"}`}><Repeat className="h-4 w-4" /></button>;
}

function Volume({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <label className="mt-2 flex items-center gap-2 text-[12px] text-[#475467]">
      <Volume2 className="h-4 w-4 shrink-0" aria-hidden /><span className="sr-only">Volume</span>
      <input type="range" min={0} max={100} value={value} onChange={(e) => onChange(Number(e.target.value))} className="h-1 flex-1 accent-[#053877]" />
      <span className="w-7 text-right tabular-nums">{value}</span>
    </label>
  );
}

function DeleteDot({ onClick }: { onClick: () => void }) {
  return <button type="button" onClick={onClick} aria-label="Delete" className="absolute -right-1.5 -top-1.5 hidden h-5 w-5 items-center justify-center rounded-full bg-white text-[#475467] shadow ring-1 ring-[#e4e7ec] hover:text-[#b42318] group-hover:flex"><Trash2 className="h-3 w-3" /></button>;
}
