// Choose a setup, Start from a template and Save this setup as… (Andrew, 24 Nov, approved with the mockup, boards 7
// and 8). A setup is the studio's scenes, Media and look saved under a name, kept per show. The host picks one before
// the camera check; in the studio, Scenes ⋯ saves today's or adds a template's scenes. Guests never see any of it.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, Loader2, MoreHorizontal, X } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { TEMPLATES, freeName, type TemplateId } from "@shared/studioTemplates";
import { LIMITS, newId, type RoomKit, type Scene } from "./look";
import { ScenePicture } from "./ScenesPanel";
import { Select } from "./Select";

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

/** Each layout's own colour (Andrew, 26 Nov: "let's add some color"), and saved setups cycle through a few more. */
const TEMPLATE_BG: Record<string, string> = { interview: "linear-gradient(135deg,#0b3a8a,#1d5fc4)", solo: "linear-gradient(135deg,#0e7490,#14a3a3)", panel: "linear-gradient(135deg,#5b21b6,#8b5cf6)" };
const SAVED_BG = ["linear-gradient(135deg,#be123c,#f43f5e)", "linear-gradient(135deg,#047857,#10b981)", "linear-gradient(135deg,#b45309,#f59e0b)", "linear-gradient(135deg,#1e3a8a,#6366f1)"];

/** One picture tile: the layout, its name, a spinner while it's being set up. */
function Tile({ onClick, disabled, busy, label, testId, children }: { onClick: () => void; disabled: boolean; busy: boolean; label: string; testId: string; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} className="flex w-full flex-col gap-2 rounded-2xl border border-[#e4e7ec] bg-white p-2 text-left transition-colors hover:border-[#053877] disabled:opacity-60" data-testid={testId}>
      <span className="block aspect-video w-full overflow-hidden rounded-xl">{children}</span>
      <span className="flex items-center gap-2 px-1 pb-0.5 pr-9"><span className="truncate text-[15px] font-bold text-[#101828]">{label}</span>{busy && <Loader2 className="h-4 w-4 shrink-0 animate-spin text-[#667085]" />}</span>
    </button>
  );
}

/* ───────────────────────── Choose a setup (before the camera check) ───────────────────────── */

export function ChooseSetup({ roomName, shows, showId, onShow, v3, onDone, logo }: {
  roomName: string; shows?: { id: number; title: string }[]; showId?: number | null; onShow?: (id: number) => void; v3: boolean;
  onDone: (name: string) => void; logo: ReactNode;
}) {
  const qc = useQueryClient();
  const q = useSetups(showId);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [menu, setMenu] = useState("");
  const [renaming, setRenaming] = useState<Card | null>(null);
  const [deleting, setDeleting] = useState<Card | null>(null);
  const saved = q.data?.setups ?? [];
  // Smaller pictures in the 2-across phone tiles, so the layout fits inside them.
  const narrow = typeof window !== "undefined" && window.innerWidth < 640;

  // The studio's look changed on the server: the studio loads it fresh when they go in.
  // Blank also switches the destinations off, so the studio's own answer is read again too.
  const changed = () => { qc.removeQueries({ queryKey: LOOK_KEY }); void qc.invalidateQueries({ queryKey: [SETUPS_KEY] }); void qc.invalidateQueries({ queryKey: ["/api/host/my-studio"], exact: true }); void qc.invalidateQueries({ queryKey: ["/api/host/live-page"] }); };
  const run = async (what: string, fn: () => Promise<unknown>, name: string) => {
    setBusy(what); setError("");
    try { await fn(); changed(); onDone(name); }
    catch (e) { setError(say(e)); setBusy(""); }
  };
  const use = (c: Card) => run(c.id, () => apiRequest("POST", `${SETUPS_KEY}/${c.id}/use`), c.name);
  const fresh = (t: TemplateId | "blank", name: string) => run(t, () => apiRequest("POST", `${SETUPS_KEY}/fresh`, { template: t, v3 }), name);
  const act = async (fn: () => Promise<unknown>) => {
    setError("");
    try { await fn(); await q.refetch(); } catch (e) { setError(say(e)); }
  };

  return (
    <div className="min-h-screen bg-[#f3f4f7] text-[#101828]" data-testid="choose-setup">
      <header className="flex h-16 items-center gap-4 border-b border-[#e4e7ec] bg-white px-5">
        {logo}
        <a href="/host/dashboard/studio" className="ml-auto flex shrink-0 items-center gap-1.5 whitespace-nowrap text-sm font-semibold text-[#475467] hover:text-[#101828]"><ArrowLeft className="h-4 w-4" /> <span className="sm:hidden">Dashboard</span><span className="hidden sm:inline">Back to your dashboard</span></a>
      </header>
      {/* How do you want to start? (Andrew, 26 Nov: "hard to follow - takes too much thinking power"): one big Continue,
          then the layouts as pictures. Saved setups only once there are some; no explainer, no how-to, no footer. */}
      <main className="mx-auto flex max-w-[1040px] flex-col gap-6 px-4 py-6 lg:px-8 lg:py-8">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
          <div className="flex-1">
            {roomName && <p className="text-sm font-semibold uppercase tracking-[0.08em] text-[#667085]">{roomName}</p>}
            <h1 className="mt-1 text-balance text-[28px] font-bold leading-tight tracking-tight">How do you want to&nbsp;start?</h1>
          </div>
          {shows && shows.length > 1 && onShow && (
            <div className="flex w-full flex-col gap-1 sm:w-[280px]">
              <label htmlFor="setup-show" className="text-[13px] font-semibold">Show</label>
              <Select wrap="w-full" id="setup-show" value={showId ?? ""} onChange={(e) => { const id = Number(e.target.value); if (id) onShow(id); }} className="h-11 rounded-xl border border-[#d0d5dd] bg-white pl-3 text-[15px] outline-none focus:border-[#053877] focus:ring-2 focus:ring-[#053877]/15" data-testid="studio-show">
                {showId == null && <option value="">Pick a show</option>}
                {shows.map((x) => <option key={x.id} value={x.id}>{x.title}</option>)}
              </Select>
            </div>
          )}
        </div>

        {error && <p className="rounded-xl bg-[#fef3f2] px-4 py-3 text-sm font-medium text-[#b42318]" role="alert">{error}</p>}

        {q.isLoading ? (
          <div className="flex h-40 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-[#667085]" /></div>
        ) : <>
          {q.data?.current && (
            <button type="button" onClick={() => onDone(q.data!.current!.name)} disabled={!!busy} className="group flex flex-col gap-4 rounded-[20px] border-2 border-[#053877] bg-gradient-to-r from-[#eef4ff] via-white to-white p-3 text-left shadow-[0_8px_24px_rgba(16,24,40,0.08)] transition-shadow hover:shadow-[0_12px_32px_rgba(5,56,119,0.18)] disabled:opacity-60 sm:flex-row sm:items-center sm:gap-6 sm:p-4" data-testid="setup-continue">
              <span className="block aspect-video w-full shrink-0 overflow-hidden rounded-xl sm:w-[360px]"><ScenePicture s={q.data.current.first} scale={narrow ? 1.6 : 2.2} bg="linear-gradient(135deg,#0b3a8a,#1d5fc4)" /></span>
              <span className="flex min-w-0 flex-1 flex-col gap-3">
                <span className="min-w-0">
                  <span className="block text-[22px] font-bold leading-tight">Continue where you left&nbsp;off</span>
                  <span className="mt-1 block truncate text-[14px] text-[#667085]">{[q.data.current.name, q.data.current.usedAt && `last used ${day(q.data.current.usedAt)}`].filter(Boolean).join(" · ")}</span>
                </span>
                <span className="inline-flex h-12 items-center justify-center gap-2 self-stretch rounded-xl px-7 text-[16px] font-bold text-white sm:self-start" style={{ background: NAVY }} data-testid="setup-continue-go">Continue <ArrowRight className="h-5 w-5 transition-transform group-hover:translate-x-0.5" /></span>
              </span>
            </button>
          )}

          {saved.length > 0 && (
            <section className="flex flex-col gap-2.5">
              <h2 className="text-base font-bold">Your setups</h2>
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                {saved.map((c, i) => (
                  <div key={c.id} className="relative" data-testid="setup-card">
                    <Tile onClick={() => void use(c)} disabled={!!busy} busy={busy === c.id} label={c.name} testId="setup-use">
                      <ScenePicture s={c.first} scale={narrow ? 0.9 : 1.35} bg={SAVED_BG[i % SAVED_BG.length]} />
                    </Tile>
                    <button type="button" onClick={() => setMenu(menu === c.id ? "" : c.id)} aria-label={`More for ${c.name}`} aria-expanded={menu === c.id} className={`absolute bottom-2 right-2 flex h-8 w-8 items-center justify-center rounded-lg ${menu === c.id ? "bg-[#f5f8fd] text-[#053877]" : "text-[#475467] hover:bg-[#f2f4f7]"}`} data-testid="setup-more"><MoreHorizontal className="h-4 w-4" /></button>
                    {menu === c.id && (
                      <Menu onClose={() => setMenu("")} className="right-2 top-[calc(100%-4px)]">
                        <MenuItem onClick={() => { setMenu(""); setRenaming(c); }} testId="setup-rename">Rename</MenuItem>
                        <MenuItem onClick={() => { setMenu(""); void act(() => apiRequest("POST", `${SETUPS_KEY}/${c.id}/duplicate`)); }} testId="setup-duplicate">Duplicate</MenuItem>
                        <MenuItem onClick={() => { setMenu(""); setDeleting(c); }} danger testId="setup-delete">Delete</MenuItem>
                      </Menu>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}

          <section className="flex flex-col gap-2.5">
            <h2 className="text-base font-bold">{q.data?.current || saved.length ? "Or start new" : "Pick a layout"}</h2>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              {TEMPLATES.map((t) => {
                const scenes = t.scenes(v3);
                // The picture that says the most about the layout: the first scene, or the slides scene for Solo.
                const pic = t.id === "solo" ? scenes.find((x) => x.type === "media" && (x.people ?? 0) > 0) ?? scenes[0] : scenes[0];
                return (
                  <Tile key={t.id} onClick={() => void fresh(t.id, t.name)} disabled={!!busy} busy={busy === t.id} label={t.name} testId={`setup-template-${t.id}`}>
                    <ScenePicture s={pic} scale={narrow ? 0.82 : 1.2} bg={TEMPLATE_BG[t.id] ?? "#0b3a8a"} />
                  </Tile>
                );
              })}
              <Tile onClick={() => void fresh("blank", "Start blank")} disabled={!!busy} busy={busy === "blank"} label="Blank" testId="setup-blank">
                <span className="flex h-full w-full items-center justify-center rounded-xl border-2 border-dashed border-[#F0A71F]/70 bg-[#FFF8E8] text-[13px] font-semibold text-[#8a5a00]">Empty stage</span>
              </Tile>
            </div>
          </section>
        </>}
      </main>

      {renaming && (
        <NameDialog title="Rename setup" start={renaming.name} cta="Rename" onClose={() => setRenaming(null)}
          onSave={async (name) => { await apiRequest("PATCH", `${SETUPS_KEY}/${renaming.id}`, { name }); await q.refetch(); setRenaming(null); }} />
      )}
      {deleting && (
        <Dialog title={`Delete ${deleting.name}?`} onClose={() => setDeleting(null)}>
          <p className="text-sm text-[#475467]">This setup goes for good. Your studio as it is now stays the same.</p>
          <div className="mt-5 flex justify-end gap-2">
            <button type="button" onClick={() => setDeleting(null)} className="h-10 rounded-xl border border-[#d0d5dd] bg-white px-4 text-sm font-semibold">Cancel</button>
            <button type="button" onClick={() => { const c = deleting; setDeleting(null); void act(() => apiRequest("DELETE", `${SETUPS_KEY}/${c.id}`)); }} className="h-10 rounded-xl bg-[#d92d20] px-4 text-sm font-bold text-white" data-testid="setup-delete-go">Delete</button>
          </div>
        </Dialog>
      )}
    </div>
  );
}

/** On the camera check: which setup they picked, and a way back to change it. */
export function SetupLine({ name, onChange }: { name: string; onChange: () => void }) {
  return (
    <div className="mt-5 flex items-center gap-2.5 rounded-[10px] border border-[#e4e7ec] bg-white px-3 py-2.5" data-testid="setup-line">
      <div className="min-w-0 flex-1">
        <p className="text-xs text-[#667085]">Setup</p>
        <p className="truncate text-sm font-semibold">{name}</p>
      </div>
      <button type="button" onClick={onChange} className="text-sm font-semibold text-[#053877] hover:underline" data-testid="setup-change">Change</button>
    </div>
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
        toast({ title: r.updated ? `Updated ${n}` : `Saved ${n}`, description: "Pick it on Choose a setup next time you come in." });
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
