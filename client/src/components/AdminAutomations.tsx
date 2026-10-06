import { useEffect, useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowLeft, ArrowUp, Clock, Loader2, Mail, Plus, Send, Sparkles, Trash2, UserPlus, Workflow, X, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { adminGet, adminSend } from "@/lib/adminApi";
import { CampaignBuilder, type StepDraft } from "@/components/CampaignBuilder";
import { IconTile } from "@/components/ui/icon-tile";

/**
 * Automations: an email series each person gets on their own clock, like a
 * welcome series. The list sits at the top of the Automation tab; opening one
 * shows it as a timeline (what starts it, then each wait and email), with the
 * people in it beside.
 */

type Stats = { sent: number; opened: number; clicked: number };
type People = { active: number; done: number; stopped: number };
type Summary = { id: number; name: string; trigger: string; status: "on" | "off"; startedAt: string; steps: number; people: People; stats: Stats };
type Step = { id?: number; delayHours: number; subject: string; preheader: string; bodyText: string; sender: string; banner: string; stats?: Stats; waiting?: number };
type Run = { id: number; email: string; firstName: string; status: string; stepIndex: number; nextAt: string; enrolledAt: string; endReason: string };
type Detail = Omit<Summary, "steps"> & { stopOnReply: boolean; steps: Step[]; runs: Run[] };
type Member = { id: number; name: string; title: string; photoUrl: string };
type SegmentOption = { value: string; label: string; count: number };

const TRIGGERS: { value: string; label: string }[] = [
  { value: "account", label: "They finish setting up an account" },
  { value: "unfinished", label: "They sign in but don't finish setting up (a day later)" },
  { value: "smartlink", label: "They make a SmartLink" },
  { value: "podcast", label: "They add a podcast for us to host" },
  { value: "discovery", label: "They join Discovery" },
  { value: "slot", label: "They book a Marathon slot" },
  { value: "contact", label: "They're added to Contacts" },
  { value: "tag", label: "They get a tag…" },
  { value: "manual", label: "I add them myself" },
];
const triggerLabel = (t: string) => (t.startsWith("tag:") ? `They get the tag “${t.slice(4)}”` : TRIGGERS.find((x) => x.value === t)?.label ?? t);

const RECIPES = [
  { key: "welcome", label: "Welcome series", blurb: "4 emails over 9 days when someone makes an account: SmartLink, hosting, Pōstify." },
  { key: "smartlink", label: "New SmartLink tips", blurb: "2 emails after someone makes a SmartLink: where to share it, and collecting emails." },
  { key: "finishSetup", label: "Finish setting up", blurb: "1 email a day after someone signs in but never saves a profile: two fields and you're in." },
  { key: "discovery", label: "Discovery welcome", blurb: "1 email when someone joins Discovery: booking guests and being one." },
  { key: "blank", label: "Start blank", blurb: "Choose what starts it and write your own emails." },
];

const pct = (n: number, of: number) => (of ? `${Math.round((n / of) * 100)}%` : "–");
const when = (iso: string) => (iso && iso < "9999" ? new Date(iso).toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "");

export function AutomationsPanel({ eventId, teamMembers, segmentOptions, children }: { eventId: number | null; teamMembers: Member[]; segmentOptions: SegmentOption[]; children?: ReactNode }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [open, setOpen] = useState<number | null>(null);
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const list = useQuery<Summary[]>({ queryKey: ["/api/admin/automations"], queryFn: () => adminGet("/api/admin/automations") });

  const create = async (recipe: string) => {
    setBusy(true);
    try {
      const a: Summary = await adminSend("POST", "/api/admin/automations", { recipe }).then((r) => r.json());
      await qc.invalidateQueries({ queryKey: ["/api/admin/automations"] });
      setPicking(false);
      setOpen(a.id);
    } catch (e) { toast({ title: "Couldn't make it", description: (e as Error).message, variant: "destructive" }); } finally { setBusy(false); }
  };

  if (open !== null) return <AutomationEditor id={open} eventId={eventId} teamMembers={teamMembers} segmentOptions={segmentOptions} onBack={() => { setOpen(null); void qc.invalidateQueries({ queryKey: ["/api/admin/automations"] }); }} />;

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3" data-testid="automations">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="font-semibold">Automations</h3>
            <p className="text-sm text-muted-foreground">Emails each person gets on their own clock, starting when they do something.</p>
          </div>
          <Button onClick={() => setPicking(true)} className="gap-1.5 rounded-full bg-[#053877] text-white hover:bg-[#0a4a99]" data-testid="automation-new"><Plus className="h-4 w-4" />New automation</Button>
        </div>
        {list.isLoading ? (
          <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : !list.data?.length ? (
          <button type="button" onClick={() => void create("welcome")} disabled={busy} className="flex items-center gap-4 rounded-2xl border border-dashed border-border p-5 text-left hover:border-[#053877] hover:bg-accent" data-testid="automation-first">
            <IconTile icon={Sparkles} />
            <span><span className="block font-semibold">Start with a welcome series</span><span className="block text-sm text-muted-foreground">Four emails, already written, for everyone who makes an account. Edit them, then switch it on.</span></span>
          </button>
        ) : (
          <ul className="overflow-hidden rounded-2xl border border-border bg-card">
            {list.data.map((a) => (
              <li key={a.id} className="border-b border-border last:border-0">
                <button type="button" onClick={() => setOpen(a.id)} className="flex w-full items-center gap-4 px-4 py-3 text-left hover:bg-accent" data-testid={`automation-${a.id}`}>
                  <IconTile icon={Workflow} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">{a.name}</span>
                    <span className="block truncate text-sm text-muted-foreground">{triggerLabel(a.trigger)} · {a.steps} email{a.steps === 1 ? "" : "s"}</span>
                  </span>
                  <span className="hidden text-right text-sm sm:block">
                    <span className="block">{a.people.active} in it now</span>
                    <span className="block text-xs text-muted-foreground">{a.stats.sent} sent · {pct(a.stats.opened, a.stats.sent)} opened</span>
                  </span>
                  <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${a.status === "on" ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400" : "bg-muted text-muted-foreground"}`}>{a.status === "on" ? "On" : "Off"}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {children}

      <Dialog open={picking} onOpenChange={setPicking}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>New automation</DialogTitle>
            <DialogDescription>Start from one that's written, or blank. Nothing sends until you switch it on.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            {RECIPES.map((r) => (
              <button key={r.key} type="button" disabled={busy} onClick={() => void create(r.key)} className="rounded-xl border border-border p-3 text-left hover:border-[#053877] hover:bg-accent disabled:opacity-50" data-testid={`recipe-${r.key}`}>
                <span className="block font-semibold">{r.label}</span>
                <span className="block text-sm text-muted-foreground">{r.blurb}</span>
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function AutomationEditor({ id, eventId, teamMembers, segmentOptions, onBack }: { id: number; eventId: number | null; teamMembers: Member[]; segmentOptions: SegmentOption[]; onBack: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const key = ["/api/admin/automations", id];
  const detail = useQuery<Detail>({ queryKey: key, queryFn: () => adminGet(`/api/admin/automations/${id}`) });
  const [draft, setDraft] = useState<{ name: string; trigger: string; stopOnReply: boolean; steps: Step[] } | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [addSeg, setAddSeg] = useState("");
  const [tagName, setTagName] = useState("");
  const tags = useQuery<{ tag: string; count: number }[]>({ queryKey: ["/api/admin/contact-tags"], queryFn: () => adminGet("/api/admin/contact-tags") });

  // Load once, then keep what's typed; the server copy only refreshes it after a save.
  useEffect(() => {
    if (detail.data && (!draft || !dirty)) {
      setDraft({ name: detail.data.name, trigger: detail.data.trigger, stopOnReply: detail.data.stopOnReply, steps: detail.data.steps.map((s) => ({ ...s })) });
      if (detail.data.trigger.startsWith("tag:")) setTagName(detail.data.trigger.slice(4));
    }
  }, [detail.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async (d = draft) => {
    if (!d) return;
    setSaving(true);
    try {
      await adminSend("PUT", `/api/admin/automations/${id}`, { name: d.name, trigger: d.trigger, stopOnReply: d.stopOnReply, steps: d.steps.map(({ stats: _s, waiting: _w, ...s }) => s) });
      setDirty(false);
      await qc.invalidateQueries({ queryKey: key });
    } catch (e) { toast({ title: "Didn't save", description: (e as Error).message, variant: "destructive" }); } finally { setSaving(false); }
  };
  // Saves itself a moment after a change.
  const timer = useRef<number>();
  const change = (next: NonNullable<typeof draft>, now = false) => {
    setDraft(next);
    setDirty(true);
    window.clearTimeout(timer.current);
    if (now) void save(next);
    else timer.current = window.setTimeout(() => void save(next), 800);
  };
  useEffect(() => () => window.clearTimeout(timer.current), []);

  if (!detail.data || !draft) return <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  const a = detail.data;
  const on = a.status === "on";

  if (editing !== null && draft.steps[editing]) {
    const s = draft.steps[editing];
    return (
      <CampaignBuilder
        key={`${id}-${editing}`}
        eventId={eventId}
        initial={{ id: s.id ?? 0, subject: s.subject, bodyText: s.bodyText, segment: "", sender: s.sender, banner: s.banner, status: "draft", scheduledFor: null, preheader: s.preheader }}
        segmentOptions={segmentOptions}
        teamMembers={teamMembers}
        onClose={() => setEditing(null)}
        step={{
          back: draft.name,
          onSave: async (d: StepDraft) => {
            const steps = draft.steps.map((x, i) => (i === editing ? { ...x, ...d } : x));
            const next = { ...draft, steps };
            setDraft(next);
            await save(next);
          },
          onTest: async (d: StepDraft) => adminSend("POST", `/api/admin/automations/${id}/test`, { draft: d }).then((r) => r.json()),
        }}
      />
    );
  }

  const setStep = (i: number, patch: Partial<Step>, now = false) => change({ ...draft, steps: draft.steps.map((x, j) => (j === i ? { ...x, ...patch } : x)) }, now);
  const moveStep = (i: number, to: number) => {
    if (to < 0 || to >= draft.steps.length) return;
    const steps = draft.steps.slice();
    const [x] = steps.splice(i, 1);
    steps.splice(to, 0, x);
    change({ ...draft, steps }, true);
  };
  const addStep = () => change({ ...draft, steps: [...draft.steps, { delayHours: 48, subject: "", preheader: "", bodyText: "Hi {{First_Name}},\n\n", sender: "team", banner: "welcome" }] }, true);
  const removeStep = (i: number) => {
    if (!window.confirm(`Remove “${draft.steps[i].subject || "this email"}”?`)) return;
    change({ ...draft, steps: draft.steps.filter((_, j) => j !== i) }, true);
  };

  const run = async (k: string, fn: () => Promise<void>) => {
    setBusy(k);
    try { await fn(); } catch (e) { toast({ title: "That didn't work", description: (e as Error).message.replace(/^\d+:\s*/, ""), variant: "destructive" }); } finally { setBusy(null); }
  };
  const toggle = (v: boolean) => run("status", async () => {
    if (dirty) await save();
    await adminSend("POST", `/api/admin/automations/${id}/status`, { on: v });
    await qc.invalidateQueries({ queryKey: key });
    toast(v ? { title: "It's on", description: `From now, anyone who ${triggerLabel(draft.trigger).replace(/^They /, "").replace(/^I add them myself$/, "you add")} gets it.` } : { title: "Paused", description: "Nobody new joins, and everyone in it waits where they are." });
  });
  const testAll = () => run("test", async () => {
    if (dirty) await save();
    const r: { ok: boolean; to: string; count: number } = await adminSend("POST", `/api/admin/automations/${id}/test`, {}).then((x) => x.json());
    toast(r.ok ? { title: `${r.count} test email${r.count === 1 ? "" : "s"} sent`, description: `Check ${r.to}.` } : { title: "Test not sent", variant: "destructive" });
  });
  const remove = () => run("delete", async () => {
    if (!window.confirm(`Delete “${draft.name}” and its emails? The people in it stop getting them.`)) return;
    await adminSend("DELETE", `/api/admin/automations/${id}`);
    onBack();
  });
  const addPeople = () => run("add", async () => {
    const r: { added: number } = await adminSend("POST", `/api/admin/automations/${id}/enroll`, { segment: addSeg, eventId }).then((x) => x.json());
    await qc.invalidateQueries({ queryKey: key });
    toast({ title: r.added ? `${r.added} added` : "Nobody new to add", description: r.added ? "The first email goes on its own schedule." : "Everyone in that list has been in this automation already." });
    setAddSeg("");
  });
  const stopRun = (r: Run) => run(`stop-${r.id}`, async () => {
    await adminSend("POST", `/api/admin/automations/${id}/runs/${r.id}/stop`);
    await qc.invalidateQueries({ queryKey: key });
  });

  const trig = draft.trigger.startsWith("tag:") ? "tag" : draft.trigger;
  const days = (h: number) => (h % 24 === 0 ? { n: h / 24, unit: "days" } : { n: h, unit: "hours" });

  return (
    <div className="flex flex-col gap-4" data-testid="automation-editor">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => { if (dirty) void save(); onBack(); }} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" /> Automations</button>
        <Input value={draft.name} onChange={(e) => change({ ...draft, name: e.target.value })} className="h-9 max-w-xs font-semibold" aria-label="Name" data-testid="automation-name" />
        <span className="text-xs text-muted-foreground">{saving ? "Saving…" : dirty ? "" : "Saved"}</span>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={testAll} disabled={busy !== null} className="gap-1.5 rounded-full">{busy === "test" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}Send me the series</Button>
          {!on && <Button variant="ghost" size="sm" onClick={remove} disabled={busy !== null} className="gap-1.5 rounded-full text-destructive hover:text-destructive"><Trash2 className="h-3.5 w-3.5" />Delete</Button>}
          <label className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-semibold ${on ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" : "border-border"}`}>
            {busy === "status" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Switch checked={on} onCheckedChange={toggle} data-testid="automation-switch" />}
            {on ? "On" : "Off"}
          </label>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        {/* The series, top to bottom, as a person goes through it. */}
        <ol className="flex flex-col" data-testid="automation-timeline">
          <li className="rounded-2xl border border-border bg-card p-4 shadow-sm">
            <p className="flex items-center gap-2 text-sm font-semibold"><Zap className="h-4 w-4 text-amber-500" />Starts when</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Select value={trig} onValueChange={(v) => change({ ...draft, trigger: v === "tag" ? `tag:${tagName || tags.data?.[0]?.tag || "vip"}` : v }, true)} disabled={on}>
                <SelectTrigger className="w-full sm:w-80" data-testid="automation-trigger"><SelectValue /></SelectTrigger>
                <SelectContent>{TRIGGERS.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
              </Select>
              {trig === "tag" && (
                <Input
                  value={tagName}
                  onChange={(e) => setTagName(e.target.value.toLowerCase())}
                  onBlur={() => tagName.trim() && change({ ...draft, trigger: `tag:${tagName.trim()}` }, true)}
                  list="automation-tags" placeholder="tag name" className="w-40" disabled={on}
                />
              )}
              <datalist id="automation-tags">{(tags.data ?? []).map((t) => <option key={t.tag} value={t.tag} />)}</datalist>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              {on ? "Switch it off to change this. " : ""}Only people who start after it's switched on join. Nobody from before gets it.
            </p>
          </li>

          {draft.steps.map((s, i) => {
            const d = days(s.delayHours);
            return (
              <li key={s.id ?? `new-${i}`} className="flex flex-col">
                <div className="ml-6 flex items-center gap-2 border-l-2 border-dashed border-border py-3 pl-5 text-sm text-muted-foreground">
                  <Clock className="h-4 w-4" />
                  {i === 0 ? "Wait" : "Then wait"}
                  <Input type="number" min={0} value={d.n} onChange={(e) => setStep(i, { delayHours: Math.max(0, Math.round(Number(e.target.value) || 0)) * (d.unit === "days" ? 24 : 1) })} className="h-8 w-16" aria-label="How long" />
                  <Select value={d.unit} onValueChange={(u) => setStep(i, { delayHours: u === "days" ? d.n * 24 : d.n }, true)}>
                    <SelectTrigger className="h-8 w-24"><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="hours">hours</SelectItem><SelectItem value="days">days</SelectItem></SelectContent>
                  </Select>
                  {s.delayHours === 0 && <span className="text-xs">(sends right away)</span>}
                  {!!s.waiting && <span className="ml-auto rounded-full bg-[#053877]/10 px-2 py-0.5 text-xs font-medium text-[#053877] dark:text-white">{s.waiting} waiting</span>}
                </div>
                <div className="group rounded-2xl border border-border bg-card p-4 shadow-sm">
                  <div className="flex items-start gap-3">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#053877] text-sm font-bold text-white">{i + 1}</span>
                    <button type="button" onClick={() => setEditing(i)} className="min-w-0 flex-1 text-left" data-testid={`step-${i}`}>
                      <span className="block truncate font-semibold hover:underline">{s.subject || <span className="text-muted-foreground">Untitled email</span>}</span>
                      <span className="block truncate text-sm text-muted-foreground">{s.preheader || (s.subject ? "No preview text" : "Write this one")}</span>
                      {s.stats && s.stats.sent > 0 && (
                        <span className="mt-1 block text-xs text-muted-foreground">{s.stats.sent} sent · {pct(s.stats.opened, s.stats.sent)} opened · {pct(s.stats.clicked, s.stats.sent)} clicked</span>
                      )}
                    </button>
                    <span className="flex shrink-0 items-center gap-0.5">
                      <Button size="sm" variant="outline" onClick={() => setEditing(i)} className="h-8 gap-1.5 rounded-full"><Mail className="h-3.5 w-3.5" />Edit</Button>
                      <button type="button" onClick={() => moveStep(i, i - 1)} disabled={i === 0} className="rounded p-1.5 hover:bg-muted disabled:opacity-30" aria-label="Move up"><ArrowUp className="h-3.5 w-3.5" /></button>
                      <button type="button" onClick={() => moveStep(i, i + 1)} disabled={i === draft.steps.length - 1} className="rounded p-1.5 hover:bg-muted disabled:opacity-30" aria-label="Move down"><ArrowDown className="h-3.5 w-3.5" /></button>
                      <button type="button" onClick={() => removeStep(i)} className="rounded p-1.5 hover:bg-destructive/10 hover:text-destructive" aria-label="Remove"><Trash2 className="h-3.5 w-3.5" /></button>
                    </span>
                  </div>
                </div>
              </li>
            );
          })}

          <li className="ml-6 border-l-2 border-dashed border-border py-3 pl-5">
            <Button variant="outline" size="sm" onClick={addStep} className="gap-1.5 rounded-full" data-testid="step-add"><Plus className="h-4 w-4" />Add an email</Button>
          </li>
          <li className="rounded-2xl border border-border bg-muted/40 p-4 text-sm">
            <p className="font-semibold">Stops when</p>
            <label className="mt-2 flex items-center gap-2"><Switch checked={draft.stopOnReply} onCheckedChange={(v) => change({ ...draft, stopOnReply: v }, true)} />They reply to any email</label>
            <p className="mt-1 text-muted-foreground">Always: when they unsubscribe, or reach the last email.</p>
          </li>
        </ol>

        {/* Who's in it. */}
        <aside className="flex min-w-0 flex-col gap-4 lg:sticky lg:top-4 lg:self-start">
          <section className="rounded-2xl border border-border bg-card p-4 shadow-sm">
            <div className="grid grid-cols-3 gap-2 text-center">
              <div><p className="text-2xl font-bold">{a.people.active}</p><p className="text-xs text-muted-foreground">in it now</p></div>
              <div><p className="text-2xl font-bold">{a.people.done}</p><p className="text-xs text-muted-foreground">finished</p></div>
              <div><p className="text-2xl font-bold">{pct(a.stats.opened, a.stats.sent)}</p><p className="text-xs text-muted-foreground">opened</p></div>
            </div>
            <div className="mt-4 border-t border-border pt-3">
              <p className="mb-2 flex items-center gap-1.5 text-sm font-semibold"><UserPlus className="h-4 w-4" />Add people now</p>
              {on ? (
                <div className="flex gap-2">
                  <Select value={addSeg} onValueChange={setAddSeg}>
                    <SelectTrigger className="min-w-0 flex-1"><SelectValue placeholder="Choose a list or tag" /></SelectTrigger>
                    <SelectContent>
                      {segmentOptions.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}{o.count >= 0 ? ` (${o.count})` : ""}</SelectItem>)}
                      {(tags.data ?? []).map((t) => <SelectItem key={t.tag} value={`tag:${t.tag}`}>Tagged “{t.tag}” ({t.count})</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Button onClick={addPeople} disabled={!addSeg || busy !== null} className="rounded-full">{busy === "add" ? <Loader2 className="h-4 w-4 animate-spin" /> : "Add"}</Button>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">Switch it on first. Anyone who has already been through it is skipped.</p>
              )}
            </div>
          </section>

          <section className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
            <p className="border-b border-border px-4 py-2.5 text-sm font-semibold">People</p>
            {a.runs.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-muted-foreground">{on ? "Nobody yet. They'll show here as they start." : "Nobody yet."}</p>
            ) : (
              <ul className="max-h-[520px] divide-y divide-border overflow-y-auto">
                {a.runs.map((r) => (
                  <li key={r.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{r.firstName ? `${r.firstName} · ` : ""}{r.email}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {r.status === "active"
                          ? `Email ${r.stepIndex + 1} ${when(r.nextAt) ? `· ${when(r.nextAt)}` : "· sending"}`
                          : r.status === "done" ? "Finished" : `Stopped: ${r.endReason === "replied" ? "they replied" : r.endReason === "unsubscribed" ? "unsubscribed" : "taken out"}`}
                      </span>
                    </span>
                    {r.status === "active" && (
                      <button type="button" onClick={() => void stopRun(r)} disabled={busy !== null} className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive" title="Take them out" aria-label="Take them out"><X className="h-4 w-4" /></button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}
