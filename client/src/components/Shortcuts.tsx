import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Check, GripVertical, Plus, X } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Art3D } from "@/components/ui/icon-tile";
import type { Icon3D } from "@/lib/icons3d";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { useToast } from "@/hooks/use-toast";

/**
 * The dashboard's Shortcuts row (Andrew, 23 Nov, mockup approved): compact cards, the 3D icon beside the words;
 * drag to arrange at any time (a handle on hover on a computer, press and hold on a phone); an "Add a shortcut" tile
 * at the end whenever there's room; Edit only adds an × to remove (Andrew via PM, 23 Nov: "the drag ability … and
 * then to add more cards"). The picker lists the pages in the nav, up to 8. Saved per account on the server, and
 * under View as too (it saves to that account, like any admin edit there).
 * Their next setup step, when there is one, stands in front, outlined, and isn't one of the 8.
 */
export type Shortcut = {
  key: string;
  art: Icon3D;
  title: string;
  hint: string;
  /** A shorter line for phones, where two cards share the width. */
  phoneHint?: string;
  tag?: string;
  /** Your Discovery: their audience score, a small green chip beside the title (computers; phones say it in the hint). */
  score?: number;
  go: () => void;
  /** Go live's panel is open under the row. */
  active?: boolean;
  expands?: boolean;
};

type Saved = { keys: string[] | null; max: number; readOnly: boolean };
const QK = ["/api/host/shortcuts"];

/** `pinned`: Your Discovery, always first and never one of the 8. */
export function Shortcuts({ catalog, defaults, next, pinned }: { catalog: Shortcut[]; defaults: string[]; next?: Shortcut | null; pinned?: Shortcut | null }) {
  const { toast } = useToast();
  const { data } = useQuery<Saved>({ queryKey: QK, retry: false, staleTime: 60_000 });
  const max = data?.max ?? 8;
  const readOnly = data?.readOnly ?? false;
  const byKey = new Map(catalog.map((c) => [c.key, c]));
  const saved = (data?.keys ?? defaults).filter((k) => byKey.has(k));
  const [preview, setPreviewState] = useState<string[] | null>(null);
  const previewRef = useRef<string[] | null>(null);
  const setPreview = (p: string[] | null) => { previewRef.current = p; setPreviewState(p); };
  const order = preview ?? saved;
  const [editing, setEditing] = useState(false);
  const [picking, setPicking] = useState(false);
  const phone = usePhone();

  const save = useMutation({
    mutationFn: async (keys: string[]) => (await apiRequest("PUT", "/api/host/shortcuts", { keys })).json() as Promise<Saved>,
    onMutate: (keys) => {
      const before = queryClient.getQueryData<Saved>(QK);
      queryClient.setQueryData<Saved>(QK, { keys, max, readOnly: false });
      return { before };
    },
    onError: (e: Error, _k, ctx) => {
      if (ctx?.before) queryClient.setQueryData(QK, ctx.before);
      toast({ title: "Couldn't save your shortcuts", description: e.message.replace(/^\d+:\s*/, ""), variant: "destructive" });
    },
    onSuccess: (d) => queryClient.setQueryData(QK, d),
  });
  const commit = (keys: string[]) => { if (keys.join() !== saved.join()) save.mutate(keys); };

  // ── Dragging ────────────────────────────────────────────────────────────────
  // Mouse: drag any card at any time (it starts after a few pixels, so a click is still a click).
  // Touch: press and hold picks the card up (a scroll before then is a scroll); in Edit they drag straight away.
  const els = useRef(new Map<string, HTMLElement>());
  const drag = useRef<{ key: string; id: number; x0: number; y0: number; ox: number; oy: number; w: number; h: number; on: boolean; moved: boolean } | null>(null);
  const [ghost, setGhost] = useState<{ key: string; x: number; y: number; w: number; h: number } | null>(null);
  const hold = useRef<number | null>(null);
  const swallowClick = useRef(false);

  useEffect(() => () => { if (hold.current) window.clearTimeout(hold.current); }, []);

  const onPointerDown = (e: React.PointerEvent, key: string) => {
    if (readOnly || e.button !== 0) return;
    const el = els.current.get(key);
    if (!el) return;
    const r = el.getBoundingClientRect();
    drag.current = { key, id: e.pointerId, x0: e.clientX, y0: e.clientY, ox: e.clientX - r.left, oy: e.clientY - r.top, w: r.width, h: r.height, on: false, moved: false };
    if (e.pointerType !== "mouse" && !editing) {
      const cur = order;
      hold.current = window.setTimeout(() => {
        hold.current = null;
        const d = drag.current;
        if (!d || d.moved) { drag.current = null; return; }
        d.on = true;
        swallowClick.current = true;
        navigator.vibrate?.(10);
        setPreview(cur);
        setGhost({ key: d.key, x: d.x0 - d.ox, y: d.y0 - d.oy, w: d.w, h: d.h });
      }, 450);
    }
  };

  useEffect(() => {
    const move = (e: PointerEvent) => {
      const d = drag.current;
      if (!d || e.pointerId !== d.id) return;
      const far = Math.hypot(e.clientX - d.x0, e.clientY - d.y0) > 6;
      if (far) d.moved = true;
      if (!d.on) {
        if (!far) return;
        if (hold.current) { window.clearTimeout(hold.current); hold.current = null; drag.current = null; return; } // a scroll, not a hold
        if (e.pointerType !== "mouse" && !editing) { drag.current = null; return; }
        d.on = true;
        setPreview(order);
      }
      e.preventDefault();
      setGhost({ key: d.key, x: e.clientX - d.ox, y: e.clientY - d.oy, w: d.w, h: d.h });
      // Over another card: take its place.
      for (const [k, el] of Array.from(els.current.entries())) {
        if (k === d.key) continue;
        const r = el.getBoundingClientRect();
        if (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) {
          const cur = previewRef.current ?? order;
          const from = cur.indexOf(d.key), to = cur.indexOf(k);
          if (from >= 0 && to >= 0 && from !== to) {
            const nxt = cur.slice();
            nxt.splice(from, 1);
            nxt.splice(to, 0, d.key);
            setPreview(nxt);
          }
          break;
        }
      }
    };
    const up = (e: PointerEvent) => {
      const d = drag.current;
      if (hold.current) { window.clearTimeout(hold.current); hold.current = null; }
      if (!d || e.pointerId !== d.id) return;
      drag.current = null;
      if (d.on) {
        swallowClick.current = true;
        setGhost(null);
        const p = previewRef.current;
        setPreview(null);
        if (p) commit(p);
      }
    };
    // A card picked up by a finger: the page mustn't scroll under it.
    const noScroll = (e: TouchEvent) => { if (drag.current?.on && e.cancelable) e.preventDefault(); };
    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    window.addEventListener("touchmove", noScroll, { passive: false });
    return () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); window.removeEventListener("pointercancel", up); window.removeEventListener("touchmove", noScroll); };
  });

  const remove = (key: string) => commit(order.filter((k) => k !== key));
  const add = (key: string) => { commit([...order, key]); setPicking(false); };

  const card = (s: Shortcut, opts: { next?: boolean; slot?: boolean; pinned?: boolean } = {}) => {
    const dragging = ghost?.key === s.key;
    if (dragging) {
      return <div key={s.key} ref={(el) => { if (el) els.current.set(s.key, el); else els.current.delete(s.key); }} className="h-16 rounded-2xl border-2 border-dashed border-[#053877]/35 bg-[#053877]/[0.04]" aria-hidden />;
    }
    const fixed = opts.next || opts.pinned;
    const canDrag = !readOnly && !fixed;
    return (
      <div key={s.key} ref={(el) => { if (!fixed) { if (el) els.current.set(s.key, el); else els.current.delete(s.key); } }} className="relative">
        <button
          type="button"
          onPointerDown={canDrag ? (e) => onPointerDown(e, s.key) : undefined}
          onClick={() => {
            if (swallowClick.current) { swallowClick.current = false; return; }
            if (editing && !fixed) return;
            s.go();
          }}
          onContextMenu={canDrag ? (e) => e.preventDefault() : undefined}
          aria-expanded={s.expands ? !!s.active : undefined}
          className={`group flex h-16 w-full select-none items-center gap-2 sm:gap-2.5 rounded-2xl bg-card px-2 py-2.5 text-left shadow-sm sm:px-3 transition-colors hover:bg-muted/40 [-webkit-touch-callout:none] ${opts.pinned ? "border-2 border-teal-700 bg-gradient-to-br from-teal-50 to-card to-60% dark:border-teal-400 dark:from-teal-950/40" : opts.next || s.active ? "border-2 border-[#053877] dark:border-[#8ab4f8]" : "border border-border"} ${s.active ? "shadow-[0_6px_18px_rgba(5,56,119,0.14)]" : ""} ${canDrag ? "lg:cursor-grab" : ""} ${editing && canDrag ? "touch-none sm:pr-7" : ""}`}
          data-testid={fixed ? s.key : `door-${s.key}`}
        >
          <Art3D name={s.art} size={36} className="h-8 w-8 shrink-0 sm:h-9 sm:w-9" />
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1.5 text-sm font-semibold leading-tight text-foreground">
              <span className="min-w-0 truncate">{s.title}</span>
              {s.tag && <span className="shrink-0 rounded-full bg-[#F0A71F]/20 px-1.5 py-px text-[10px] font-semibold leading-4 text-[#8a5a00] dark:text-[#F0A71F]">{s.tag}</span>}
            </span>
            <span className="mt-0.5 block truncate text-xs leading-snug text-muted-foreground">
              {s.score != null && <span className="mr-1.5 inline-block rounded-full bg-green-100 px-1.5 text-[10.5px] font-bold leading-4 text-green-800 dark:bg-green-900/50 dark:text-green-200" title="Audience credibility, out of 100">{s.score}</span>}
              {s.phoneHint ? <><span className="sm:hidden">{s.phoneHint}</span><span className="hidden sm:inline">{s.hint}</span></> : s.hint}
            </span>
          </span>
          {canDrag && <GripVertical className={`absolute right-1.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/70 ${editing ? "hidden sm:block" : "hidden opacity-0 transition-opacity group-hover:opacity-100 lg:block"}`} aria-hidden />}
        </button>
        {editing && !fixed && (
          <button type="button" onClick={() => remove(s.key)} aria-label={`Remove ${s.title}`} className="absolute -right-2 -top-2 z-10 flex h-6 w-6 items-center justify-center rounded-full bg-slate-700 text-white shadow ring-2 ring-background hover:bg-slate-900" data-testid={`shortcut-remove-${s.key}`}>
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    );
  };

  const items = order.map((k) => byKey.get(k)!).filter(Boolean);
  const canAdd = !readOnly && order.length < max;
  // On a phone (two across) the tile fills the empty half of the last row, or a row of its own.
  const filled = items.length + (pinned ? 1 : 0) + (next ? 1 : 0);
  const addTile = (
    <button type="button" onClick={() => setPicking(true)} className="flex h-16 w-full items-center gap-2.5 rounded-2xl border-[1.5px] border-dashed border-border px-3 py-2.5 text-left text-sm font-semibold text-[#053877] hover:border-[#053877]/50 hover:bg-[#053877]/[0.03] dark:text-[#8ab4f8]" data-testid="shortcut-add">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#053877]/[0.08] dark:bg-white/10"><Plus className="h-5 w-5" /></span>
      Add a shortcut
    </button>
  );
  const ghostCard = ghost && byKey.get(ghost.key);

  return (
    <div className="mt-5" data-testid="shortcuts">
      <div className="mb-2 flex min-h-[26px] items-center gap-1.5 whitespace-nowrap text-xs font-semibold">
        <span className="uppercase tracking-[0.08em] text-foreground">Shortcuts</span>
        {editing ? (
          <>
            <span className="hidden truncate font-normal text-muted-foreground sm:inline">· × to remove, drag to arrange</span>
            <button type="button" onClick={() => setEditing(false)} className="ml-auto rounded-full bg-[#053877] px-3 py-1 text-xs font-semibold text-white hover:bg-[#0a4a99]" data-testid="shortcuts-done">Done</button>
          </>
        ) : !readOnly ? (
          <>
            <span aria-hidden className="text-muted-foreground">·</span>
            <button type="button" onClick={() => setEditing(true)} className="text-primary hover:underline" data-testid="shortcuts-edit">Edit</button>
          </>
        ) : null}
      </div>
      <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4 lg:gap-3" data-testid="todo-strip">
        {pinned && card(pinned, { pinned: true })}
        {next && card(next, { next: true })}
        {items.map((s) => card(s))}
        {canAdd && <div className={filled % 2 ? "lg:col-span-1" : "col-span-2 lg:col-span-1"}>{addTile}</div>}
      </div>
      {ghost && ghostCard && (
        <div className="pointer-events-none fixed z-[60]" style={{ left: ghost.x, top: ghost.y, width: ghost.w }}>
          <div className="flex h-16 rotate-[-1.5deg] items-center gap-2.5 rounded-2xl border-2 border-[#053877] bg-card px-3 py-2.5 shadow-[0_18px_40px_rgba(16,24,40,0.22)]">
            <Art3D name={ghostCard.art} size={36} className="shrink-0" />
            <span className="min-w-0"><span className="block truncate text-sm font-semibold leading-tight text-foreground">{ghostCard.title}</span><span className="mt-0.5 block truncate text-xs text-muted-foreground">{ghostCard.phoneHint && phone ? ghostCard.phoneHint : ghostCard.hint}</span></span>
          </div>
        </div>
      )}
      <Picker open={picking} onOpenChange={setPicking} phone={phone} catalog={catalog} order={order} max={max} onAdd={add} />
    </div>
  );
}

function Picker({ open, onOpenChange, phone, catalog, order, max, onAdd }: { open: boolean; onOpenChange: (v: boolean) => void; phone: boolean; catalog: Shortcut[]; order: string[]; max: number; onAdd: (k: string) => void }) {
  const list = (
    <div className={`mt-3 grid gap-2 ${phone ? "" : "sm:grid-cols-2"}`}>
      {catalog.map((c) => {
        const added = order.includes(c.key);
        return (
          <button key={c.key} type="button" disabled={added} onClick={() => onAdd(c.key)} className="flex items-center gap-2.5 rounded-xl border border-border px-3 py-2.5 text-left transition-colors hover:border-[#053877]/50 hover:bg-[#053877]/[0.03] disabled:cursor-default disabled:opacity-55 disabled:hover:border-border disabled:hover:bg-transparent" data-testid={`shortcut-pick-${c.key}`}>
            <Art3D name={c.art} size={32} className="shrink-0" />
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold text-foreground">{c.title}</span>
              <span className="block text-xs leading-snug text-muted-foreground">{c.hint}</span>
            </span>
            {added && <span className="flex shrink-0 items-center gap-1 text-xs font-semibold text-emerald-700 dark:text-emerald-400"><Check className="h-3.5 w-3.5" /> Added</span>}
          </button>
        );
      })}
    </div>
  );
  const count = <span className="text-sm text-muted-foreground tabular-nums">{order.length} of {max}</span>;
  if (phone) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto rounded-t-2xl px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-5">
          <div className="flex items-baseline justify-between pr-8"><SheetTitle className="text-lg">Add a shortcut</SheetTitle>{count}</div>
          {list}
        </SheetContent>
      </Sheet>
    );
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl rounded-2xl">
        <div className="flex items-baseline justify-between pr-8"><DialogTitle className="text-xl">Add a shortcut</DialogTitle>{count}</div>
        <DialogDescription>Pick a page to keep on your dashboard.</DialogDescription>
        {list}
      </DialogContent>
    </Dialog>
  );
}

function usePhone() {
  const q = "(max-width: 639px)";
  const [on, setOn] = useState(() => typeof window !== "undefined" && window.matchMedia(q).matches);
  useEffect(() => { const m = window.matchMedia(q); const f = () => setOn(m.matches); m.addEventListener("change", f); return () => m.removeEventListener("change", f); }, []);
  return on;
}
