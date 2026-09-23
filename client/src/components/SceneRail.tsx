import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { formatTimeInZone } from "@/lib/schedule";
import type { SceneRow, RunItemRow, SignupRow } from "@shared/schema";
import {
  Video,
  Film,
  Image as ImageIcon,
  Timer,
  Plus,
  X,
  Search,
  GripVertical,
  Pencil,
  ListOrdered,
  Clapperboard,
  Check,
  Captions,
  ArrowRight,
  MoreVertical,
  Copy,
  ClipboardPaste,
  CopyPlus,
  Trash2,
  PlayCircle,
  Users,
} from "lucide-react";
import { Switch } from "@/components/ui/switch";

// The scene rail: the whole show, top to bottom, one press per cut.
//
// It replaced the run-of-show list that used to sit under it. Two lists that
// both claimed to be "what's next" meant a producer had to hold in their head
// which one the buttons were wired to — so the agenda's times moved onto the
// cards and the second list went away. A scene made from an agenda row still
// takes that row when pressed: same people moves, same media.

export interface SceneSpec {
  name: string;
  kind: "camera" | "media" | "countdown";
  mediaUrl?: string;
  mediaKind?: "video" | "image";
  mediaLabel?: string;
  countdownSeconds?: number;
  /** Set when the scene came from an agenda row, so taking it takes the row. */
  startAtUtc?: string;
  runItemId?: number;
  /** The lower third this scene puts on air when it is taken. */
  bannerTitle?: string;
  bannerSubtitle?: string;
  thumbUrl?: string;
  /** Take the next scene when this one's clip ends. */
  autoNext?: boolean;
  /** Keep the people on screen beside the clip. */
  withPeople?: boolean;
  /** Duplicate and paste: put the new scene right under this one. */
  afterId?: number;
}

/** The scene clipboard, kept in the browser so a copy survives a reload or crosses tabs. */
const CLIP_KEY = "mv-scene-clipboard";
function specOf(sc: SceneRow): SceneSpec {
  return {
    name: sc.name,
    kind: (sc.kind as SceneSpec["kind"]) || "camera",
    mediaUrl: sc.mediaUrl,
    mediaKind: (sc.mediaKind as "video" | "image") || "video",
    mediaLabel: sc.mediaLabel,
    countdownSeconds: sc.countdownSeconds,
    bannerTitle: sc.bannerTitle,
    bannerSubtitle: sc.bannerSubtitle,
    thumbUrl: sc.thumbUrl || undefined,
    autoNext: sc.autoNext,
    withPeople: sc.withPeople,
  };
}
function readClip(): SceneSpec | null {
  try { const v = localStorage.getItem(CLIP_KEY); return v ? (JSON.parse(v) as SceneSpec) : null; } catch { return null; }
}
const MOD = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl";

export interface MediaChoice {
  id: number;
  label: string;
  kind: "image" | "video";
  url: string;
  owner: string;
}

/** What a scene puts on the stage, for the badge and the empty thumbnail. */
function kindOf(sc: SceneRow): "camera" | "media" | "countdown" {
  if (sc.kind === "countdown") return "countdown";
  // Scenes made before kinds existed carry media with kind "camera".
  return sc.mediaUrl ? "media" : "camera";
}

/** A YouTube link plays in a frame, not a <video>, so it gets no still. */
function youtubeId(url: string): string | null {
  const m = url.match(/(?:youtu\.be\/|v=|\/embed\/|\/shorts\/)([A-Za-z0-9_-]{11})/);
  return m ? m[1] : null;
}

function isImage(sc: SceneRow): boolean {
  return sc.mediaKind === "image" || /\.(jpe?g|png|webp|gif|svg)(\?|$)/i.test(sc.mediaUrl);
}

export function sceneKindLabel(sc: SceneRow): string {
  const k = kindOf(sc);
  if (k === "countdown") return `${Math.round(sc.countdownSeconds / 60)} min clock`;
  if (k === "media") {
    const secs = (sc as { mediaSeconds?: number }).mediaSeconds ?? 0;
    const base = sc.mediaLabel || (isImage(sc) ? "Image" : "Clip");
    return secs ? `${base} · ${Math.floor(secs / 3600) ? `${Math.floor(secs / 3600)}:${String(Math.floor((secs % 3600) / 60)).padStart(2, "0")}:${String(secs % 60).padStart(2, "0")}` : `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`}` : base;
  }
  return "Cameras";
}

export function SceneRail({
  scenes,
  currentSceneId,
  zone,
  runItems,
  signups,
  presentNames,
  media,
  busy,
  readOnly = false,
  takeOnly = false,
  anchorToLive = true,
  searchable = false,
  onApply,
  onAdd,
  onPatch,
  onDelete,
  onReorder,
  onGenerate,
}: {
  scenes: SceneRow[];
  currentSceneId: number;
  zone: string;
  runItems: RunItemRow[];
  signups: SignupRow[];
  /** Display names in the green room, for the "have they arrived" dot. */
  presentNames: string[];
  media: MediaChoice[];
  busy?: boolean;
  /** Podcasters see the rail; only a producer changes it. */
  readOnly?: boolean;
  /** Crew in the green room: they can take, not edit. */
  takeOnly?: boolean;
  /** Off air the rail reads from the top; on air it pins the live card. */
  anchorToLive?: boolean;
  /** Producers get a filter. 146 scenes is not a list you scroll on a question. */
  searchable?: boolean;
  onApply: (id: number) => void;
  onAdd: (spec: SceneSpec) => void;
  onPatch: (id: number, patch: Partial<SceneSpec>) => void;
  onDelete: (id: number) => void;
  onReorder: (ids: number[]) => void;
  onGenerate: () => void;
}) {
  const [query, setQuery] = useState("");
  const [addKind, setAddKind] = useState<null | "media" | "countdown">(null);
  const [agendaOpen, setAgendaOpen] = useState(false);
  const [renaming, setRenaming] = useState<number | null>(null);
  // The ⋮ menu that is open, the scene under the pointer (what ⌘C/⌘V/⌘D act
  // on, as in Restream), and whatever was last copied.
  const [menuFor, setMenuFor] = useState<number | null>(null);
  const [hoverId, setHoverId] = useState<number | null>(null);
  const [clip, setClip] = useState<SceneSpec | null>(() => readClip());
  const copyScene = (sc: SceneRow) => {
    const spec = specOf(sc);
    setClip(spec);
    try { localStorage.setItem(CLIP_KEY, JSON.stringify(spec)); } catch { /* private window */ }
  };
  const pasteAfter = (sc: SceneRow | null) => {
    const spec = clip ?? readClip();
    if (!spec) return;
    onAdd({ ...spec, afterId: sc?.id });
  };
  const duplicateScene = (sc: SceneRow) => onAdd({ ...specOf(sc), name: `${sc.name} (copy)`.slice(0, 60), afterId: sc.id });
  const deleteScene = (sc: SceneRow) => onDelete(sc.id);
  const [bannering, setBannering] = useState<number | null>(null);
  const [bannerDraft, setBannerDraft] = useState({ title: "", sub: "" });
  const [draft, setDraft] = useState("");
  const liveRef = useRef<HTMLDivElement | null>(null);
  const railRef = useRef<HTMLDivElement | null>(null);

  const liveIndex = scenes.findIndex((s) => s.id === currentSceneId);
  const editable = !readOnly && !takeOnly;

  // Put the scene on air at the top of the rail, with what is coming
  // underneath it.
  //
  // `scrollIntoView({ block: "nearest" })` did the least work that counted as
  // "visible", which on a rail this long means the live card lands wherever it
  // happens to be — usually the bottom edge, with the whole column above it
  // showing shows that have already been and gone. What anybody reads this for
  // is what is next, so the live card is pinned to the top and the future
  // fills the rest. Scrolling the container rather than calling scrollIntoView
  // keeps the page itself still: `block: "start"` would drag the whole window
  // up to satisfy the request.
  const anchored = useRef(false);
  // A scene just added lands at the top: show it there, lit for a moment,
  // instead of the rail jumping back to whatever is live.
  const knownIds = useRef<Set<number> | null>(null);
  const [justAdded, setJustAdded] = useState<number | null>(null);
  const skipAnchor = useRef(false);
  useEffect(() => {
    const ids = new Set(scenes.map((sc) => sc.id));
    const prev = knownIds.current;
    knownIds.current = ids;
    if (!prev) return;
    const fresh = scenes.find((sc) => !prev.has(sc.id));
    if (!fresh) return;
    skipAnchor.current = true;
    setJustAdded(fresh.id);
    requestAnimationFrame(() => {
      const box = railRef.current;
      const card = box?.querySelector(`[data-scene-id="${fresh.id}"]`) as HTMLElement | null;
      if (box && card) box.scrollTo({ top: Math.max(0, card.offsetTop - box.offsetTop - 8), behavior: "smooth" });
    });
    const t = window.setTimeout(() => setJustAdded(null), 2600);
    return () => window.clearTimeout(t);
  }, [scenes]);

  // Drag a card onto another to put it there.
  const [dragId, setDragId] = useState<number | null>(null);
  const [overId, setOverId] = useState<number | null>(null);
  function dropOn(targetId: number) {
    if (dragId == null || dragId === targetId) return;
    const order = scenes.map((sc) => sc.id).filter((id) => id !== dragId);
    const from = scenes.findIndex((sc) => sc.id === dragId);
    const to = scenes.findIndex((sc) => sc.id === targetId);
    const at = order.indexOf(targetId);
    // Dropped on a card below where it was: goes after it. Above: before it.
    order.splice(from < to ? at + 1 : at, 0, dragId);
    onReorder(order);
  }

  useEffect(() => {
    // A frame later, so the measurement is taken against a laid-out rail
    // rather than the one React has only just described.
    // Checked again over the first second rather than once. A single frame
    // is one guess at when the rail has settled, and when it guesses wrong it
    // gives up silently and leaves you at the top of a ninety-eight scene
    // list — which looks exactly like a rail that was never meant to move.
    let raf = 0;
    const timers: number[] = [];
    const anchor = () => {
      const box = railRef.current;
      if (!box) return;
      // Nothing on air yet — before the day starts, or between programmes —
      // and the rail reads from the top: scene one is what is coming first.
      // Anchoring to a live card that does not exist left it wherever the
      // last render put it.
      if (liveIndex < 0 || !anchorToLive) {
        if (box.scrollTop > 0) box.scrollTo({ top: 0, behavior: anchored.current ? "smooth" : "auto" });
        anchored.current = true;
        return;
      }
      const el = liveRef.current;
      if (!el) return;
      const delta = el.getBoundingClientRect().top - box.getBoundingClientRect().top;
      if (Math.abs(delta - 8) < 2) return;
      box.scrollTo({
        top: Math.max(0, box.scrollTop + delta - 8),
        // Arriving is a jump; moving on is a journey. Scene forty-one of
        // ninety-eight sits seven thousand pixels down, and smooth-scrolling
        // that on arrival is both an animation nobody asked to watch and one
        // the browser abandons the moment anything else re-renders — which is
        // how the rail kept ending up back at the top.
        behavior: anchored.current ? "smooth" : "auto",
      });
      anchored.current = true;
    };
    if (skipAnchor.current) {
      skipAnchor.current = false;
      return;
    }
    raf = requestAnimationFrame(() => {
      anchor();
      for (const ms of [120, 400, 900]) timers.push(window.setTimeout(anchor, ms));
    });
    return () => {
      cancelAnimationFrame(raf);
      for (const t of timers) window.clearTimeout(t);
    };
  }, [currentSceneId, liveIndex, scenes.length]);

  // 1–9 take a scene. Guarded against anything typed into a field, so renaming
  // a scene called "Segment 3" doesn't cut the programme to scene 3.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (readOnly) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName))) return;
      const n = Number(e.key);
      if (!Number.isInteger(n) || n < 1 || n > 9) return;
      const sc = scenes[n - 1];
      if (sc) {
        e.preventDefault();
        onApply(sc.id);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [scenes, onApply, readOnly]);

  // ⌘C / ⌘V / ⌘D / ⌫ on the scene under the pointer. Never while typing, and
  // ⌘C leaves a real text selection alone so copying words still works.
  useEffect(() => {
    if (readOnly || takeOnly) return;
    function onKey(e: KeyboardEvent) {
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName))) return;
      const sc = scenes.find((x) => x.id === hoverId);
      const mod = e.metaKey || e.ctrlKey;
      const k = e.key.toLowerCase();
      if (mod && k === "c" && sc && !String(window.getSelection() ?? "")) { e.preventDefault(); copyScene(sc); }
      else if (mod && k === "v" && (clip ?? readClip())) { e.preventDefault(); pasteAfter(sc ?? null); }
      else if (mod && k === "d" && sc) { e.preventDefault(); duplicateScene(sc); }
      else if (!mod && (e.key === "Backspace" || e.key === "Delete") && sc) {
        e.preventDefault();
        if (window.confirm(`Delete the scene "${sc.name}"?`)) deleteScene(sc);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scenes, hoverId, clip, readOnly, takeOnly]);


  const nextScene = liveIndex >= 0 ? scenes[liveIndex + 1] : scenes[0];

  /**
   * Filter by anything you'd actually say out loud.
   *
   * "Do you have my video loaded?" is asked by name, and the name is not
   * always in the scene's title — a run-of-show item carries the show name,
   * and the media scene under it may just be called "Clip". So the scene's
   * name, its kind, and the agenda item it belongs to are all searched, which
   * means typing a podcaster's name finds their intro, their segment and
   * their handoff rather than only whichever one happens to be titled.
   */
  const runById = useMemo(() => new Map(runItems.map((r) => [r.id, r])), [runItems]);
  const q = query.trim().toLowerCase();
  const shown = useMemo(() => {
    if (!q) return scenes.map((sc, i) => ({ sc, i }));
    return scenes
      .map((sc, i) => ({ sc, i }))
      .filter(({ sc }) => {
        const run = sc.runItemId ? runById.get(sc.runItemId) : undefined;
        return [sc.name, sc.kind, run?.title, run?.notes]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(q));
      });
  }, [scenes, q, runById]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between gap-2 px-3 py-2">
        <span className="flex items-center gap-1.5 text-[12px] font-bold uppercase tracking-[0.14em] text-white/55">
          <Clapperboard className="h-3.5 w-3.5" /> Scenes
          <span className="rounded-full bg-white/10 px-2 py-0.5 text-white/80">{scenes.length}</span>
        </span>
        {!editable ? null : (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 gap-1 rounded-full px-2.5 text-[12px] font-semibold text-white/70 hover:bg-white/10 hover:text-white"
              data-testid="button-add-scene"
            >
              <Plus className="h-3.5 w-3.5" /> Add scene
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuItem onClick={() => onAdd({ name: "New camera scene", kind: "camera" })} data-testid="menu-add-camera">
              <Video className="mr-2 h-3.5 w-3.5" /> Camera
              <span className="ml-auto text-[11px] text-muted-foreground">whoever's on stage</span>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setAddKind("media")} data-testid="menu-add-media">
              <Film className="mr-2 h-3.5 w-3.5" /> Media
              <span className="ml-auto text-[11px] text-muted-foreground">clip or slide</span>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setAddKind("countdown")} data-testid="menu-add-countdown">
              <Timer className="mr-2 h-3.5 w-3.5" /> Countdown
              <span className="ml-auto text-[11px] text-muted-foreground">break clock</span>
            </DropdownMenuItem>
            {runItems.length > 0 && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => setAgendaOpen(true)}>
                  <ListOrdered className="mr-2 h-3.5 w-3.5" /> From the agenda…
                </DropdownMenuItem>
                <DropdownMenuItem onClick={onGenerate}>
                  <Clapperboard className="mr-2 h-3.5 w-3.5" /> Build the whole agenda
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
        )}
      </div>

      {searchable && scenes.length > 8 && (
        <div className="px-3 pb-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-white/35" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Find a scene or a name…"
              className="w-full rounded-lg border border-white/15 bg-white/[0.06] py-1.5 pl-8 pr-8 text-sm text-white outline-none placeholder:text-white/35 focus:border-[#F0A71F]/60"
              data-testid="input-scene-search"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                aria-label="Clear the search"
                className="absolute right-2 top-1/2 -translate-y-1/2 text-white/40 hover:text-white"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          {q && (
            <p className="mt-1.5 text-[11px] text-white/45">
              {shown.length === 0
                ? "Nothing matches — try part of a show name."
                : `${shown.length} of ${scenes.length} scenes`}
            </p>
          )}
        </div>
      )}

      <div ref={railRef} className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 pb-3" data-testid="scene-rail">
        {scenes.length === 0 && (
          <div className="rounded-xl border border-dashed border-white/15 p-4 text-center">
            <p className="text-xs text-white/60">No scenes yet.</p>
            {runItems.length > 0 ? (
              <Button
                size="sm"
                variant="ghost"
                className="mt-2 h-7 rounded-full text-[12px] text-[#F0A71F] hover:bg-white/10"
                onClick={onGenerate}
                data-testid="button-build-from-agenda"
              >
                Build them from the agenda
              </Button>
            ) : (
              <p className="mt-1 text-[11px] text-white/40">Add one above — a camera, a clip, or a break clock.</p>
            )}
          </div>
        )}

        {shown.map(({ sc, i }) => {
          const on = sc.id === currentSceneId;
          const k = kindOf(sc);
          const sg = sc.runItemId
            ? signups.find((x) => x.id === runItems.find((r) => r.id === sc.runItemId)?.signupId)
            : undefined;
          // A camera scene has nothing to show until it is on air, and a rail of
          // identical grey rectangles with a camera glyph makes a producer read
          // every title to find the one they want. The podcaster's own picture
          // is already here for the presence dot, so the card wears it: at a
          // hundred and forty-six scenes, recognising a face is faster than
          // reading a line of text.
          const sceneImage = k === "media" && isImage(sc) ? sc.mediaUrl : null;
          // A scene that rolls a file shows the file: a frame from the
          // episode, not the host's headshot, so the producer can tell a
          // pre-recorded segment from a live one at a glance.
          const sceneVideo = k === "media" && !isImage(sc) && !youtubeId(sc.mediaUrl) ? sc.mediaUrl : null;
          const thumb = sc.thumbUrl || sceneImage || (sceneVideo ? null : sg?.photoUrl) || null;
          const isFace = !sc.thumbUrl && !sceneImage && !!thumb;
          const norm = (v: string) => v.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
          const here = sg
            ? presentNames.some(
                (n) => norm(n).length > 2 && (norm(sg.hostName).includes(norm(n)) || norm(n).includes(norm(sg.hostName))),
              )
            : false;

          return (
            <div
              key={sc.id}
              ref={on ? liveRef : undefined}
              data-scene-id={sc.id}
              draggable={editable && renaming !== sc.id}
              onDragStart={(e) => { setDragId(sc.id); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", String(sc.id)); }}
              onDragOver={(e) => { if (dragId == null) return; e.preventDefault(); e.dataTransfer.dropEffect = "move"; if (overId !== sc.id) setOverId(sc.id); }}
              onDragLeave={() => setOverId((o) => (o === sc.id ? null : o))}
              onDrop={(e) => { e.preventDefault(); dropOn(sc.id); setDragId(null); setOverId(null); }}
              onDragEnd={() => { setDragId(null); setOverId(null); }}
              onMouseEnter={() => setHoverId(sc.id)}
              onMouseLeave={() => setHoverId((h) => (h === sc.id ? null : h))}
              className={`group relative rounded-xl transition-all ${editable ? "cursor-grab active:cursor-grabbing" : ""} ${dragId === sc.id ? "opacity-40" : ""} ${overId === sc.id && dragId !== sc.id ? "ring-2 ring-[#F0A71F] ring-offset-2 ring-offset-[#000741]" : ""} ${justAdded === sc.id ? "ring-2 ring-emerald-400 ring-offset-2 ring-offset-[#000741]" : ""}`}
            >
              <button
                type="button"
                disabled={busy || readOnly}
                onClick={() => !readOnly && onApply(sc.id)}
                className={`relative block w-full overflow-hidden rounded-xl border-2 text-left transition-all disabled:opacity-60 ${
                  on
                    ? "border-[#F0A71F] shadow-[0_0_0_3px_rgba(240,167,31,0.18)]"
                    : "border-white/10 hover:border-white/35"
                }`}
                data-testid={`button-scene-${sc.id}`}
              >
                <div className="relative w-full" style={{ aspectRatio: "16/9" }}>
                  {sceneVideo ? (
                    <>
                      {/* On air, the card plays: what the producer sees on the
                          monitor is what the rail shows, so a glance at the
                          rail says the episode is rolling. Off air, a frame. */}
                      {/* Off air, a thumbnail set on the scene wins over the
                          file's first second, which for a promo that fades in
                          is just black. */}
                      {!on && sc.thumbUrl ? (
                        <img src={sc.thumbUrl} alt="" loading="lazy" className="absolute inset-0 h-full w-full object-cover" />
                      ) : (
                        <video
                          key={on ? "playing" : "still"}
                          src={on ? sceneVideo : `${sceneVideo}#t=1`}
                          muted
                          playsInline
                          autoPlay={on}
                          preload="metadata"
                          className="absolute inset-0 h-full w-full object-cover"
                        />
                      )}
                      <span className="absolute left-2 top-2 rounded-md bg-black/70 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">{on ? "▶ Video" : "Video"}</span>
                    </>
                  ) : thumb ? (
                    <>
                      <img
                        src={thumb}
                        alt=""
                        // A headshot cropped to 16:9 down the middle takes the
                        // chin and loses the eyes, so a face sits high.
                        className={`absolute inset-0 h-full w-full object-cover ${
                          isFace ? "object-[50%_28%]" : ""
                        }`}
                      />
                      {isFace && (
                        <div className="absolute inset-0 bg-gradient-to-t from-black/45 via-transparent to-black/25" />
                      )}
                      {isFace && k === "camera" && (
                        <span className={`absolute left-2 top-2 rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${here ? "bg-emerald-500 text-white" : "bg-black/70 text-white"}`}>
                          {here ? "Live · here" : "Live"}
                        </span>
                      )}
                    </>
                  ) : (
                    <div
                      className="absolute inset-0 flex items-center justify-center"
                      style={{ background: "linear-gradient(135deg,#0a1628 0%,#1a2a4a 100%)" }}
                    >
                      {k === "countdown" ? (
                        <span className="text-2xl font-bold tabular-nums text-white/45">
                          {Math.floor(sc.countdownSeconds / 60)}:{String(sc.countdownSeconds % 60).padStart(2, "0")}
                        </span>
                      ) : k === "media" ? (
                        <Film className="h-6 w-6 text-white/30" />
                      ) : (
                        <Video className="h-6 w-6 text-white/30" />
                      )}
                    </div>
                  )}

                  {/* Shortcut number, so the keys and the rail agree. */}
                  {i < 9 && (
                    <span className="absolute left-1.5 top-1.5 rounded bg-black/55 px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-white/80">
                      {i + 1}
                    </span>
                  )}
                  {on && (
                    <span className="absolute right-1.5 top-1.5 rounded bg-[#F0A71F] px-1.5 py-0.5 text-[9px] font-black uppercase leading-none text-[#1a1200]">
                      On air
                    </span>
                  )}
                  {/* This scene brings a name bar with it. Worth knowing at a
                      glance, because taking it changes what is on screen
                      beyond the picture. */}
                  {sc.bannerTitle && !on && (
                    <span
                      className="absolute right-1.5 top-1.5 rounded bg-black/55 p-1 text-white/75"
                      title={`Lower third: ${sc.bannerTitle}`}
                    >
                      <Captions className="h-3 w-3" />
                    </span>
                  )}

                  <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 to-transparent px-2 pb-1.5 pt-6">
                    <div className="flex items-end gap-1.5">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[13px] font-semibold leading-tight text-white">{sc.name}</p>
                        <p className="flex items-center gap-1 truncate text-[11px] leading-tight text-white/60">
                          {sc.startAtUtc && (
                            <span className="tabular-nums text-[#F0A71F]">
                              {formatTimeInZone(new Date(sc.startAtUtc), zone)}
                            </span>
                          )}
                          {sc.startAtUtc && <span className="opacity-40">·</span>}
                          {k === "countdown" ? (
                            <Timer className="h-2.5 w-2.5" />
                          ) : k === "media" ? (
                            isImage(sc) ? (
                              <ImageIcon className="h-2.5 w-2.5" />
                            ) : (
                              <Film className="h-2.5 w-2.5" />
                            )
                          ) : (
                            <Video className="h-2.5 w-2.5" />
                          )}
                          <span className="truncate">{sceneKindLabel(sc)}</span>
                        </p>
                      </div>
                      {sg && (
                        <span
                          className="relative shrink-0"
                          title={here ? `${sg.hostName} is in the green room` : `${sg.hostName} hasn't arrived`}
                        >
                          {sg.photoUrl ? (
                            <img src={sg.photoUrl} alt="" className="h-7 w-7 rounded-full object-cover ring-1 ring-white/25" />
                          ) : (
                            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-white/15 text-[10px] font-bold text-white">
                              {(sg.hostName || "?").slice(0, 1).toUpperCase()}
                            </span>
                          )}
                          <span
                            className={`absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full ring-2 ring-[#000741] ${
                              here ? "bg-emerald-400" : "bg-white/30"
                            }`}
                          />
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </button>

              {/* One ⋮ menu per scene, as Restream has it: out of the way until
                  wanted, because this is a surface you press during a show. */}
              <div className={`absolute right-1.5 top-8 ${editable ? "" : "hidden"} ${menuFor === sc.id ? "" : "opacity-0 group-hover:opacity-100"} transition-opacity`}>
                <DropdownMenu open={menuFor === sc.id} onOpenChange={(v) => setMenuFor(v ? sc.id : null)}>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      aria-label={`Options for ${sc.name}`}
                      className="flex h-7 w-7 items-center justify-center rounded-md bg-black/70 text-white/85 transition-colors hover:bg-black/90 hover:text-white"
                      data-testid={`button-scene-menu-${sc.id}`}
                    >
                      <MoreVertical className="h-4 w-4" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" side="right" className="w-64">
                    <MenuRow icon={Pencil} label="Rename" onSelect={() => { setRenaming(sc.id); setDraft(sc.name); }} />
                    <MenuRow
                      icon={Captions}
                      label={sc.bannerTitle ? "Edit the lower third" : "Add a lower third"}
                      onSelect={() => { setBannering(sc.id); setBannerDraft({ title: sc.bannerTitle ?? "", sub: sc.bannerSubtitle ?? "" }); }}
                    />
                    <DropdownMenuSeparator />
                    <MenuRow icon={Copy} label="Copy" keys={[MOD, "C"]} onSelect={() => copyScene(sc)} />
                    <MenuRow icon={ClipboardPaste} label="Paste" keys={[MOD, "V"]} disabled={!clip} onSelect={() => pasteAfter(sc)} />
                    <MenuRow icon={CopyPlus} label="Duplicate" keys={[MOD, "D"]} onSelect={() => duplicateScene(sc)} />
                    <MenuRow icon={Trash2} label="Delete" keys={["⌫"]} danger onSelect={() => deleteScene(sc)} />
                    {kindOf(sc) === "media" && (
                      <>
                        <DropdownMenuSeparator />
                        <ToggleRow
                          icon={PlayCircle}
                          label="Switch to next scene"
                          hint={isImage(sc) || youtubeId(sc.mediaUrl) ? "When a video file ends" : "When this clip ends"}
                          checked={Boolean(sc.autoNext)}
                          onChange={(v) => onPatch(sc.id, { autoNext: v })}
                          testId={`switch-scene-autonext-${sc.id}`}
                        />
                        <ToggleRow
                          icon={Users}
                          label="Keep people on screen"
                          hint="The clip on the left, everyone on stage beside it"
                          checked={Boolean(sc.withPeople)}
                          onChange={(v) => onPatch(sc.id, { withPeople: v })}
                          testId={`switch-scene-people-${sc.id}`}
                        />
                      </>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>

              {editable && renaming === sc.id && (
                <form
                  className="absolute inset-x-1.5 bottom-1.5 flex items-center gap-1"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (draft.trim()) onPatch(sc.id, { name: draft.trim() });
                    setRenaming(null);
                  }}
                >
                  <input
                    autoFocus
                    className="h-7 min-w-0 flex-1 rounded-md border border-white/20 bg-[#04102b] px-2 text-xs text-white"
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => e.key === "Escape" && setRenaming(null)}
                    data-testid={`input-scene-rename-${sc.id}`}
                  />
                  <button type="submit" className="rounded-md bg-[#F0A71F] p-1.5 text-[#1a1200]" aria-label="Save name">
                    <Check className="h-3 w-3" />
                  </button>
                </form>
              )}

              {/* The name bar this scene carries. It lives on the card rather
                  than in a panel of its own because that is the whole point:
                  taking the scene puts it up, so it has to be edited where the
                  scene is. */}
              {editable && bannering === sc.id && (
                <form
                  className="absolute inset-x-1.5 bottom-1.5 flex flex-col gap-1 rounded-lg bg-[#04102b]/95 p-1.5 ring-1 ring-white/20"
                  onSubmit={(e) => {
                    e.preventDefault();
                    onPatch(sc.id, {
                      bannerTitle: bannerDraft.title.trim(),
                      bannerSubtitle: bannerDraft.title.trim() ? bannerDraft.sub.trim() : "",
                    });
                    setBannering(null);
                  }}
                >
                  <input
                    autoFocus
                    maxLength={80}
                    placeholder="Name on air"
                    className="h-7 w-full rounded-md border border-white/20 bg-[#000741] px-2 text-xs text-white placeholder:text-white/30"
                    value={bannerDraft.title}
                    onChange={(e) => setBannerDraft((d) => ({ ...d, title: e.target.value }))}
                    onKeyDown={(e) => e.key === "Escape" && setBannering(null)}
                    data-testid={`input-scene-banner-${sc.id}`}
                  />
                  <div className="flex items-center gap-1">
                    <input
                      maxLength={120}
                      placeholder="Underneath"
                      className="h-7 min-w-0 flex-1 rounded-md border border-white/20 bg-[#000741] px-2 text-xs text-white placeholder:text-white/30"
                      value={bannerDraft.sub}
                      onChange={(e) => setBannerDraft((d) => ({ ...d, sub: e.target.value }))}
                      onKeyDown={(e) => e.key === "Escape" && setBannering(null)}
                      data-testid={`input-scene-banner-sub-${sc.id}`}
                    />
                    <button
                      type="submit"
                      className="shrink-0 rounded-md bg-[#F0A71F] p-1.5 text-[#1a1200]"
                      aria-label="Save the lower third"
                    >
                      <Check className="h-3 w-3" />
                    </button>
                  </div>
                  <p className="text-[10px] leading-tight text-white/35">Leave the name empty for no lower third.</p>
                </form>
              )}
            </div>
          );
        })}
      </div>

      <div className={`border-t border-white/10 p-2.5 ${editable ? "" : "hidden"}`}>
        <Button
          size="sm"
          className="h-9 w-full gap-1.5 rounded-full bg-[#F0A71F] text-[13px] font-bold text-[#1a1200] hover:bg-[#f7b73a]"
          disabled={!nextScene || busy}
          onClick={() => nextScene && onApply(nextScene.id)}
          title={nextScene ? `Take "${nextScene.name}"` : "That was the last scene"}
          data-testid="button-next-scene"
        >
          {/* The button is whitespace-nowrap like every other button, so a
              long scene name ran out of both ends of the pill rather than
              being cut — "Next · Welcome & introduction — Riccoh Player" was
              wider than the rail it sits in. */}
          <span className="min-w-0 truncate">
            {nextScene ? `Next scene · ${nextScene.name}` : "End of the rail"}
          </span>
          <ArrowRight className="h-3.5 w-3.5 shrink-0" />
        </Button>
        <p className="mt-1.5 text-center text-[10px] text-white/35">Press 1–9 to cut straight to a scene</p>
      </div>
      {readOnly && (
        <p className="border-t border-white/10 px-3 py-2.5 text-[11px] text-white/35">
          The producer runs this — it's here so you can see it coming.
        </p>
      )}

      <AddMediaScene
        open={addKind === "media"}
        media={media}
        onClose={() => setAddKind(null)}
        onAdd={(spec) => {
          onAdd(spec);
          setAddKind(null);
        }}
      />
      <AddCountdownScene
        open={addKind === "countdown"}
        onClose={() => setAddKind(null)}
        onAdd={(spec) => {
          onAdd(spec);
          setAddKind(null);
        }}
      />
      <Dialog open={agendaOpen} onOpenChange={setAgendaOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Add from the agenda</DialogTitle>
            <DialogDescription>
              The scene keeps the row's time and its podcaster, so taking it does everything taking the row did.
            </DialogDescription>
          </DialogHeader>
          <div className="flex max-h-72 flex-col gap-1 overflow-y-auto py-1">
            {runItems.length === 0 && <p className="px-1 text-sm text-muted-foreground">Nothing on the agenda yet.</p>}
            {runItems.map((r) => (
              <button
                key={r.id}
                type="button"
                className="flex flex-col items-start rounded-lg px-3 py-2 text-left transition-colors hover:bg-muted"
                onClick={() => {
                  setAgendaOpen(false);
                  onAddFromAgenda(r);
                }}
              >
                <span className="text-sm font-medium">{r.title}</span>
                {r.startAtUtc && (
                  <span className="text-xs text-muted-foreground">{formatTimeInZone(new Date(r.startAtUtc), zone)}</span>
                )}
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );

  function onAddFromAgenda(r: RunItemRow) {
    onAdd({
      name: r.title,
      kind: r.mediaUrl ? "media" : "camera",
      mediaUrl: r.mediaUrl || "",
      mediaKind: (r.mediaKind === "image" ? "image" : "video") as "image" | "video",
      mediaLabel: r.mediaLabel || "",
      // Carried through so the card shows the time and the take moves people.
      startAtUtc: r.startAtUtc || "",
      runItemId: r.id,
    });
  }
}

/** One line of the scene menu: icon, words, and the shortcut on the right. */
function MenuRow({
  icon: Icon,
  label,
  keys,
  onSelect,
  disabled,
  danger,
}: {
  icon: typeof Pencil;
  label: string;
  keys?: string[];
  onSelect: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <DropdownMenuItem disabled={disabled} onSelect={onSelect} className={`gap-2.5 py-2 ${danger ? "text-red-600 focus:text-red-600" : ""}`}>
      <Icon className="h-4 w-4" />
      <span className="flex-1">{label}</span>
      {keys && (
        <span className="flex gap-1">
          {keys.map((k) => (
            <kbd key={k} className="min-w-[1.4rem] rounded bg-muted px-1.5 py-0.5 text-center text-[11px] font-medium text-muted-foreground">{k}</kbd>
          ))}
        </span>
      )}
    </DropdownMenuItem>
  );
}

/** A switch in the scene menu that doesn't close the menu when flipped. */
function ToggleRow({
  icon: Icon,
  label,
  hint,
  checked,
  onChange,
  testId,
}: {
  icon: typeof Pencil;
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  testId: string;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2.5 rounded-sm px-2 py-2 text-sm hover:bg-accent">
      <Icon className="h-4 w-4 shrink-0" />
      <span className="min-w-0 flex-1 leading-tight">
        {label}
        {hint && <span className="block text-[11px] text-muted-foreground">{hint}</span>}
      </span>
      <Switch checked={checked} onCheckedChange={onChange} data-testid={testId} />
    </label>
  );
}

function IconBtn({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="rounded-md bg-black/65 p-1 text-white/70 backdrop-blur-sm transition-colors hover:bg-black/85 hover:text-white disabled:opacity-30"
    >
      {children}
    </button>
  );
}

function AddMediaScene({
  open,
  media,
  onClose,
  onAdd,
}: {
  open: boolean;
  media: MediaChoice[];
  onClose: () => void;
  onAdd: (spec: SceneSpec) => void;
}) {
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [picked, setPicked] = useState<MediaChoice | null>(null);
  const [q, setQ] = useState("");

  useEffect(() => {
    if (!open) {
      setName("");
      setUrl("");
      setPicked(null);
      setQ("");
    }
  }, [open]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return needle ? media.filter((m) => `${m.label} ${m.owner}`.toLowerCase().includes(needle)) : media;
  }, [media, q]);

  const chosenUrl = picked?.url || url.trim();
  const ready = Boolean(chosenUrl);

  function submit() {
    if (!ready) return;
    const isImg = picked ? picked.kind === "image" : /\.(jpe?g|png|webp|gif|svg)(\?|$)/i.test(chosenUrl);
    onAdd({
      name: name.trim() || picked?.label || "Media",
      kind: "media",
      mediaUrl: chosenUrl,
      mediaKind: isImg ? "image" : "video",
      mediaLabel: picked?.label || name.trim(),
    });
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Media scene</DialogTitle>
          <DialogDescription>A clip or a slide that fills the frame when you press it.</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div>
            <Label htmlFor="scene-media-name" className="text-xs font-semibold">
              Scene name
            </Label>
            <Input
              id="scene-media-name"
              className="mt-1 h-9"
              placeholder="Sponsor read"
              value={name}
              onChange={(e) => setName(e.target.value)}
              data-testid="input-scene-media-name"
            />
          </div>

          {media.length > 0 && (
            <div>
              <Label className="text-xs font-semibold">From the library</Label>
              <Input
                className="mt-1 h-8 text-xs"
                placeholder="Search uploads…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
              <div className="mt-2 grid max-h-44 grid-cols-2 gap-1.5 overflow-y-auto">
                {shown.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => {
                      setPicked(m);
                      setUrl("");
                    }}
                    className={`flex items-center gap-2 rounded-lg border p-2 text-left text-xs transition-colors ${
                      picked?.id === m.id ? "border-primary bg-primary/5" : "border-border hover:bg-muted"
                    }`}
                  >
                    {m.kind === "image" ? (
                      <ImageIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    ) : (
                      <Film className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    )}
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{m.label}</span>
                      <span className="block truncate text-[11px] text-muted-foreground">{m.owner}</span>
                    </span>
                  </button>
                ))}
                {shown.length === 0 && <p className="col-span-2 py-2 text-xs text-muted-foreground">Nothing matches.</p>}
              </div>
            </div>
          )}

          <div>
            <Label htmlFor="scene-media-url" className="text-xs font-semibold">
              …or paste a link
            </Label>
            <Input
              id="scene-media-url"
              className="mt-1 h-9"
              placeholder="https://…mp4, or a YouTube link"
              value={url}
              onChange={(e) => {
                setUrl(e.target.value);
                setPicked(null);
              }}
              data-testid="input-scene-media-url"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" className="rounded-full" onClick={onClose}>
            Cancel
          </Button>
          <Button className="rounded-full" disabled={!ready} onClick={submit} data-testid="button-scene-media-save">
            Add scene
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const PRESETS = [60, 120, 300, 600, 900];

function AddCountdownScene({
  open,
  onClose,
  onAdd,
}: {
  open: boolean;
  onClose: () => void;
  onAdd: (spec: SceneSpec) => void;
}) {
  const [name, setName] = useState("Back shortly");
  const [seconds, setSeconds] = useState(300);

  useEffect(() => {
    if (!open) {
      setName("Back shortly");
      setSeconds(300);
    }
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Countdown scene</DialogTitle>
          <DialogDescription>
            A break clock on the frame. It starts when you press the scene, and every viewer counts down on their own
            clock — so a late arrival sees the right number.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div>
            <Label htmlFor="scene-cd-name" className="text-xs font-semibold">
              What it says
            </Label>
            <Input
              id="scene-cd-name"
              className="mt-1 h-9"
              value={name}
              onChange={(e) => setName(e.target.value)}
              data-testid="input-scene-countdown-name"
            />
          </div>

          <div>
            <Label className="text-xs font-semibold">How long</Label>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {PRESETS.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setSeconds(p)}
                  className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                    seconds === p ? "border-primary bg-primary/10 text-primary" : "border-border hover:bg-muted"
                  }`}
                >
                  {p < 60 ? `${p}s` : `${p / 60} min`}
                </button>
              ))}
            </div>
            <div className="mt-2 flex items-center gap-2">
              <Input
                type="number"
                min={5}
                max={7200}
                className="h-8 w-24 text-xs"
                value={seconds}
                onChange={(e) => setSeconds(Math.max(5, Math.min(7200, Number(e.target.value) || 0)))}
                data-testid="input-scene-countdown-seconds"
              />
              <span className="text-xs text-muted-foreground">seconds</span>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" className="rounded-full" onClick={onClose}>
            Cancel
          </Button>
          <Button
            className="rounded-full"
            disabled={!name.trim()}
            onClick={() => onAdd({ name: name.trim(), kind: "countdown", countdownSeconds: seconds })}
            data-testid="button-scene-countdown-save"
          >
            Add scene
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
