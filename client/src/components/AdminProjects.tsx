import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { adminGet, adminSend } from "@/lib/adminApi";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { Bot, Check, ChevronDown, Circle, CircleDot, HelpCircle, MessageSquare, Plus, Trash2, User, Users } from "lucide-react";

// Projects: the owner and Claude plan the platform's bigger builds together.
// A project is phases of tasks; each task says what state it's in, who has it,
// and carries a thread of notes. "Needs a decision" is the owner's queue.

type Note = { id: number; author: string; text: string; createdAt: string };
type Item = { id: number; projectId: number; phase: string; title: string; detail: string; status: string; owner: string; position: number; updatedAt: string; doneAt: string; notes: Note[] };
type Project = { id: number; name: string; goal: string; archived: boolean; total: number; done: number; decide: number };

const STATUS: Record<string, { label: string; icon: typeof Circle; tone: string }> = {
  todo: { label: "To do", icon: Circle, tone: "text-muted-foreground" },
  doing: { label: "In progress", icon: CircleDot, tone: "text-[#053877] dark:text-[#9cc2ff]" },
  decide: { label: "Needs a decision", icon: HelpCircle, tone: "text-[#b07400] dark:text-[#F0A71F]" },
  done: { label: "Done", icon: Check, tone: "text-emerald-600" },
};
const OWNER: Record<string, { label: string; icon: typeof User }> = {
  claude: { label: "Claude", icon: Bot },
  owner: { label: "Owner", icon: User },
  team: { label: "Team", icon: Users },
};
const VIEWS = [
  { key: "all", label: "Everything" },
  { key: "decide", label: "Needs a decision" },
  { key: "claude", label: "Claude's" },
  { key: "owner", label: "Owner's" },
  { key: "done", label: "Done" },
] as const;
type View = (typeof VIEWS)[number]["key"];

const when = (iso: string) => new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

export function AdminProjects() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const projects = useQuery<Project[]>({ queryKey: ["/api/admin/pm"], queryFn: () => adminGet("/api/admin/pm") });
  const live = (projects.data ?? []).filter((p) => !p.archived);
  const [picked, setPicked] = useState<number | null>(null);
  const current = live.find((p) => p.id === picked) ?? live[0];
  const items = useQuery<Item[]>({
    queryKey: ["/api/admin/pm/items", current?.id ?? 0],
    queryFn: () => adminGet(`/api/admin/pm/projects/${current!.id}/items`),
    enabled: !!current,
  });
  const [view, setView] = useState<View>("all");
  const [open, setOpen] = useState<number | null>(null);
  const [newPhase, setNewPhase] = useState("");
  const [creating, setCreating] = useState(false);
  const [projName, setProjName] = useState("");
  const [projGoal, setProjGoal] = useState("");

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["/api/admin/pm"] });
    void qc.invalidateQueries({ queryKey: ["/api/admin/pm/items", current?.id ?? 0] });
  };
  const fail = (e: unknown) => toast({ title: "Not saved", description: (e as Error).message, variant: "destructive" });
  const update = async (id: number, patch: Partial<Item>) => { try { await adminSend("PUT", `/api/admin/pm/items/${id}`, patch); refresh(); } catch (e) { fail(e); } };
  const add = async (phase: string, title: string) => {
    if (!current || !title.trim()) return;
    try { await adminSend("POST", `/api/admin/pm/projects/${current.id}/items`, { title, phase, owner: "claude" }); refresh(); } catch (e) { fail(e); }
  };
  const createProject = async () => {
    try {
      const p = (await (await adminSend("POST", "/api/admin/pm/projects", { name: projName, goal: projGoal })).json()) as Project;
      setCreating(false); setProjName(""); setProjGoal(""); setPicked(p.id); refresh();
    } catch (e) { fail(e); }
  };

  const all = items.data ?? [];
  const shown = all.filter((i) =>
    view === "all" ? true : view === "done" ? i.status === "done" : view === "decide" ? i.status === "decide" : i.owner === view && i.status !== "done");
  // Phases in the order they first appear.
  const phases = useMemo(() => {
    const order: string[] = [];
    for (const i of all) if (!order.includes(i.phase)) order.push(i.phase);
    if (newPhase.trim() && !order.includes(newPhase.trim())) order.push(newPhase.trim());
    return order;
  }, [all, newPhase]);
  const count = (v: View) => all.filter((i) => (v === "all" ? true : v === "done" ? i.status === "done" : v === "decide" ? i.status === "decide" : i.owner === v && i.status !== "done")).length;

  return (
    <div className="max-w-5xl space-y-5" data-testid="admin-projects">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Projects</h2>
          <p className="mt-1 text-sm text-muted-foreground">What we're building next, who has each piece, and what's waiting on a decision.</p>
        </div>
        <Button variant="outline" className="gap-1.5" onClick={() => setCreating((v) => !v)} data-testid="pm-new-project"><Plus className="h-4 w-4" /> New project</Button>
      </div>

      {creating && (
        <form className="space-y-2 rounded-2xl border border-border bg-card p-4" onSubmit={(e) => { e.preventDefault(); if (projName.trim()) void createProject(); }}>
          <input autoFocus value={projName} onChange={(e) => setProjName(e.target.value)} placeholder="Name: Brands on Discovery" className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm" />
          <Textarea value={projGoal} onChange={(e) => setProjGoal(e.target.value)} rows={2} placeholder="The goal, in a sentence or two" />
          <div className="flex gap-2"><Button type="submit" disabled={!projName.trim()}>Create</Button><Button type="button" variant="ghost" onClick={() => setCreating(false)}>Cancel</Button></div>
        </form>
      )}

      {/* Projects */}
      {live.length > 1 && (
        <div className="flex flex-wrap gap-2">
          {live.map((p) => (
            <button key={p.id} type="button" onClick={() => { setPicked(p.id); setOpen(null); }}
              className={`rounded-full border px-3.5 py-1.5 text-sm transition ${current?.id === p.id ? "border-[#053877] bg-[#053877] font-semibold text-white" : "border-border bg-card hover:border-[#053877]/40"}`}>
              {p.name}{p.decide > 0 && <span className="ml-1.5 rounded-full bg-[#F0A71F] px-1.5 text-[11px] font-bold text-[#1a1200]">{p.decide}</span>}
            </button>
          ))}
        </div>
      )}

      {!current ? (
        <p className="rounded-2xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">{projects.isLoading ? "Loading…" : "No projects yet. Start one with New project."}</p>
      ) : (
        <>
          <section className="rounded-2xl border border-border bg-card p-5">
            <h3 className="text-lg font-semibold">{current.name}</h3>
            {current.goal && <p className="mt-1 whitespace-pre-wrap text-sm text-foreground/80">{current.goal}</p>}
            <div className="mt-4 flex items-center gap-3">
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${current.total ? (current.done / current.total) * 100 : 0}%` }} /></div>
              <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{current.done} of {current.total} done</span>
            </div>
          </section>

          <div className="flex flex-wrap gap-1.5" role="tablist">
            {VIEWS.map((v) => (
              <button key={v.key} type="button" role="tab" aria-selected={view === v.key} onClick={() => setView(v.key)}
                className={`rounded-lg px-3 py-1.5 text-sm transition ${view === v.key ? "bg-[#053877] font-semibold text-white" : "text-foreground hover:bg-muted"}`} data-testid={`pm-view-${v.key}`}>
                {v.label} <span className={`ml-1 tabular-nums text-xs ${view === v.key ? "text-white/80" : "text-muted-foreground"}`}>{count(v.key)}</span>
              </button>
            ))}
          </div>

          <div className="space-y-5">
            {phases.map((ph) => {
              const rows = shown.filter((i) => i.phase === ph);
              const inPhase = all.filter((i) => i.phase === ph);
              if (!rows.length && view !== "all") return null;
              return (
                <section key={ph || "none"} className="overflow-hidden rounded-2xl border border-border bg-card">
                  <header className="flex items-baseline justify-between gap-3 border-b border-border px-4 py-3">
                    <h4 className="font-semibold">{ph || "Unsorted"}</h4>
                    <span className="text-xs tabular-nums text-muted-foreground">{inPhase.filter((i) => i.status === "done").length}/{inPhase.length}</span>
                  </header>
                  <ul className="divide-y divide-border">
                    {rows.map((i) => <Row key={i.id} item={i} open={open === i.id} onToggle={() => setOpen(open === i.id ? null : i.id)} onUpdate={(p) => void update(i.id, p)} onChanged={refresh} />)}
                  </ul>
                  {view === "all" && <AddTask onAdd={(t) => void add(ph, t)} />}
                </section>
              );
            })}
            {view === "all" && (
              <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); }}>
                <input value={newPhase} onChange={(e) => setNewPhase(e.target.value)} placeholder="New phase: name it, then add its first task" className="h-9 flex-1 rounded-lg border border-dashed border-input bg-background px-3 text-sm" data-testid="pm-new-phase" />
              </form>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function AddTask({ onAdd }: { onAdd: (title: string) => void }) {
  const [t, setT] = useState("");
  return (
    <form className="flex items-center gap-2 border-t border-border px-4 py-2" onSubmit={(e) => { e.preventDefault(); if (t.trim()) { onAdd(t.trim()); setT(""); } }}>
      <Plus className="h-4 w-4 shrink-0 text-muted-foreground" />
      <input value={t} onChange={(e) => setT(e.target.value)} placeholder="Add a task" className="h-8 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground" />
      {t.trim() && <Button size="sm" type="submit">Add</Button>}
    </form>
  );
}

function Row({ item: i, open, onToggle, onUpdate, onChanged }: { item: Item; open: boolean; onToggle: () => void; onUpdate: (p: Partial<Item>) => void; onChanged: () => void }) {
  const { toast } = useToast();
  const S = STATUS[i.status] ?? STATUS.todo;
  const O = OWNER[i.owner] ?? OWNER.claude;
  const [detail, setDetail] = useState(i.detail);
  const [note, setNote] = useState("");
  const addNote = async () => {
    try { await adminSend("POST", `/api/admin/pm/items/${i.id}/notes`, { text: note }); setNote(""); onChanged(); }
    catch (e) { toast({ title: "Not saved", description: (e as Error).message, variant: "destructive" }); }
  };
  const remove = async () => { if (!confirm(`Delete "${i.title}"?`)) return; await adminSend("DELETE", `/api/admin/pm/items/${i.id}`).catch(() => {}); onChanged(); };
  return (
    <li data-testid={`pm-item-${i.id}`}>
      <div className="flex items-center gap-3 px-4 py-2.5">
        {/* One press marks it done (or not done). */}
        <button type="button" onClick={() => onUpdate({ status: i.status === "done" ? "todo" : "done" })} title={i.status === "done" ? "Mark not done" : "Mark done"}
          className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 ${i.status === "done" ? "border-emerald-600 bg-emerald-600 text-white" : i.status === "decide" ? "border-[#F0A71F]" : i.status === "doing" ? "border-[#053877] dark:border-[#9cc2ff]" : "border-muted-foreground/40"}`}>
          {i.status === "done" && <Check className="h-3 w-3" />}
        </button>
        <button type="button" onClick={onToggle} className="flex min-w-0 flex-1 items-center gap-2 text-left">
          <span className={`truncate text-sm ${i.status === "done" ? "text-muted-foreground line-through" : "font-medium"}`}>{i.title}</span>
          {i.notes.length > 0 && <span className="inline-flex shrink-0 items-center gap-0.5 text-[11px] text-muted-foreground"><MessageSquare className="h-3 w-3" />{i.notes.length}</span>}
        </button>
        {i.status !== "todo" && i.status !== "done" && <span className={`hidden shrink-0 text-xs font-semibold sm:inline ${S.tone}`}>{S.label}</span>}
        <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground"><O.icon className="h-3 w-3" />{O.label}</span>
        <button type="button" onClick={onToggle} aria-label={open ? "Close" : "Open"} className="rounded p-1 text-muted-foreground hover:bg-muted"><ChevronDown className={`h-4 w-4 transition ${open ? "rotate-180" : ""}`} /></button>
      </div>
      {open && (
        <div className="space-y-3 border-t border-border bg-muted/20 px-4 py-4 sm:pl-12">
          <div className="flex flex-wrap gap-2">
            <select value={i.status} onChange={(e) => onUpdate({ status: e.target.value })} className="h-8 rounded-lg border border-input bg-background px-2 text-sm" aria-label="Status">
              {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
            <select value={i.owner} onChange={(e) => onUpdate({ owner: e.target.value })} className="h-8 rounded-lg border border-input bg-background px-2 text-sm" aria-label="Who has it">
              {Object.entries(OWNER).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
            <button type="button" onClick={() => void remove()} className="ml-auto inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-red-600"><Trash2 className="h-3.5 w-3.5" /> Delete</button>
          </div>
          <Textarea value={detail} onChange={(e) => setDetail(e.target.value)} onBlur={() => { if (detail !== i.detail) onUpdate({ detail }); }} rows={Math.min(10, Math.max(3, detail.split("\n").length + 1))} placeholder="What it is, how we'll know it's done" className="bg-background text-sm" />
          {i.notes.length > 0 && (
            <ul className="space-y-2">
              {i.notes.map((n) => (
                <li key={n.id} className={`rounded-xl p-3 text-sm ${n.author === "Claude" ? "bg-[#053877]/[0.06]" : "bg-[#F0A71F]/10"}`}>
                  <p className="mb-0.5 text-[11px] font-semibold text-muted-foreground">{n.author} · {when(n.createdAt)}</p>
                  <p className="whitespace-pre-wrap">{n.text}</p>
                </li>
              ))}
            </ul>
          )}
          <div className="flex gap-2">
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder={i.status === "decide" ? "Your call: write it here and Claude picks it up next session" : "Add a note"} className="bg-background text-sm" />
            <Button onClick={() => void addNote()} disabled={!note.trim()} className="self-end">Post</Button>
          </div>
        </div>
      )}
    </li>
  );
}
