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
  ChevronUp,
  ChevronDown,
  Pencil,
  ListOrdered,
  Clapperboard,
  Check,
  Captions,
  ArrowRight,
} from "lucide-react";

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
}

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

function isImage(sc: SceneRow): boolean {
  return sc.mediaKind === "image" || /\.(jpe?g|png|webp|gif|svg)(\?|$)/i.test(sc.mediaUrl);
}

export function sceneKindLabel(sc: SceneRow): string {
  const k = kindOf(sc);
  if (k === "countdown") return `${Math.round(sc.countdownSeconds / 60)} min clock`;
  if (k === "media") return sc.mediaLabel || (isImage(sc) ? "Image" : "Clip");
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
  const [bannering, setBannering] = useState<number | null>(null);
  const [bannerDraft, setBannerDraft] = useState({ title: "", sub: "" });
  const [draft, setDraft] = useState("");
  const liveRef = useRef<HTMLDivElement | null>(null);

  const liveIndex = scenes.findIndex((s) => s.id === currentSceneId);

  // Keep the scene on air in view. A 48-slot marathon is a long rail, and a
  // producer should never have to hunt for where they are in it.
  useEffect(() => {
    liveRef.current?.scrollIntoView({ block: "nearest" });
  }, [currentSceneId]);

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

  function move(index: number, by: number) {
    const next = [...scenes];
    const target = index + by;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    onReorder(next.map((s) => s.id));
  }

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
        {readOnly ? null : (
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
            <DropdownMenuItem onClick={() => onAdd({ name: "Cameras", kind: "camera" })} data-testid="menu-add-camera">
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

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 pb-3" data-testid="scene-rail">
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
          const thumb = k === "media" && isImage(sc) ? sc.mediaUrl : null;
          const sg = sc.runItemId
            ? signups.find((x) => x.id === runItems.find((r) => r.id === sc.runItemId)?.signupId)
            : undefined;
          const norm = (v: string) => v.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
          const here = sg
            ? presentNames.some(
                (n) => norm(n).length > 2 && (norm(sg.hostName).includes(norm(n)) || norm(n).includes(norm(sg.hostName))),
              )
            : false;

          return (
            <div key={sc.id} ref={on ? liveRef : undefined} className="group relative">
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
                  {thumb ? (
                    <img src={thumb} alt="" className="absolute inset-0 h-full w-full object-cover" />
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

              {/* Editing controls stay out of the way until wanted — this is a
                  surface you press during a show, not one you fiddle with. */}
              <div className={`pointer-events-none absolute right-1.5 top-8 flex-col gap-1 opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100 ${readOnly ? "hidden" : "flex"}`}>
                <IconBtn label="Move up" onClick={() => move(i, -1)} disabled={i === 0}>
                  <ChevronUp className="h-3 w-3" />
                </IconBtn>
                <IconBtn label="Move down" onClick={() => move(i, 1)} disabled={i === scenes.length - 1}>
                  <ChevronDown className="h-3 w-3" />
                </IconBtn>
                <IconBtn
                  label="Rename"
                  onClick={() => {
                    setRenaming(sc.id);
                    setDraft(sc.name);
                  }}
                >
                  <Pencil className="h-3 w-3" />
                </IconBtn>
                <IconBtn
                  label={sc.bannerTitle ? "Edit the lower third" : "Add a lower third"}
                  onClick={() => {
                    setBannering(sc.id);
                    setBannerDraft({ title: sc.bannerTitle ?? "", sub: sc.bannerSubtitle ?? "" });
                  }}
                >
                  <Captions className="h-3 w-3" />
                </IconBtn>
                <IconBtn label="Remove scene" onClick={() => onDelete(sc.id)}>
                  <X className="h-3 w-3" />
                </IconBtn>
              </div>

              {!readOnly && renaming === sc.id && (
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
              {!readOnly && bannering === sc.id && (
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

      <div className={`border-t border-white/10 p-2.5 ${readOnly ? "hidden" : ""}`}>
        <Button
          size="sm"
          className="h-9 w-full gap-1.5 rounded-full bg-[#F0A71F] text-[13px] font-bold text-[#1a1200] hover:bg-[#f7b73a]"
          disabled={!nextScene || busy}
          onClick={() => nextScene && onApply(nextScene.id)}
          title={nextScene ? `Take "${nextScene.name}"` : "That was the last scene"}
          data-testid="button-next-scene"
        >
          {nextScene ? `Next · ${nextScene.name}` : "End of the rail"}
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
