import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, Check, ExternalLink, Linkedin, Loader2, Mail, Search, Sparkles, UserSearch, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { adminGet, adminSend } from "@/lib/adminApi";
import type { SponsorLeadRow } from "@/components/SponsorLeads";

type Search = {
  id: number;
  kind: "find" | "contact";
  brief: string;
  company: string;
  status: "running" | "done" | "failed";
  result: string;
  error: string;
  createdAt: string;
};
type Company = {
  name: string;
  website: string;
  hq: string;
  size: string;
  category: string;
  why_fit: string;
  evidence: string;
  contact_name: string;
  contact_title: string;
  contact_linkedin: string;
  contact_email: string;
};
type Contact = { name: string; title: string; linkedin: string; email: string; phone: string; why: string; backup_name: string };
type Sources = Array<{ field: string; urls: string[] }>;

const EXAMPLES = [
  { label: "Like Genius Network", brief: "Companies like Genius Network: business growth, coaching and mastermind brands that back veteran entrepreneurs" },
  { label: "Outdoor and fitness", brief: "Outdoor, fitness and apparel brands that hire veterans or sponsor military families" },
  { label: "Banks and insurers", brief: "Banks, insurers and lenders with military and veteran programs" },
  { label: "Veteran-owned brands", brief: "Veteran-owned consumer brands with a marketing budget, such as coffee, apparel and supplements" },
];

const parse = <T,>(s: string): T | null => {
  try { return JSON.parse(s) as T; } catch { return null; }
};
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const href = (u: string) => (/^https?:\/\//i.test(u) ? u : `https://${u}`);
const host = (u: string) => u.replace(/^https?:\/\//i, "").replace(/^www\./, "").replace(/\/$/, "");

function since(iso: string, now: number) {
  const m = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60000));
  return m < 1 ? "just now" : m < 60 ? `${m} min ago` : new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/**
 * Find sponsors: describe the kind of company, and Parallel researches ones
 * that fit the event, with the person to write to at each. One click puts a
 * result in Riccoh's leads.
 */
export function SponsorFinder({ eventId }: { eventId: number }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [brief, setBrief] = useState("");
  const [count, setCount] = useState(12);
  const [now, setNow] = useState(Date.now());

  const { data } = useQuery<{ configured: boolean; searches: Search[] }>({
    queryKey: ["/api/admin/sponsor-finder", eventId],
    queryFn: () => adminGet(`/api/admin/sponsor-finder?eventId=${eventId}`),
    refetchInterval: (q) => (q.state.data?.searches.some((s) => s.status === "running") ? 12000 : false),
  });
  const { data: leads = [] } = useQuery<SponsorLeadRow[]>({
    queryKey: ["/api/admin/sponsor-leads", eventId],
    queryFn: () => adminGet<SponsorLeadRow[]>(`/api/admin/sponsor-leads?eventId=${eventId}`),
  });
  const searches = data?.searches ?? [];
  const running = searches.some((s) => s.status === "running");
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(t);
  }, [running]);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["/api/admin/sponsor-finder", eventId] });
  const fail = (err: Error) => toast({ title: "Couldn't start that", description: err.message, variant: "destructive" });
  const send = async (method: string, path: string, body?: unknown) => {
    const r = await adminSend(method, path, body);
    if (!r.ok) throw new Error((await r.json().catch(() => null))?.message || `Error ${r.status}`);
    return r.json();
  };

  const find = useMutation({
    mutationFn: () => send("POST", "/api/admin/sponsor-finder", { eventId, brief, count }),
    onSuccess: () => { setBrief(""); refresh(); },
    onError: fail,
  });
  const findContact = useMutation({
    mutationFn: (c: { company: string; website: string }) => send("POST", "/api/admin/sponsor-finder/contact", { eventId, ...c }),
    onSuccess: refresh,
    onError: fail,
  });
  async function dismiss(id: number) {
    await adminSend("DELETE", `/api/admin/sponsor-finder/${id}`);
    refresh();
  }

  // The newest contact look-up for each company, so a card can show it.
  const contacts = useMemo(() => {
    const m = new Map<string, Search>();
    for (const s of searches) if (s.kind === "contact" && !m.has(norm(s.company))) m.set(norm(s.company), s);
    return m;
  }, [searches]);
  const inLeads = useMemo(() => new Set(leads.flatMap((l) => [norm(l.company), norm(l.name)]).filter(Boolean)), [leads]);

  const add = useMutation({
    mutationFn: (c: Company) => {
      const found = contacts.get(norm(c.name));
      const extra = found?.status === "done" ? parse<Contact>(found.result) : null;
      const person = extra?.name ? extra : { name: c.contact_name, title: c.contact_title, linkedin: c.contact_linkedin, email: c.contact_email, phone: "", why: "", backup_name: "" };
      const notes = [c.why_fit, c.evidence && `Track record: ${c.evidence}`, person.why, person.backup_name && `Also try: ${person.backup_name}`, c.website && host(c.website), "Found with the sponsor finder"].filter(Boolean).join("\n");
      return send("POST", "/api/admin/sponsor-leads", {
        eventId,
        name: person.name || c.name,
        company: person.name ? c.name : "",
        title: person.title,
        linkedin: person.linkedin,
        email: person.email,
        phone: person.phone,
        notes,
        owner: "Riccoh",
      });
    },
    onSuccess: (_r, c) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/sponsor-leads", eventId] });
      toast({ title: "Added to Riccoh's leads", description: c.name });
    },
    onError: (err: Error) => toast({ title: "Couldn't add that", description: err.message, variant: "destructive" }),
  });

  const finds = searches.filter((s) => s.kind === "find");

  return (
    <div className="rounded-2xl border border-border bg-card p-5" data-testid="sponsor-finder">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 text-base font-semibold"><Sparkles className="h-4 w-4 text-[#053877] dark:text-blue-300" /> Find sponsors</h3>
          <p className="text-sm text-muted-foreground">Say what kind of company. We research ones that fit this event, and who to write to at each.</p>
        </div>
      </div>

      {data && !data.configured ? (
        <p className="mt-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-900/30 dark:text-amber-200">Add <code className="font-mono text-xs">PARALLEL_API_KEY</code> in Vercel and redeploy to turn this on.</p>
      ) : (
        <div className="mt-4 rounded-xl border border-dashed border-[#053877]/40 bg-[#053877]/[0.03] p-3">
          <Textarea
            value={brief}
            onChange={(e) => setBrief(e.target.value)}
            onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && !find.isPending) find.mutate(); }}
            rows={2}
            placeholder="Companies like Genius Network that back veteran entrepreneurs. Leave empty for our best guess."
            className="resize-none bg-background text-sm"
            data-testid="sponsor-finder-brief"
          />
          <div className="mt-2 flex flex-wrap gap-1.5">
            {EXAMPLES.map((ex) => (
              <button key={ex.label} type="button" onClick={() => setBrief(ex.brief)} className="rounded-full border border-border bg-background px-2.5 py-1 text-left text-[11px] text-muted-foreground hover:border-[#053877]/40 hover:text-foreground">
                {ex.label}
              </button>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <span className="text-[11px] text-muted-foreground">Takes 2 to 10 minutes. You can leave the page.</span>
            <div className="flex items-center gap-2">
              <select value={count} onChange={(e) => setCount(Number(e.target.value))} className="h-8 rounded-full border border-border bg-background px-2 text-xs" aria-label="How many companies">
                {[8, 12, 20].map((n) => <option key={n} value={n}>{n} companies</option>)}
              </select>
              <Button size="sm" className="gap-1.5 rounded-full bg-[#053877] text-white hover:bg-[#0a4a99]" disabled={find.isPending} onClick={() => find.mutate()} data-testid="sponsor-finder-go">
                {find.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />} Find sponsors
              </Button>
            </div>
          </div>
        </div>
      )}

      <div className="mt-5 flex flex-col gap-6">
        {finds.map((s) => {
          const result = s.status === "done" ? parse<{ companies?: Company[]; sources?: Sources }>(s.result) : null;
          const companies = result?.companies ?? [];
          return (
            <section key={s.id} data-testid={`sponsor-search-${s.id}`}>
              <div className="mb-2 flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-balance">{s.brief}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {s.status === "running" ? <span className="inline-flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin" /> Researching · started {since(s.createdAt, now)}</span>
                      : s.status === "failed" ? <span className="text-destructive">{s.error || "The research didn't finish."}</span>
                      : `${companies.length} companies · ${new Date(s.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`}
                  </p>
                </div>
                <button type="button" onClick={() => dismiss(s.id)} className="shrink-0 rounded-full p-1 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="Remove this search"><X className="h-3.5 w-3.5" /></button>
              </div>
              {s.status === "running" && (
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {[0, 1, 2].map((i) => <div key={i} className={`h-40 animate-pulse rounded-xl bg-muted/60 ${i === 0 ? "" : i === 1 ? "hidden sm:block" : "hidden xl:block"}`} />)}
                </div>
              )}
              {companies.length > 0 && (
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {companies.map((c, i) => (
                    <CompanyCard
                      key={`${c.name}-${i}`}
                      c={c}
                      sources={(result?.sources ?? []).filter((b) => new RegExp(`^companies[.\\[]${i}\\b`).test(b.field)).flatMap((b) => b.urls)}
                      contact={contacts.get(norm(c.name))}
                      added={inLeads.has(norm(c.name))}
                      onAdd={() => add.mutate(c)}
                      adding={add.isPending && add.variables?.name === c.name}
                      onFindContact={() => findContact.mutate({ company: c.name, website: c.website })}
                    />
                  ))}
                </div>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}

function CompanyCard({ c, sources, contact, added, onAdd, adding, onFindContact }: {
  c: Company;
  sources: string[];
  contact?: Search;
  added: boolean;
  onAdd: () => void;
  adding: boolean;
  onFindContact: () => void;
}) {
  const found = contact?.status === "done" ? parse<Contact>(contact.result) : null;
  const person = found?.name
    ? { name: found.name, title: found.title, linkedin: found.linkedin, email: found.email }
    : { name: c.contact_name, title: c.contact_title, linkedin: c.contact_linkedin, email: c.contact_email };
  const uniq = Array.from(new Set(sources)).slice(0, 4);
  return (
    <div className="flex flex-col rounded-xl border border-border bg-background p-3" data-testid="sponsor-finder-company">
      <div className="flex items-start gap-2">
        <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[#053877]/10 text-[#053877] dark:bg-blue-900/40 dark:text-blue-300"><Building2 className="h-3.5 w-3.5" /></span>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{c.name}</p>
          <p className="truncate text-[11px] text-muted-foreground">{[c.category, c.hq].filter(Boolean).join(" · ")}</p>
        </div>
      </div>
      {c.size && <p className="mt-1.5 text-[11px] text-muted-foreground">{c.size}</p>}
      <p className="mt-2 text-xs leading-relaxed">{c.why_fit}</p>
      {c.evidence && <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground"><span className="font-medium text-foreground/80">Track record:</span> {c.evidence}</p>}

      <div className="mt-3 rounded-lg bg-muted/50 p-2 text-xs">
        {person.name ? (
          <>
            <p className="font-medium">{person.name}{person.title ? <span className="font-normal text-muted-foreground"> · {person.title}</span> : null}</p>
            <div className="mt-1 flex flex-wrap gap-3">
              {person.linkedin && <a href={href(person.linkedin)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[#053877] hover:underline dark:text-blue-300"><Linkedin className="h-3 w-3" /> LinkedIn</a>}
              {person.email && <a href={`mailto:${person.email}`} className="inline-flex min-w-0 items-center gap-1 text-[#053877] hover:underline dark:text-blue-300"><Mail className="h-3 w-3 shrink-0" /> <span className="truncate">{person.email}</span></a>}
            </div>
          </>
        ) : contact?.status === "running" ? (
          <p className="inline-flex items-center gap-1 text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" /> Finding the right person…</p>
        ) : (
          <p className="text-muted-foreground">{contact?.status === "done" || contact?.status === "failed" ? "No one found yet." : "No contact yet."}</p>
        )}
        {!found?.name && contact?.status !== "running" && (
          <button type="button" onClick={onFindContact} className="mt-1 inline-flex items-center gap-1 text-[11px] font-medium text-[#053877] hover:underline dark:text-blue-300">
            <UserSearch className="h-3 w-3" /> {person.name ? "Find a better contact" : "Find the right person"}
          </button>
        )}
      </div>

      <div className="mt-auto flex items-center justify-between gap-2 pt-3">
        <span className="flex min-w-0 flex-wrap gap-x-2 gap-y-0.5 text-[11px]">
          {c.website && <a href={href(c.website)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-muted-foreground hover:text-foreground">{host(c.website)} <ExternalLink className="h-2.5 w-2.5" /></a>}
          {uniq.map((u, k) => <a key={u} href={u} target="_blank" rel="noreferrer" className="text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">[{k + 1}]</a>)}
        </span>
        {added ? (
          <span className="inline-flex shrink-0 items-center gap-1 text-[11px] font-medium text-emerald-700 dark:text-emerald-400"><Check className="h-3 w-3" /> In leads</span>
        ) : (
          <Button size="sm" variant="outline" className="h-7 shrink-0 rounded-full text-xs" disabled={adding} onClick={onAdd}>Add to leads</Button>
        )}
      </div>
    </div>
  );
}
