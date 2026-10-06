import { useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { adminGet, adminSend } from "@/lib/adminApi";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Bookmark, Check, ListFilter, Mail, Search, Trash2, Upload, Users, X } from "lucide-react";
import { BUILT_IN_AUDIENCES, PATH_LABEL, filterIsActive, matchesFilter, type AudienceFilter, type SavedAudience } from "@shared/crm";

// People: the CRM's front door. Everyone we have a relationship with, one
// row each — members, podcasters on any event, Discovery users, sponsors,
// listeners, imports — with the audiences down the side and their live
// counts. Pick an audience and email it; or tick people and email just them.
// The same screen, narrowed to one event, is that event's CRM.

export type Person = {
  email: string; name: string; roles: string[]; plan: string; path: string; shows: string[]; events: { id: number; name: string }[];
  smartlink: string; hosted: boolean; unsubscribed: boolean; stage: string; tags: string[]; joinedAt: string; lastActivityAt: string;
};
export type Audience = { key: string; label: string; count: number; reachable: number };
type Data = { people: Person[]; audiences: Audience[]; saved: SavedAudience[] };

const ROLES = ["Member", "Podcaster", "Co-host", "Discovery", "Sponsor", "Team", "Listener", "Imported"];
const PLAN_NAMES = ["Growth", "Scale", "Pro"];

/** One row of the filter: a label and its choices, any of which can be on. */
function Chips<T extends string | number>({ label, options, on, toggle }: { label: string; options: { value: T; label: string }[]; on: (v: T) => boolean; toggle: (v: T) => void }) {
  if (!options.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="w-20 shrink-0 text-xs font-semibold text-muted-foreground">{label}</span>
      {options.map((o) => (
        <button key={String(o.value)} type="button" onClick={() => toggle(o.value)} aria-pressed={on(o.value)}
          className={`rounded-full border px-2.5 py-1 text-xs transition ${on(o.value) ? "border-[#053877] bg-[#053877] font-semibold text-white" : "border-border bg-background text-foreground hover:border-[#053877]/40"}`}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

const ROLE_TONE: Record<string, string> = {
  Member: "bg-[#053877]/10 text-[#053877] dark:bg-[#9cc2ff]/15 dark:text-[#9cc2ff]",
  Podcaster: "bg-[#F0A71F]/20 text-[#8a5a00] dark:text-[#F0A71F]",
  "Co-host": "bg-[#F0A71F]/20 text-[#8a5a00] dark:text-[#F0A71F]",
  Discovery: "bg-violet-100 text-violet-800 dark:bg-violet-500/15 dark:text-violet-300",
  Sponsor: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300",
  Team: "bg-slate-200 text-slate-800 dark:bg-white/10 dark:text-white/80",
  Listener: "bg-sky-100 text-sky-800 dark:bg-sky-500/15 dark:text-sky-300",
  Imported: "bg-muted text-muted-foreground",
};

function ago(iso: string): string {
  if (!iso) return "";
  const d = (Date.now() - Date.parse(iso)) / 86400000;
  if (d < 1) return "today";
  if (d < 2) return "yesterday";
  if (d < 30) return `${Math.floor(d)} days ago`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: d > 300 ? "numeric" : undefined });
}

export function People({ eventId, onSelect, onEmail }: {
  /** One event's people, or (null) the whole platform. */
  eventId: number | null;
  onSelect: (p: { email: string }) => void;
  /** Open the composer to this audience ("aud:members", "aud:pick:a|b"). */
  onEmail: (segment: string, label: string) => void;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const key = ["/api/admin/people", eventId ?? 0];
  const { data, isLoading } = useQuery<Data>({ queryKey: key, queryFn: () => adminGet(`/api/admin/people${eventId ? `?eventId=${eventId}` : ""}`) });
  const [aud, setAud] = useState("everyone");
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<AudienceFilter>({});
  const [filtering, setFiltering] = useState(false);
  const [naming, setNaming] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const audiences = data?.audiences ?? [];
  const current = audiences.find((a) => a.key === aud) ?? audiences[0];
  const tests = useMemo(() => {
    // The same tests the server uses to send, so the count here is who a campaign reaches.
    const t: Record<string, (p: Person) => boolean> = {};
    for (const a of BUILT_IN_AUDIENCES) t[a.key] = a.test;
    for (const a of data?.saved ?? []) t[`saved:${a.id}`] = (p) => matchesFilter(p, a.filter);
    return t;
  }, [data?.saved]);
  const active = filterIsActive(filter);
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (data?.people ?? []).filter((p) => (tests[aud] ?? (() => true))(p) && (!active || matchesFilter(p, filter)) && (!needle || `${p.name} ${p.email} ${p.shows.join(" ")} ${p.tags.join(" ")}`.toLowerCase().includes(needle)));
  }, [data?.people, aud, q, tests, active, filter]);
  const reachable = rows.filter((r) => !r.unsubscribed);
  // What the filter can offer, from the people we have.
  const tagOptions = useMemo(() => Array.from(new Set((data?.people ?? []).flatMap((p) => p.tags))).sort().slice(0, 24), [data?.people]);
  const eventOptions = useMemo(() => {
    const m = new Map<number, string>();
    for (const p of data?.people ?? []) for (const e of p.events) m.set(e.id, e.name);
    return Array.from(m.entries()).map(([value, label]) => ({ value, label }));
  }, [data?.people]);
  const flip = (k: "roles" | "plans" | "paths" | "tags", v: string) => setFilter((f) => { const cur: string[] = f[k] ?? []; return { ...f, [k]: cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v] }; });
  const flipEvent = (v: number) => setFilter((f) => { const cur = f.eventIds ?? []; return { ...f, eventIds: cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v] }; });
  const one = <K extends "joinedDays" | "quietDays" | "smartlink">(k: K, v: AudienceFilter[K]) => setFilter((f) => ({ ...f, [k]: f[k] === v ? undefined : v }));

  const saveAudience = async (name: string) => {
    try {
      const a = (await (await adminSend("POST", "/api/admin/people/audiences", { name, filter: { ...filter, base: aud.startsWith("saved:") ? undefined : aud } })).json()) as SavedAudience;
      await qc.invalidateQueries({ queryKey: ["/api/admin/people"] });
      setNaming(null); setFilter({}); setFiltering(false); setAud(`saved:${a.id}`);
      toast({ title: `Saved "${a.name}"`, description: "It's in your audiences, and you can send a campaign to it." });
    } catch (err) {
      toast({ title: "Not saved", description: (err as Error).message, variant: "destructive" });
    }
  };
  const removeAudience = async (key: string) => {
    await adminSend("DELETE", `/api/admin/people/audiences/${key.slice(6)}`).catch(() => {});
    setAud("everyone");
    void qc.invalidateQueries({ queryKey: ["/api/admin/people"] });
  };
  const toggle = (e: string) => setPicked((s) => { const n = new Set(s); if (n.has(e)) n.delete(e); else n.add(e); return n; });
  const allOnScreen = rows.length > 0 && rows.every((r) => picked.has(r.email));

  const importCsv = async (f: File) => {
    try {
      const r = (await (await adminSend("POST", "/api/admin/contacts/import", { csv: await f.text() })).json()) as { inserted: number; updated: number };
      toast({ title: `Imported ${r.inserted} new, updated ${r.updated}` });
      void qc.invalidateQueries({ queryKey: key });
    } catch (err) {
      toast({ title: "Import failed", description: (err as Error).message, variant: "destructive" });
    }
  };

  return (
    <div className="grid gap-5 lg:grid-cols-[230px_minmax(0,1fr)]" data-testid="crm-people">
      {/* Audiences: who you can look at, and email, in one press. */}
      <nav className="flex gap-1.5 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible" aria-label="Audiences">
        {audiences.map((a, i) => (
          <div key={a.key} className="contents">
          {a.key.startsWith("saved:") && !audiences[i - 1]?.key.startsWith("saved:") && <p className="hidden px-3 pt-3 text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground lg:block">Saved</p>}
          <button
            type="button"
            onClick={() => { setAud(a.key); setPicked(new Set()); }}
            className={`flex shrink-0 items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-sm transition ${aud === a.key ? "bg-[#053877] font-semibold text-white" : "text-foreground hover:bg-muted"}`}
            data-testid={`crm-aud-${a.key}`}
          >
            <span className="truncate">{a.label}</span>
            <span className={`tabular-nums text-xs ${aud === a.key ? "text-white/80" : "text-muted-foreground"}`}>{a.count}</span>
          </button>
          </div>
        ))}
      </nav>

      <section className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[200px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, email, show or tag" className="h-10 w-full rounded-lg border border-input bg-background pl-9 pr-3 text-sm" data-testid="crm-people-search" />
          </div>
          <Button variant={filtering || active ? "default" : "outline"} className={`gap-1.5 ${filtering || active ? "bg-[#053877] text-white hover:bg-[#0a4a99]" : ""}`} onClick={() => setFiltering((v) => !v)} aria-expanded={filtering} data-testid="crm-filter">
            <ListFilter className="h-4 w-4" /> Filter{active ? " · on" : ""}
          </Button>
          {active ? (
            <Button className="gap-1.5" disabled={!reachable.length} onClick={() => onEmail(`aud:pick:${reachable.map((r) => r.email).join("|")}`, `${reachable.length} filtered`)} data-testid="crm-email-filtered">
              <Mail className="h-4 w-4" /> Email these ({reachable.length})
            </Button>
          ) : current && (
            <Button className="gap-1.5" disabled={!current.reachable} onClick={() => onEmail(`aud:${current.key}`, current.label)} data-testid="crm-email-audience">
              <Mail className="h-4 w-4" /> Email {current.key === "everyone" ? "everyone" : current.label.toLowerCase()} ({current.reachable})
            </Button>
          )}
          {!eventId && (
            <>
              <input ref={fileRef} type="file" accept=".csv,text/csv" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void importCsv(f); }} />
              <Button variant="outline" className="gap-1.5" onClick={() => fileRef.current?.click()} title="A CSV with an email column (first and last name if you have them)" data-testid="crm-import">
                <Upload className="h-4 w-4" /> Import
              </Button>
            </>
          )}
        </div>
        {filtering && (
          <div className="mt-3 space-y-2.5 rounded-xl border border-border bg-card p-4" data-testid="crm-filter-panel">
            <Chips label="Who" options={ROLES.map((r) => ({ value: r, label: r }))} on={(v) => !!filter.roles?.includes(v)} toggle={(v) => flip("roles", v)} />
            {!eventId && <Chips label="Plan" options={PLAN_NAMES.map((r) => ({ value: r, label: r }))} on={(v) => !!filter.plans?.includes(v)} toggle={(v) => flip("plans", v)} />}
            {!eventId && <Chips label="Came for" options={Object.entries(PATH_LABEL).map(([value, label]) => ({ value, label }))} on={(v) => !!filter.paths?.includes(v)} toggle={(v) => flip("paths", v)} />}
            <Chips label="Joined" options={[{ value: 7, label: "This week" }, { value: 30, label: "Last 30 days" }, { value: 90, label: "Last 90 days" }]} on={(v) => filter.joinedDays === v} toggle={(v) => one("joinedDays", v)} />
            <Chips label="Gone quiet" options={[{ value: 30, label: "30+ days" }, { value: 90, label: "90+ days" }]} on={(v) => filter.quietDays === v} toggle={(v) => one("quietDays", v)} />
            {!eventId && <Chips label="SmartLink" options={[{ value: "yes", label: "Has one" }, { value: "no", label: "Not yet" }]} on={(v) => filter.smartlink === v} toggle={(v) => one("smartlink", v as "yes" | "no")} />}
            {!eventId && <Chips label="Event" options={eventOptions} on={(v) => !!filter.eventIds?.includes(v)} toggle={flipEvent} />}
            <Chips label="Tag" options={tagOptions.map((t) => ({ value: t, label: t }))} on={(v) => !!filter.tags?.includes(v)} toggle={(v) => flip("tags", v)} />
            <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
              <span className="text-sm"><span className="font-semibold tabular-nums">{rows.length}</span> {rows.length === 1 ? "person" : "people"}{current && current.key !== "everyone" ? ` in ${current.label}` : ""}</span>
              {active && (naming === null ? (
                <Button size="sm" variant="outline" className="ml-auto gap-1.5" onClick={() => setNaming("")} data-testid="crm-save-audience"><Bookmark className="h-4 w-4" /> Save as audience</Button>
              ) : (
                <form className="ml-auto flex gap-1.5" onSubmit={(e) => { e.preventDefault(); if (naming.trim()) void saveAudience(naming.trim()); }}>
                  <input autoFocus value={naming} onChange={(e) => setNaming(e.target.value)} placeholder="Name it: New on Growth" className="h-8 w-52 rounded-lg border border-input bg-background px-2.5 text-sm" data-testid="crm-audience-name" />
                  <Button size="sm" type="submit" disabled={!naming.trim()}>Save</Button>
                </form>
              ))}
              {active && <Button size="sm" variant="ghost" onClick={() => { setFilter({}); setNaming(null); }}>Clear</Button>}
            </div>
          </div>
        )}
        {aud.startsWith("saved:") && (
          <p className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">A saved audience: it updates itself as people join and change.
            <button type="button" onClick={() => void removeAudience(aud)} className="inline-flex items-center gap-1 font-semibold text-red-600 hover:underline"><Trash2 className="h-3 w-3" /> Remove it</button>
          </p>
        )}
        {current && !active && current.count !== current.reachable && (
          <p className="mt-2 text-xs text-muted-foreground">{current.count - current.reachable} of these unsubscribed and won't be emailed.</p>
        )}

        <div className="mt-3 overflow-hidden rounded-xl border border-border bg-card">
          {isLoading ? (
            <p className="p-6 text-sm text-muted-foreground">Loading people…</p>
          ) : rows.length === 0 ? (
            <div className="p-10 text-center text-sm text-muted-foreground"><Users className="mx-auto mb-2 h-6 w-6 opacity-50" />Nobody here{q ? ` matching "${q}"` : ""}.</div>
          ) : (
            <div className="max-h-[68vh] overflow-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 z-10 bg-muted text-left text-[11px] uppercase tracking-[0.1em] text-muted-foreground">
                  <tr>
                    <th className="w-10 px-3 py-2"><input type="checkbox" aria-label="Select everyone shown" className="h-4 w-4 accent-[#053877]" checked={allOnScreen} onChange={() => setPicked(allOnScreen ? new Set() : new Set(rows.map((r) => r.email)))} /></th>
                    <th className="px-3 py-2 font-medium">Person</th>
                    <th className="hidden px-3 py-2 font-medium md:table-cell">Who they are</th>
                    <th className="hidden px-3 py-2 font-medium sm:table-cell">Plan</th>
                    <th className="px-3 py-2 text-right font-medium">Last heard</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {rows.slice(0, 500).map((p) => (
                    <tr key={p.email} className={`cursor-pointer hover:bg-muted/40 ${picked.has(p.email) ? "bg-[#053877]/5" : ""}`} onClick={() => onSelect(p)} data-testid={`crm-person-${p.email}`}>
                      <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
                        <input type="checkbox" aria-label={`Select ${p.name || p.email}`} className="h-4 w-4 accent-[#053877]" checked={picked.has(p.email)} onChange={() => toggle(p.email)} />
                      </td>
                      <td className="max-w-0 px-3 py-2.5">
                        <div className="truncate font-medium">{p.name || p.email.split("@")[0]}{p.unsubscribed && <span className="ml-2 rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-semibold text-red-700 dark:bg-red-500/15 dark:text-red-300">Unsubscribed</span>}</div>
                        <div className="truncate text-xs text-muted-foreground">{p.email}{p.shows[0] ? ` · ${p.shows[0]}` : ""}</div>
                      </td>
                      <td className="hidden px-3 py-2.5 md:table-cell">
                        <div className="flex flex-wrap gap-1">
                          {p.roles.map((r) => <span key={r} className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${ROLE_TONE[r] ?? "bg-muted"}`}>{r}</span>)}
                          {p.events.length > 0 && !eventId && <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground" title={p.events.map((e) => e.name).join(", ")}>{p.events.length === 1 ? p.events[0].name : `${p.events.length} events`}</span>}
                        </div>
                      </td>
                      <td className="hidden px-3 py-2.5 text-xs sm:table-cell">{p.plan || <span className="text-muted-foreground">—</span>}</td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-right text-xs text-muted-foreground">{ago(p.lastActivityAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {rows.length > 500 && <p className="p-3 text-center text-xs text-muted-foreground">Showing 500 of {rows.length}. Search to narrow it.</p>}
            </div>
          )}
        </div>
      </section>

      {/* What you can do with the people you ticked. */}
      {picked.size > 0 && (
        <div className="fixed inset-x-0 bottom-4 z-40 mx-auto flex w-[min(94vw,36rem)] items-center gap-3 rounded-2xl bg-[#000741] px-4 py-3 text-white shadow-2xl" data-testid="crm-selection-bar">
          <span className="flex items-center gap-2 text-sm font-semibold"><Check className="h-4 w-4" /> {picked.size} selected</span>
          <Button size="sm" className="ml-auto gap-1.5 bg-[#F0A71F] text-[#1a1200] hover:bg-[#f5b944]" onClick={() => onEmail(`aud:pick:${Array.from(picked).join("|")}`, `${picked.size} hand-picked`)} data-testid="crm-email-picked">
            <Mail className="h-4 w-4" /> Email them
          </Button>
          <button type="button" aria-label="Clear the selection" onClick={() => setPicked(new Set())} className="rounded-md p-1.5 text-white/70 hover:bg-white/10 hover:text-white"><X className="h-4 w-4" /></button>
        </div>
      )}
    </div>
  );
}
