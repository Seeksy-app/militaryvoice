import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { useParticipants } from "@livekit/components-react";
import { Grid2x2, ImageIcon, Redo2, Undo2, Video, X } from "lucide-react";
import { BOX_LIMIT, BOX_MIN, BOX_PRESETS, boxCast, gridColumns, isPlayer } from "@shared/roomLook";
import { bgCss, newId, type Asset, type Box, type RoomKit, type Scene } from "./look";
import { BoxThumb, typeOf, peopleOf, TYPES } from "./ScenesPanel";
import { Select } from "./Select";

/**
 * The layout editor (StreamYard's, Andrew 21 Nov: "Yes" to the mockup). A scene's ⋯ → Edit layout
 * turns the stage into a canvas of boxes: a camera (one person), media (slides, a clip or a picture)
 * and a camera grid (everyone else). Drag to move, a corner to resize, gold lines when it snaps.
 * Everything here is a draft: nothing changes on air, or in the saved look, until Done.
 */
type Draft = { boxes: Box[]; media: Asset | null };
type Mode = "move" | "nw" | "ne" | "sw" | "se";
type Guide = { axis: "x" | "y"; at: number };

const round = (n: number) => Math.round(n * 10000) / 10000;
/** A circle is drawn in a square box: in the 16:9 frame that's h = w × 16/9. */
function squared(b: Box): Box {
  let w = b.w, h = (b.w * 16) / 9;
  if (h > 1 - b.y) { h = 1 - b.y; w = (h * 9) / 16; }
  if (w < BOX_MIN) { w = BOX_MIN; h = (w * 16) / 9; }
  return { ...b, w: round(w), h: round(h) };
}
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const initials = (name: string) => name.split(/\s+/).filter((w) => /^[A-Za-z0-9\u00C0-\u024F]/.test(w)).map((w) => w[0]).join("").slice(0, 2).toUpperCase() || "?";

/** A scene with no boxes opens on the ready-made layout closest to its type. */
function seed(s: Scene): Box[] {
  if (s.boxes?.length) return s.boxes.map((b) => ({ ...b }));
  const t = typeOf(s);
  const id = t === "single" || t === "profile" ? "solo" : t === "two" ? "side" : t === "group" ? "grid" : peopleOf(s) > 0 ? "media2" : "";
  if (!id) return [{ id: newId(), kind: "media", x: 0, y: 0, w: 1, h: 1, shape: "square", fit: "contain" }];
  return BOX_PRESETS.find((p) => p.id === id)!.boxes.map((b) => ({ ...b, id: newId() }));
}

export function LayoutEditor({ kit, sceneId, onClose }: { kit: RoomKit; sceneId: string; onClose: () => void }) {
  const look = kit.look!;
  const scene = look.scenes.find((s) => s.id === sceneId)!;
  const [draft, setDraft] = useState<Draft>(() => ({ boxes: seed(scene), media: scene.media ?? null }));
  const [sel, setSel] = useState<string | null>(null);
  const past = useRef<Draft[]>([]);
  const future = useRef<Draft[]>([]);
  const [, bump] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [guides, setGuides] = useState<Guide[]>([]);
  const canvas = useRef<HTMLDivElement>(null);
  const draftRef = useRef(draft);
  draftRef.current = draft;

  /** Every change goes through here, so Undo can take it back. */
  const commit = (next: Draft) => {
    past.current = [...past.current.slice(-49), draftRef.current];
    future.current = [];
    setDraft(next);
    setDirty(true);
    bump((x) => x + 1);
  };
  const undo = () => {
    const prev = past.current.pop();
    if (!prev) return;
    future.current = [draftRef.current, ...future.current];
    setDraft(prev);
    bump((x) => x + 1);
  };
  const redo = () => {
    const [next, ...rest] = future.current;
    if (!next) return;
    past.current = [...past.current, draftRef.current];
    future.current = rest;
    setDraft(next);
    bump((x) => x + 1);
  };
  const setBox = (id: string, p: Partial<Box>) => commit({ ...draftRef.current, boxes: draftRef.current.boxes.map((b) => (b.id === id ? (p.shape === "circle" && b.shape !== "circle" ? squared({ ...b, ...p }) : { ...b, ...p }) : b)) });
  const remove = (id: string) => { commit({ ...draftRef.current, boxes: draftRef.current.boxes.filter((b) => b.id !== id) }); setSel(null); };

  const boxes = draft.boxes;
  const full = boxes.length >= BOX_LIMIT;
  const hasMedia = boxes.some((b) => b.kind === "media");
  const hasGrid = boxes.some((b) => b.kind === "grid");
  const add = (kind: Box["kind"]) => {
    if (full) return;
    const k = boxes.filter((b) => b.kind === kind).length;
    const b: Box = kind === "camera" ? { id: newId(), kind, who: "next", x: round(0.35 + 0.04 * k), y: round(0.3 + 0.04 * k), w: 0.3, h: 0.3, shape: "rounded", fit: "cover" }
      : kind === "media" ? { id: newId(), kind, x: 0.2, y: 0.15, w: 0.6, h: 0.6, shape: "rounded", fit: "contain" }
      : { id: newId(), kind, x: 0.03, y: 0.66, w: 0.94, h: 0.3, shape: "rounded", fit: "cover" };
    commit({ ...draftRef.current, boxes: [...draftRef.current.boxes, b] });
    setSel(b.id);
  };
  const preset = (id: string) => {
    const p = BOX_PRESETS.find((x) => x.id === id)!;
    commit({ ...draftRef.current, boxes: p.boxes.map((b) => ({ ...b, id: newId() })) });
    setSel(null);
  };
  const toFront = (id: string) => { const b = boxes.find((x) => x.id === id)!; commit({ ...draft, boxes: [...boxes.filter((x) => x.id !== id), b] }); };
  const toBack = (id: string) => { const b = boxes.find((x) => x.id === id)!; commit({ ...draft, boxes: [b, ...boxes.filter((x) => x.id !== id)] }); };

  // Who would be where right now, so the canvas shows faces rather than empty frames.
  const participants = useParticipants();
  const people = useMemo(() => participants
    .filter((p) => !isPlayer(p.identity, p.attributes) && p.attributes?.stage !== "off")
    .map((p) => ({ identity: p.identity, name: p.name || p.identity, host: /^owner-/.test(p.identity) && !/-cam-/.test(p.identity), who: p.identity })), [participants]);
  const cast = boxCast(people, { ...scene, boxes });
  const nameOf = (id: string) => people.find((p) => p.identity === id)?.name ?? "";

  const done = () => {
    if (dirty) {
      kit.change((l) => ({
        ...l,
        scenes: l.scenes.map((s) => {
          if (s.id !== sceneId) return s;
          const { boxes: _old, ...rest } = s;
          return { ...rest, ...(draft.boxes.length ? { boxes: draft.boxes } : {}), ...(draft.boxes.some((b) => b.kind === "media") || typeOf(s) === "media" ? { media: draft.media } : {}) };
        }),
      }));
    }
    onClose();
  };
  const cancel = () => { if (!dirty || window.confirm("Throw away your layout changes?")) onClose(); };

  // Keys: arrows nudge, Delete removes, ⌘Z / Ctrl+Z undo, ⇧⌘Z / Ctrl+Y redo, Escape lets go.
  const selRef = useRef(sel);
  selRef.current = sel;
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "z") { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
      if (mod && e.key.toLowerCase() === "y") { e.preventDefault(); redo(); return; }
      const id = selRef.current;
      if (e.key === "Escape") { setSel(null); return; }
      if (!id) return;
      const b = draftRef.current.boxes.find((x) => x.id === id);
      if (!b) return;
      if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); remove(id); return; }
      const step = e.shiftKey ? 0.025 : 0.005;
      const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
      if (d) { e.preventDefault(); setBox(id, { x: round(clamp(b.x + d[0], 0, 1 - b.w)), y: round(clamp(b.y + d[1], 0, 1 - b.h)) }); }
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /** Drag a box (move) or one of its corners (resize). Edges snap to the frame, its centre and the other boxes. */
  const grab = (e: ReactPointerEvent, id: string, mode: Mode) => {
    e.preventDefault();
    e.stopPropagation();
    setSel(id);
    const el = canvas.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const orig = draftRef.current.boxes.find((b) => b.id === id)!;
    const others = draftRef.current.boxes.filter((b) => b.id !== id);
    const xs = [0, 0.03, 0.5, 0.97, 1, ...others.flatMap((b) => [b.x, b.x + b.w / 2, b.x + b.w])];
    const ys = [0, 0.05, 0.5, 0.95, 1, ...others.flatMap((b) => [b.y, b.y + b.h / 2, b.y + b.h])];
    const tx = 7 / rect.width, ty = 7 / rect.height;
    const near = (vals: number[], lines: number[], tol: number) => {
      let best: { d: number; line: number } | null = null;
      for (const v of vals) for (const l of lines) { const d = l - v; if (Math.abs(d) <= tol && (!best || Math.abs(d) < Math.abs(best.d))) best = { d, line: l }; }
      return best;
    };
    let started = false;
    const sx = e.clientX, sy = e.clientY;
    const move = (ev: PointerEvent) => {
      let dx = (ev.clientX - sx) / rect.width, dy = (ev.clientY - sy) / rect.height;
      if (!started) {
        if (Math.abs(ev.clientX - sx) < 3 && Math.abs(ev.clientY - sy) < 3) return;
        started = true;
        past.current = [...past.current.slice(-49), draftRef.current];
        future.current = [];
        setDirty(true);
      }
      const g: Guide[] = [];
      let { x, y, w, h } = orig;
      if (mode === "move") {
        // Shift keeps it straight: only the way it has moved most.
        if (ev.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
        x = clamp(orig.x + dx, 0, 1 - w); y = clamp(orig.y + dy, 0, 1 - h);
        const sxn = near([x, x + w / 2, x + w], xs, tx); if (sxn) { x = clamp(x + sxn.d, 0, 1 - w); g.push({ axis: "x", at: sxn.line }); }
        const syn = near([y, y + h / 2, y + h], ys, ty); if (syn) { y = clamp(y + syn.d, 0, 1 - h); g.push({ axis: "y", at: syn.line }); }
      } else {
        let l = orig.x, r = orig.x + orig.w, t = orig.y, b = orig.y + orig.h;
        if (mode === "nw" || mode === "sw") { l = clamp(l + dx, 0, r - BOX_MIN); const s = near([l], xs, tx); if (s) { l = clamp(l + s.d, 0, r - BOX_MIN); g.push({ axis: "x", at: s.line }); } }
        else { r = clamp(r + dx, l + BOX_MIN, 1); const s = near([r], xs, tx); if (s) { r = clamp(r + s.d, l + BOX_MIN, 1); g.push({ axis: "x", at: s.line }); } }
        if (mode === "nw" || mode === "ne") { t = clamp(t + dy, 0, b - BOX_MIN); const s = near([t], ys, ty); if (s) { t = clamp(t + s.d, 0, b - BOX_MIN); g.push({ axis: "y", at: s.line }); } }
        else { b = clamp(b + dy, t + BOX_MIN, 1); const s = near([b], ys, ty); if (s) { b = clamp(b + s.d, t + BOX_MIN, 1); g.push({ axis: "y", at: s.line }); } }
        x = l; y = t; w = r - l; h = b - t;
        if (orig.shape === "circle") {
          h = (w * 16) / 9;
          if (mode === "nw" || mode === "ne") { y = orig.y + orig.h - h; if (y < 0) { y = 0; h = orig.y + orig.h; w = (h * 9) / 16; if (mode === "nw") x = orig.x + orig.w - w; } }
          else if (y + h > 1) { h = 1 - y; w = (h * 9) / 16; if (mode === "sw") x = orig.x + orig.w - w; }
        }
      }
      setGuides(g);
      setDraft((d) => ({ ...d, boxes: d.boxes.map((bx) => (bx.id === id ? { ...bx, x: round(x), y: round(y), w: round(w), h: round(h) } : bx)) }));
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      setGuides([]);
      if (started) bump((n) => n + 1);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };

  const selected = boxes.find((b) => b.id === sel) ?? null;
  const bg = bgCss(scene.look?.background ?? look.background);
  const typeName = TYPES.find((t) => t.id === typeOf(scene))?.label ?? "";
  const tool = "flex h-9 items-center gap-1.5 rounded-lg px-3 text-[13px] font-semibold disabled:opacity-40";

  const presets = (
    <>
      <p className="mt-4 text-[13px] font-bold">Start from a layout</p>
      <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-6" data-testid="layout-presets">
        {BOX_PRESETS.map((p) => (
          <button key={p.id} type="button" onClick={() => preset(p.id)} className="rounded-xl border border-[#e4e7ec] bg-white p-1.5 text-center hover:border-[#98a2b3]" data-testid={`layout-preset-${p.id}`}>
            <BoxThumb boxes={p.boxes} />
            <span className="mt-1 block text-[11px] font-semibold leading-tight text-[#344054]">{p.label}</span>
          </button>
        ))}
      </div>
    </>
  );

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto lg:flex-row lg:overflow-hidden" data-testid="layout-editor">
      <div className="flex min-w-0 flex-1 flex-col items-center px-4 pb-4 pt-5 lg:overflow-y-auto lg:px-6 lg:pb-6">
        <div className="w-full max-w-[900px]">
          {/* Tools */}
          <div className="flex flex-wrap items-center gap-1.5 rounded-xl border border-[#e4e7ec] bg-white p-2 shadow-[0_1px_2px_rgba(16,24,40,0.05)]" data-testid="layout-tools">
            <p className="mr-1 min-w-0 truncate px-1 text-[13px] font-bold">Editing: {scene.name}</p>
            <div className="flex flex-wrap items-center gap-1.5">
              <button type="button" onClick={() => add("camera")} disabled={full} title={full ? "9 boxes is the most" : "One person's camera"} className={`${tool} bg-[#eef3fb] text-[#053877] hover:bg-[#e0e9f7]`} data-testid="layout-add-camera"><Video className="h-4 w-4" /> Camera</button>
              <button type="button" onClick={() => add("media")} disabled={full || hasMedia} title={hasMedia ? "One media box per scene" : "Slides, a clip or a picture"} className={`${tool} bg-[#eef3fb] text-[#053877] hover:bg-[#e0e9f7]`} data-testid="layout-add-media"><ImageIcon className="h-4 w-4" /> Media</button>
              <button type="button" onClick={() => add("grid")} disabled={full || hasGrid} title={hasGrid ? "One camera grid per scene" : "Everyone else, in turn"} className={`${tool} bg-[#eef3fb] text-[#053877] hover:bg-[#e0e9f7]`} data-testid="layout-add-grid"><Grid2x2 className="h-4 w-4" /> Camera grid</button>
            </div>
            <div className="ml-auto flex items-center gap-1.5">
              <button type="button" onClick={undo} disabled={!past.current.length} aria-label="Undo" className={`${tool} text-[#344054] hover:bg-[#f2f4f7]`} data-testid="layout-undo"><Undo2 className="h-4 w-4" /><span className="hidden sm:inline">Undo</span></button>
              <button type="button" onClick={redo} disabled={!future.current.length} aria-label="Redo" className={`${tool} text-[#344054] hover:bg-[#f2f4f7]`} data-testid="layout-redo"><Redo2 className="h-4 w-4" /><span className="hidden sm:inline">Redo</span></button>
              <span className="mx-0.5 h-6 w-px bg-[#e4e7ec]" />
              <button type="button" onClick={cancel} className={`${tool} text-[#344054] hover:bg-[#f2f4f7]`} data-testid="layout-cancel">Cancel</button>
              <button type="button" onClick={done} className="h-9 rounded-lg bg-[#053877] px-4 text-[13px] font-bold text-white hover:bg-[#04306a]" data-testid="layout-done">Done</button>
            </div>
          </div>

          {/* The canvas: the 16:9 frame, as recorded and streamed */}
          <div className="mx-auto mt-3" style={{ width: "min(100%, calc((100dvh - 330px) * 16 / 9))", minWidth: "min(100%, 320px)" }}>
            <div ref={canvas} className="relative aspect-video w-full touch-none select-none overflow-hidden rounded-2xl shadow-[0_12px_32px_rgba(16,24,40,0.22)] [container-type:inline-size]" style={{ background: bg }} onPointerDown={() => setSel(null)} data-testid="layout-canvas">
              {boxes.length === 0 && (
                <div className="absolute inset-0 flex items-center justify-center p-6 text-center">
                  <p className="max-w-[60cqw] rounded-xl bg-white/90 px-4 py-3 text-[13px] font-semibold text-[#344054]">No boxes, so this scene uses its standard layout{typeName ? ` (${typeName})` : ""}. Add a box above, or start from a layout below.</p>
                </div>
              )}
              {boxes.map((b, i) => {
                const on = b.id === sel;
                const ids = cast.byBox[b.id] ?? [];
                const label = b.kind === "media" ? "Media · slides, clip or picture" : b.kind === "grid" ? "Camera grid · everyone else, in turn" : `Camera · ${b.who === "host" ? "You" : b.who === "next" || !b.who ? "Next guest" : nameOf(b.who) || "Someone not here yet"}`;
                return (
                  <div key={b.id} onPointerDown={(e) => grab(e, b.id, "move")} className="absolute cursor-move" style={{ left: `${b.x * 100}%`, top: `${b.y * 100}%`, width: `${b.w * 100}%`, height: `${b.h * 100}%`, zIndex: i + 1 }} data-testid={`layout-box-${b.kind}`} data-selected={on ? "yes" : "no"}>
                    <div className={`relative h-full w-full overflow-hidden [container-type:size] ${b.shape === "circle" ? "rounded-full" : b.shape === "square" ? "" : "rounded-[1.4cqmin]"} ${b.kind === "grid" ? "border-2 border-dashed border-white/70 bg-white/5" : "bg-[#1d3a70]/90"} ${on ? "outline outline-2 outline-offset-0 outline-[#F0A71F]" : "outline outline-1 outline-white/25"}`}>
                      <BoxPreview box={b} ids={ids} nameOf={nameOf} media={draft.media} />
                    </div>
                    <span className="pointer-events-none absolute left-1.5 top-1.5 max-w-[calc(100%-12px)] truncate rounded bg-[#0a1633]/85 px-1.5 py-0.5 text-[10px] font-bold text-white sm:text-[11px]">{label}</span>
                  </div>
                );
              })}
              {/* The picked box's frame and corners sit above every box, so it keeps its real layer
                  (Send to back shows at once) and its corners can always be grabbed. */}
              {(() => {
                const b = boxes.find((x) => x.id === sel);
                if (!b) return null;
                return (
                  <div className="pointer-events-none absolute z-[45] outline-dashed outline-1 outline-[#F0A71F]" style={{ left: `${b.x * 100}%`, top: `${b.y * 100}%`, width: `${b.w * 100}%`, height: `${b.h * 100}%` }} data-testid="layout-selection">
                    <span className="absolute bottom-1.5 right-1.5 rounded bg-[#F0A71F] px-1.5 py-0.5 text-[10px] font-bold text-[#101828]" data-testid="layout-size">{Math.round(b.w * 100)}% wide</span>
                    {(["nw", "ne", "sw", "se"] as const).map((m) => (
                      <span key={m} onPointerDown={(e) => grab(e, b.id, m)} className={`pointer-events-auto absolute flex h-6 w-6 items-center justify-center ${m === "nw" ? "-left-3 -top-3 cursor-nwse-resize" : m === "ne" ? "-right-3 -top-3 cursor-nesw-resize" : m === "sw" ? "-bottom-3 -left-3 cursor-nesw-resize" : "-bottom-3 -right-3 cursor-nwse-resize"}`} data-testid={`layout-handle-${m}`}>
                        <span className="h-3 w-3 rounded-[3px] border-2 border-[#F0A71F] bg-white shadow" />
                      </span>
                    ))}
                  </div>
                );
              })()}
              {guides.map((g, i) => (
                <span key={i} className="pointer-events-none absolute z-[50] bg-[#F0A71F]" style={g.axis === "x" ? { left: `${g.at * 100}%`, top: 0, bottom: 0, width: 1.5 } : { top: `${g.at * 100}%`, left: 0, right: 0, height: 1.5 }} data-testid="layout-guide" />
              ))}
            </div>
            <p className="mt-2 text-center text-xs text-[#667085]">Boxes snap to the edges, the centre and each other. A thin gold line shows where.</p>
          </div>

          <div className="hidden lg:block">{presets}</div>
        </div>
      </div>

      {/* Settings for the box picked: beside the canvas on a laptop, right under it on a phone
          (the ready-made layouts move below them there, so a tapped box's settings show at once). */}
      <aside className="shrink-0 border-y border-[#e4e7ec] bg-white px-5 py-5 lg:w-[360px] lg:overflow-y-auto lg:border-l lg:border-y-0 2xl:w-[392px]" data-testid="layout-panel">
        {selected ? (
          <BoxPanel key={selected.id} box={selected} people={people} media={draft.media} kit={kit} onSet={(p) => setBox(selected.id, p)} onMedia={(m) => commit({ ...draftRef.current, media: m })} onFront={() => toFront(selected.id)} onBack={() => toBack(selected.id)} onDelete={() => remove(selected.id)} onClose={() => setSel(null)} />
        ) : (
          <div>
            <p className="text-[15px] font-bold">Your layout</p>
            <p className="mt-1 text-[13px] leading-snug text-[#667085]">Tap a box to change it. Drag it to move it, or a corner to resize it.</p>
            {boxes.length > 0 && <button type="button" onClick={() => { commit({ ...draftRef.current, boxes: [] }); setSel(null); }} className="mt-3 text-[13px] font-semibold text-[#053877] underline-offset-2 hover:underline" data-testid="layout-standard">Use the standard layout instead</button>}
          </div>
        )}
        <div className="mt-5 hidden rounded-xl border border-[#fde9b8] bg-[#fffaeb] p-4 lg:block">
          <p className="text-[13px] font-bold">Tips</p>
          <ul className="mt-1.5 list-disc space-y-1 pl-4 text-[12px] leading-snug text-[#475467]">
            <li>Shift while you drag keeps it straight.</li>
            <li>Arrow keys nudge the box you picked.</li>
            <li>⌘Z or Ctrl+Z undoes, ⇧⌘Z redoes.</li>
            <li>Nobody sees your changes until you press Done.</li>
          </ul>
        </div>
      </aside>
      <div className="px-4 pb-6 lg:hidden">{presets}</div>
    </div>
  );
}

/** What a box would show right now: a face, the media, or the grid's people. */
function BoxPreview({ box, ids, nameOf, media }: { box: Box; ids: string[]; nameOf: (id: string) => string; media: Asset | null }) {
  const face = (id: string | null, key?: string) => (
    <div key={key} className="flex min-h-0 min-w-0 items-center justify-center rounded-[1cqmin] bg-[#2c4a85]/80">
      {id ? <span className="flex aspect-square h-[42%] max-h-16 items-center justify-center rounded-full bg-[#8ea4cf] text-[clamp(9px,12cqmin,20px)] font-bold text-white">{initials(nameOf(id))}</span>
        : <span className="px-1 text-center text-[clamp(8px,8cqmin,12px)] font-semibold text-white/70">Empty until someone joins</span>}
    </div>
  );
  if (box.kind === "media") {
    if (!media) return <div className="flex h-full w-full items-center justify-center p-2 text-center text-[clamp(9px,7cqmin,13px)] font-semibold text-white/80">Nothing to show yet. Pick it on the right.</div>;
    return (media.mime ?? "").startsWith("image")
      ? <img src={media.url} alt="" draggable={false} className={`pointer-events-none h-full w-full ${box.fit === "cover" ? "object-cover" : "object-contain"}`} />
      : <video src={media.url} muted playsInline className={`pointer-events-none h-full w-full ${box.fit === "cover" ? "object-cover" : "object-contain"}`} />;
  }
  if (box.kind === "camera") return <div className="grid h-full w-full p-[1.5cqmin]">{face(ids[0] ?? null)}</div>;
  const cells = ids.length ? ids : [];
  const n = cells.length + (cells.length < 3 ? 1 : 0);
  const cols = gridColumns(n, (box.w / box.h) * (16 / 9));
  return (
    <div className="grid h-full w-full gap-[1.5cqmin] p-[2cqmin]" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${Math.ceil(n / cols)}, minmax(0, 1fr))` }}>
      {cells.map((id) => face(id, id))}
      {cells.length < 3 && face(null, "empty")}
    </div>
  );
}

function Seg<T extends string>({ value, options, onPick, label }: { value: T; options: { id: T; label: string }[]; onPick: (v: T) => void; label: string }) {
  return (
    <div className="mt-1.5 grid overflow-hidden rounded-lg border border-[#d0d5dd]" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }} role="radiogroup" aria-label={label}>
      {options.map((o, i) => (
        <button key={o.id} type="button" role="radio" aria-checked={value === o.id} onClick={() => onPick(o.id)} className={`h-9 text-[13px] font-semibold ${i ? "border-l border-[#d0d5dd]" : ""} ${value === o.id ? "bg-[#053877] text-white" : "bg-white text-[#344054] hover:bg-[#f9fafb]"}`}>{o.label}</button>
      ))}
    </div>
  );
}

function BoxPanel({ box, people, media, kit, onSet, onMedia, onFront, onBack, onDelete, onClose }: {
  box: Box; people: { identity: string; name: string; host: boolean }[]; media: Asset | null; kit: RoomKit;
  onSet: (p: Partial<Box>) => void; onMedia: (m: Asset | null) => void; onFront: () => void; onBack: () => void; onDelete: () => void; onClose: () => void;
}) {
  const look = kit.look!;
  const title = box.kind === "camera" ? "Camera box" : box.kind === "media" ? "Media box" : "Camera grid";
  const label = "mt-4 block text-[13px] font-semibold text-[#344054]";
  const guests = people.filter((p) => !p.host);
  const all = [...(look.videos ?? []).map((v) => v.asset), ...(look.backgrounds ?? []), ...look.logos, ...(media ? [media] : [])].filter((a, i, xs) => xs.findIndex((b) => b.id === a.id) === i);
  const who = box.who ?? "next";
  return (
    <div data-testid="layout-box-panel">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-[15px] font-bold">{title}</p>
          <p className="mt-0.5 text-[13px] leading-snug text-[#667085]">Selected. Drag it to move it, or a corner to resize it.</p>
        </div>
        <button type="button" onClick={onClose} aria-label="Done with this box" className="text-[#667085] hover:text-[#101828]"><X className="h-4 w-4" /></button>
      </div>

      {box.kind === "camera" && (
        <>
          <label className={label} htmlFor="box-who">Who shows here</label>
          <Select id="box-who" value={who} onChange={(e) => onSet({ who: e.target.value })} wrap="mt-1.5 w-full" className="h-10 rounded-lg border border-[#d0d5dd] bg-white pl-3 text-sm" data-testid="layout-who">
            <option value="host">You (host)</option>
            <option value="next">Next guest</option>
            {guests.map((g) => <option key={g.identity} value={g.identity}>{g.name}</option>)}
            {who !== "host" && who !== "next" && !guests.some((g) => g.identity === who) && <option value={who}>Someone not here now</option>}
          </Select>
          <p className="mt-1.5 text-[12px] leading-snug text-[#667085]">Next guest: whoever is on stage and not shown in another box.</p>
        </>
      )}
      {box.kind === "media" && (
        <>
          <label className={label} htmlFor="box-media">Shows</label>
          <Select id="box-media" value={media?.id ?? ""} onChange={(e) => onMedia(all.find((a) => a.id === e.target.value) ?? null)} wrap="mt-1.5 w-full" className="h-10 rounded-lg border border-[#d0d5dd] bg-white pl-3 text-sm" data-testid="layout-media">
            <option value="">Nothing yet</option>
            {all.map((a) => <option key={a.id} value={a.id}>{a.name || (a.kind === "video" ? "Video" : "Picture")}</option>)}
          </Select>
          <p className="mt-1.5 text-[12px] leading-snug text-[#667085]">Slides you present in this scene show here too. Empty, it's left out of the recording.</p>
        </>
      )}
      {box.kind === "grid" && <p className="mt-3 text-[13px] leading-snug text-[#475467]">Fills itself with everyone on stage who isn't in another box, in order, and makes room as people join (up to 9).</p>}

      <p className={label}>Shape</p>
      <Seg label="Shape" value={box.shape ?? "rounded"} onPick={(shape) => onSet({ shape })} options={[{ id: "rounded", label: "Rounded" }, { id: "square", label: "Square" }, { id: "circle", label: "Circle" }]} />
      <p className={label}>Picture</p>
      <Seg label="Picture" value={box.fit ?? (box.kind === "media" ? "contain" : "cover")} onPick={(fit) => onSet({ fit })} options={[{ id: "cover", label: "Fill the box" }, { id: "contain", label: "Show all" }]} />
      <p className={label}>Layer</p>
      <div className="mt-1.5 grid grid-cols-2 gap-2">
        <button type="button" onClick={onFront} className="h-9 rounded-lg border border-[#d0d5dd] bg-white text-[13px] font-semibold text-[#344054] hover:bg-[#f9fafb]" data-testid="layout-front">Bring to front</button>
        <button type="button" onClick={onBack} className="h-9 rounded-lg border border-[#d0d5dd] bg-white text-[13px] font-semibold text-[#344054] hover:bg-[#f9fafb]" data-testid="layout-back">Send to back</button>
      </div>
      <button type="button" onClick={onDelete} className="mt-5 text-[13px] font-semibold text-[#b42318] hover:underline" data-testid="layout-delete">Delete this box</button>
    </div>
  );
}
