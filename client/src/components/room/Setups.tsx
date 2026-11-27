// Saved studios, Start from a template and Save this setup as… A setup is the studio's scenes, Media and look saved
// under a name. Since 27 Nov (Andrew: "Build A (rows)") the dashboard's Studio page lists them as rows and Open loads
// one; there's no picker before the camera check. In the studio, Scenes ⋯ saves today's or adds a template's scenes.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, MoreHorizontal, X } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { TEMPLATES, freeName, type TemplateId } from "@shared/studioTemplates";
import { LIMITS, newId, type RoomKit, type Scene } from "./look";
import { ScenePicture } from "./ScenesPanel";

const NAVY = "#053877";
const LOOK_KEY = ["/api/host/room/look"];
const say = (e: unknown) => ((e as Error).message ?? "").replace(/^\d+:\s*/, "").replace(/^\{"message":"|"\}$/g, "") || "Try again in a moment.";
const day = (iso: string) => (iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "");
const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

type First = Partial<Scene> | null;
type Card = { id: string; name: string; savedAt: string; usedAt: string; auto: boolean; scenes: number; clips: number; first: First };
type Current = { name: string; usedAt: string; scenes: number; clips: number; first: First };
type Setups = { current: Current | null; setups: Card[] };
const SETUPS_KEY = "/api/host/my-studio/setups";

function useSetups(showId: number | null | undefined) {
  return useQuery<Setups>({ queryKey: [SETUPS_KEY, showId ?? null], queryFn: async () => (await apiRequest("GET", SETUPS_KEY)).json(), retry: false, staleTime: 0 });
}

/**
 * The saved studio the room is in now, by name: the one whose scenes match today's (Andrew, 27 Nov: he renamed his saved
 * studio and the Show panel still read the old name). "" when today's look isn't a saved studio (or was changed since).
 */
export function useCurrentStudioName(): string {
  const q = useSetups(null);
  const n = q.data?.current?.name ?? "";
  return n === "Last time" ? "" : n;
}

/** Each layout's own colour (Andrew, 26 Nov: "let's add some color"), and saved setups cycle through a few more. */
const TEMPLATE_BG: Record<string, string> = { interview: "linear-gradient(135deg,#0b3a8a,#1d5fc4)", solo: "linear-gradient(135deg,#0e7490,#14a3a3)", panel: "linear-gradient(135deg,#5b21b6,#8b5cf6)" };
const SAVED_BG = ["linear-gradient(135deg,#be123c,#f43f5e)", "linear-gradient(135deg,#047857,#10b981)", "linear-gradient(135deg,#b45309,#f59e0b)", "linear-gradient(135deg,#1e3a8a,#6366f1)"];

/** The row colours, in the order the mockup shows them: the layouts' own, then the saved ones'. */
const ROW_BG = [...Object.values(TEMPLATE_BG), ...SAVED_BG];

/* ───────────────────────── Saved studios (the dashboard's Studio page) ───────────────────────── */

/**
 * Saved studios as rows, like Your files (Andrew, 27 Nov: "Build A (rows)"; exports/studio-page-mockup). There's no
 * "How do you want to start?" page any more: Enter my studio opens the studio as it was left, and Open here loads a
 * saved one first. A studio is saved from inside the studio (Scenes ⋯ → Save this setup as…). One show per profile.
 */
export function SavedStudios({ locked }: { locked: boolean }) {
  const q = useSetups(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [menu, setMenu] = useState("");
  const [renaming, setRenaming] = useState<Card | null>(null);
  const [deleting, setDeleting] = useState<Card | null>(null);
  const list = q.data?.setups ?? [];
  const last = q.data?.current?.name ?? "";
  if (q.isError) return null; // no studio yet: the first visit makes it
  const open = async (c: Card) => {
    setBusy(c.id); setError("");
    try { await apiRequest("POST", `${SETUPS_KEY}/${c.id}/use`); window.location.href = "/my-studio"; }
    catch (e) { setError(say(e)); setBusy(""); }
  };
  const act = async (fn: () => Promise<unknown>) => {
    setError("");
    try { await fn(); await q.refetch(); } catch (e) { setError(say(e)); }
  };
  return (
    <section data-testid="saved-studios">
      <h2 className="flex items-center gap-2 text-base font-bold">
        <span className="relative h-5 w-6 rounded bg-gradient-to-br from-[#ffd27a] to-[#F0A71F] before:absolute before:-top-1 before:left-0 before:h-1.5 before:w-2.5 before:rounded-t before:bg-[#f5b94a]" aria-hidden />
        Saved studios {q.data && <span className="text-xs font-medium text-muted-foreground">{list.length}</span>}
      </h2>
      {error && <p className="mt-2 rounded-xl bg-[#fef3f2] px-4 py-2.5 text-sm font-medium text-[#b42318]" role="alert">{error}</p>}
      <div className="mt-2.5 rounded-2xl border border-border bg-card">
        {q.isLoading ? (
          <div className="flex h-24 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : !list.length ? (
          <p className="px-4 py-3.5 text-sm text-muted-foreground">Nothing saved yet. In your studio, open Scenes ⋯ and pick <span className="font-semibold text-foreground">Save this setup as…</span></p>
        ) : <>
          <div className="hidden grid-cols-[minmax(0,1fr)_190px_120px_64px_36px] gap-3.5 border-b border-border px-4 py-2 text-xs text-muted-foreground sm:grid">
            <span>Name</span><span>Details</span><span>Last used</span><span /><span />
          </div>
          {list.map((c, i) => {
            const details = [plural(c.scenes, "scene"), c.clips ? plural(c.clips, "clip") : ""].filter(Boolean).join(" · ");
            const when = day(c.usedAt || c.savedAt);
            const isLast = !!last && c.name === last;
            return (
              <div key={c.id} className="grid grid-cols-[minmax(0,1fr)_auto_32px] items-center gap-2 border-b border-border px-3 py-2.5 last:border-b-0 sm:grid-cols-[minmax(0,1fr)_190px_120px_64px_36px] sm:gap-3.5 sm:px-4" data-testid="saved-studio">
                <span className="flex min-w-0 items-center gap-2.5">
                  <span className="h-6 w-10 shrink-0 rounded-[5px]" style={{ background: ROW_BG[i % ROW_BG.length] }} aria-hidden />
                  <span className="min-w-0">
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="truncate text-sm font-semibold">{c.name}</span>
                      {isLast && <span className="hidden shrink-0 rounded-full bg-[#ecfdf3] px-2 py-0.5 text-[11px] font-semibold text-[#027a48] sm:inline">Last used</span>}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground sm:hidden">{[isLast ? "Last used" : when, details].filter(Boolean).join(" · ")}</span>
                  </span>
                </span>
                <span className="hidden truncate text-sm text-muted-foreground sm:block">{details}</span>
                <span className="hidden text-sm text-muted-foreground sm:block">{when}</span>
                <button type="button" onClick={() => void open(c)} disabled={locked || !!busy} title={locked ? "You're live or recording. Change scenes inside your studio." : undefined}
                  className="flex h-8 items-center justify-end gap-1 text-sm font-semibold text-[#053877] hover:underline disabled:opacity-50 disabled:no-underline dark:text-white" data-testid="saved-studio-open">
                  {busy === c.id && <Loader2 className="h-3.5 w-3.5 animate-spin" />}Open
                </button>
                <span className="relative flex justify-center">
                  <button type="button" onClick={() => setMenu(menu === c.id ? "" : c.id)} aria-label={`More for ${c.name}`} aria-expanded={menu === c.id} className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted" data-testid="saved-studio-more"><MoreHorizontal className="h-4 w-4" /></button>
                  {menu === c.id && (
                    <Menu onClose={() => setMenu("")} className="right-0 top-9 w-32">
                      <MenuItem onClick={() => { setMenu(""); setRenaming(c); }} testId="setup-rename">Rename</MenuItem>
                      <MenuItem onClick={() => { setMenu(""); setDeleting(c); }} danger testId="setup-delete">Delete</MenuItem>
                    </Menu>
                  )}
                </span>
              </div>
            );
          })}
        </>}
      </div>

      {renaming && (
        <NameDialog title="Rename" start={renaming.name} cta="Rename" onClose={() => setRenaming(null)}
          onSave={async (name) => { await apiRequest("PATCH", `${SETUPS_KEY}/${renaming.id}`, { name }); await q.refetch(); setRenaming(null); }} />
      )}
      {deleting && (
        <Dialog title={`Delete ${deleting.name}?`} onClose={() => setDeleting(null)}>
          <p className="text-sm text-[#475467]">This saved studio goes for good. Your studio as it is now stays the same.</p>
          <div className="mt-5 flex justify-end gap-2">
            <button type="button" onClick={() => setDeleting(null)} className="h-10 rounded-xl border border-[#d0d5dd] bg-white px-4 text-sm font-semibold">Cancel</button>
            <button type="button" onClick={() => { const c = deleting; setDeleting(null); void act(() => apiRequest("DELETE", `${SETUPS_KEY}/${c.id}`)); }} className="h-10 rounded-xl bg-[#d92d20] px-4 text-sm font-bold text-white" data-testid="setup-delete-go">Delete</button>
          </div>
        </Dialog>
      )}
    </section>
  );
}

/* ───────────────────────── In the studio: Scenes ⋯ ───────────────────────── */

/** Scenes ⋯ in the studio: Start from a template… and Save this setup as…. */
export function SetupMenuButton({ onTemplate, onSave }: { onTemplate: () => void; onSave: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen(!open)} aria-label="More for scenes" aria-expanded={open} className={`flex h-8 w-8 items-center justify-center rounded-lg border ${open ? "border-[#053877] bg-[#f5f8fd] text-[#053877]" : "border-[#e4e7ec] bg-white text-[#475467] hover:bg-[#f9fafb]"}`} data-testid="scenes-more"><MoreHorizontal className="h-4 w-4" /></button>
      {open && (
        <Menu onClose={() => setOpen(false)} className="right-0 top-9 w-[188px]">
          <MenuItem onClick={() => { setOpen(false); onTemplate(); }} testId="scenes-template">Start from a template…</MenuItem>
          <MenuItem onClick={() => { setOpen(false); onSave(); }} testId="scenes-save-setup">Save this setup as…</MenuItem>
        </Menu>
      )}
    </div>
  );
}

/** Adds a template's scenes after the host's own: never on air, a name in use gets a 2, and the studio's limit holds. */
export function TemplatesDialog({ kit, v3, onClose }: { kit: RoomKit; v3: boolean; onClose: () => void }) {
  const { toast } = useToast();
  const room = LIMITS.scenes - (kit.look?.scenes.length ?? 0);
  const add = (id: TemplateId) => {
    const t = TEMPLATES.find((x) => x.id === id)!;
    const all = t.scenes(v3);
    const fit = all.slice(0, Math.max(0, room));
    if (!fit.length) return;
    kit.change((l) => {
      const taken = new Set(l.scenes.map((s) => s.name));
      const last = l.scenes.reduce((m, s) => Math.max(m, s.n), 0);
      const added: Scene[] = fit.map((x, i) => {
        const name = freeName(x.name, taken);
        taken.add(name);
        return { ...x, id: newId(), n: last + 1 + i, name, stage: [], ...(x.boxes ? { boxes: x.boxes.map((b) => ({ ...b })) } : {}), look: { background: l.background } } as Scene;
      });
      return { ...l, scenes: [...l.scenes, ...added] };
    });
    toast({ title: fit.length < all.length ? `Added ${fit.length} of ${all.length} scenes` : `Added ${t.name}`, description: fit.length < all.length ? `Your studio holds ${LIMITS.scenes} scenes. Delete one to make room for more.` : "At the end of your list. Nothing went on air." });
    onClose();
  };
  return (
    <Dialog title="Start from a template" onClose={onClose} testId="templates-dialog">
      <p className="text-sm text-[#475467]">Adds the template's scenes to the end of your list. Your own scenes stay, and nothing goes on air.</p>
      {room <= 0 && <p className="mt-3 rounded-lg bg-[#fffaeb] px-3 py-2 text-sm text-[#93370d]">Your studio holds {LIMITS.scenes} scenes. Delete one to add a template.</p>}
      <div className="mt-4 flex flex-col gap-2.5">
        {TEMPLATES.map((t) => {
          const scenes = t.scenes(v3);
          return (
            <button key={t.id} type="button" onClick={() => add(t.id)} disabled={room <= 0} className="flex items-center gap-3 rounded-xl border border-[#e4e7ec] bg-white p-2.5 text-left hover:border-[#98a2b3] disabled:opacity-50" data-testid={`template-${t.id}`}>
              <span className="h-[54px] w-24 shrink-0 overflow-hidden rounded-md"><ScenePicture s={scenes[0]} scale={0.7} /></span>
              <span className="min-w-0">
                <span className="block text-sm font-bold">{t.name} <span className="font-normal text-[#667085]">· {plural(scenes.length, "scene")}</span></span>
                <span className="block text-[13px] text-[#475467]">{t.line}</span>
                <span className="mt-0.5 block truncate text-xs text-[#667085]">{scenes.map((s) => s.name).join(", ")}</span>
              </span>
            </button>
          );
        })}
      </div>
    </Dialog>
  );
}

/** Save this setup as…: keeps today's scenes, Media and look for this show. The same name updates that setup. */
export function SaveSetupDialog({ show, showId, onClose }: { show: string; showId?: number | null; onClose: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const q = useSetups(showId);
  const [name, setName] = useState("");
  const [touched, setTouched] = useState(false);
  // Start with the name of the setup they're using, so saving again just updates it.
  useEffect(() => { if (!touched && q.data?.current && q.data.current.name !== "Last time") setName(q.data.current.name); }, [q.data, touched]);
  const same = (q.data?.setups ?? []).some((x) => !x.auto && x.name.toLowerCase() === name.trim().toLowerCase());
  return (
    <NameDialog title="Save this setup" start={name} controlled={{ value: name, set: (v) => { setTouched(true); setName(v); } }} cta="Save setup" testId="save-setup-dialog"
      line={`Keeps today's scenes, Media and look for ${show || "your studio"}. Guests and the practice guest aren't saved.`}
      warn={same ? "You already have a setup with this name. Saving updates it; type a new name to keep both." : ""}
      onClose={onClose}
      onSave={async (n) => {
        const r = await (await apiRequest("POST", SETUPS_KEY, { name: n })).json() as { updated?: boolean };
        void qc.invalidateQueries({ queryKey: [SETUPS_KEY] });
        toast({ title: r.updated ? `Updated ${n}` : `Saved ${n}`, description: "It's under Saved studios on your Studio page." });
        onClose();
      }} />
  );
}

/* ───────────────────────── Small pieces ───────────────────────── */

function Dialog({ title, onClose, children, testId }: { title: string; onClose: () => void; children: ReactNode; testId?: string }) {
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); }; window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, [onClose]);
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-[rgba(16,24,40,0.45)] p-4" onClick={onClose}>
      <div role="dialog" aria-modal aria-label={title} className="w-full max-w-[460px] rounded-2xl bg-white p-5 shadow-[0_24px_48px_rgba(16,24,40,0.24)]" onClick={(e) => e.stopPropagation()} data-testid={testId}>
        <div className="mb-2 flex items-start gap-3">
          <h2 className="flex-1 text-balance text-lg font-bold">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="-mr-1 -mt-1 flex h-8 w-8 items-center justify-center rounded-lg text-[#667085] hover:bg-[#f2f4f7]"><X className="h-5 w-5" /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

function NameDialog({ title, start, line, warn, cta, onSave, onClose, controlled, testId }: {
  title: string; start: string; line?: string; warn?: string; cta: string; onSave: (name: string) => Promise<void>; onClose: () => void;
  controlled?: { value: string; set: (v: string) => void }; testId?: string;
}) {
  const [own, setOwn] = useState(start);
  const value = controlled ? controlled.value : own;
  const set = controlled ? controlled.set : setOwn;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { input.current?.focus(); input.current?.select(); }, []);
  const save = async () => {
    const n = value.replace(/\s+/g, " ").trim();
    if (!n) { setError("Give it a name."); return; }
    setBusy(true); setError("");
    try { await onSave(n.slice(0, 60)); } catch (e) { setError(say(e)); setBusy(false); }
  };
  return (
    <Dialog title={title} onClose={onClose} testId={testId}>
      {line && <p className="text-sm text-[#475467]">{line}</p>}
      <label htmlFor="setup-name" className="mt-4 block text-sm font-semibold">Name</label>
      <input id="setup-name" ref={input} value={value} onChange={(e) => set(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void save(); }} maxLength={60} placeholder="e.g. Interview with a guest" className="mt-1.5 h-11 w-full rounded-xl border border-[#d0d5dd] bg-white px-3.5 text-[15px] outline-none focus:border-[#053877] focus:ring-2 focus:ring-[#053877]/15" data-testid="setup-name" />
      {warn && <p className="mt-2 text-[13px] text-[#93370d]" data-testid="setup-name-warn">{warn}</p>}
      {error && <p className="mt-2 text-sm font-medium text-[#b42318]">{error}</p>}
      <div className="mt-5 flex justify-end gap-2">
        <button type="button" onClick={onClose} className="h-10 rounded-xl border border-[#d0d5dd] bg-white px-4 text-sm font-semibold">Cancel</button>
        <button type="button" onClick={() => void save()} disabled={busy} className="flex h-10 items-center gap-1.5 rounded-xl px-4 text-sm font-bold text-white disabled:opacity-60" style={{ background: NAVY }} data-testid="setup-name-save">{busy && <Loader2 className="h-4 w-4 animate-spin" />}{cta}</button>
      </div>
    </Dialog>
  );
}

function Menu({ onClose, className, children }: { onClose: () => void; className: string; children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // Outside the menu and its own button's box (the button toggles it itself).
    const away = (e: PointerEvent) => { if (!(box.current?.parentElement ?? box.current)?.contains(e.target as Node)) onClose(); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    // Next tick, so the click that opened it doesn't close it.
    const t = window.setTimeout(() => window.addEventListener("pointerdown", away), 0);
    window.addEventListener("keydown", esc);
    return () => { clearTimeout(t); window.removeEventListener("pointerdown", away); window.removeEventListener("keydown", esc); };
  }, [onClose]);
  return <div ref={box} role="menu" className={`absolute z-20 w-40 rounded-xl border border-[#e4e7ec] bg-white p-1.5 shadow-[0_12px_24px_rgba(16,24,40,0.16)] ${className}`}>{children}</div>;
}

function MenuItem({ onClick, danger, children, testId }: { onClick: () => void; danger?: boolean; children: ReactNode; testId?: string }) {
  return <button type="button" role="menuitem" onClick={onClick} className={`block w-full rounded-lg px-2.5 py-2 text-left text-sm hover:bg-[#f5f8fd] ${danger ? "text-[#b42318]" : "text-[#101828]"}`} data-testid={testId}>{children}</button>;
}
