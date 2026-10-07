import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { adminGet, adminSend } from "@/lib/adminApi";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { Check, ExternalLink, Loader2, Plus, Search, Trash2 } from "lucide-react";

// Brand prospects: who already advertises to the military community. Search
// Meta's or LinkedIn's public ad library for a phrase, see the advertisers with
// how many ads they're running and one of them, and save the good ones to the
// sales list. Each one gets a stage and a note.

type Found = { name: string; source: "meta" | "linkedin"; ads: number; sample: string; link: string; website: string; active: boolean; saved: boolean };
type Prospect = { id: number; name: string; source: string; query: string; website: string; link: string; adCount: number; sample: string; status: string; notes: string; createdAt: string };
type Data = { ready: boolean; phrases: string[]; saved: Prospect[] };

const STAGES: [string, string][] = [["new", "New"], ["contacted", "Contacted"], ["signed_up", "Signed up"], ["passed", "Passed"]];

export function AdminProspects() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const q = useQuery<Data>({ queryKey: ["/api/admin/prospects"], queryFn: () => adminGet("/api/admin/prospects") });
  const [source, setSource] = useState<"meta" | "linkedin">("meta");
  const [phrase, setPhrase] = useState("");
  const [found, setFound] = useState<Found[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [lastQ, setLastQ] = useState("");
  const refresh = () => void qc.invalidateQueries({ queryKey: ["/api/admin/prospects"] });

  const search = async (text: string) => {
    if (!text.trim()) return;
    setBusy(true); setPhrase(text); setLastQ(text);
    try {
      setFound((await (await adminSend("POST", "/api/admin/prospects/search", { source, q: text })).json()) as Found[]);
    } catch (e) {
      toast({ title: "Search didn't run", description: (e as Error).message, variant: "destructive" });
    } finally { setBusy(false); }
  };
  const save = async (a: Found) => {
    try {
      await adminSend("POST", "/api/admin/prospects", { ...a, query: lastQ });
      setFound((f) => f?.map((x) => (x.name === a.name ? { ...x, saved: true } : x)) ?? null);
      refresh();
    } catch (e) { toast({ title: "Not saved", description: (e as Error).message, variant: "destructive" }); }
  };
  const update = async (p: Prospect, patch: Partial<Prospect>) => {
    try { await adminSend("PUT", `/api/admin/prospects/${p.id}`, patch); refresh(); } catch (e) { toast({ title: "Not saved", description: (e as Error).message, variant: "destructive" }); }
  };
  const remove = async (p: Prospect) => { await adminSend("DELETE", `/api/admin/prospects/${p.id}`).catch(() => {}); refresh(); };

  const saved = q.data?.saved ?? [];
  return (
    <div className="space-y-6" data-testid="admin-prospects">
      <section className="rounded-2xl border border-border bg-card p-5">
        <h3 className="text-lg font-semibold">Who advertises to the military community today</h3>
        <p className="mt-1 text-sm text-muted-foreground">Search the public ad libraries for a phrase. Every advertiser running those ads already has a budget for this audience.</p>
        {q.data && !q.data.ready && (
          <p className="mt-3 rounded-lg bg-[#F0A71F]/15 px-3 py-2 text-sm text-[#8a5a00] dark:text-[#F0A71F]">Waiting for the SearchApi key: add SEARCHAPI_API_KEY in Vercel and this starts working. Saved prospects and adding by hand work now.</p>
        )}
        <form className="mt-4 flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); void search(phrase); }}>
          <div className="flex rounded-lg border border-border p-0.5" role="radiogroup" aria-label="Which ad library">
            {(["meta", "linkedin"] as const).map((s) => (
              <button key={s} type="button" role="radio" aria-checked={source === s} onClick={() => setSource(s)} className={`rounded-md px-3 py-1.5 text-sm ${source === s ? "bg-[#053877] font-semibold text-white" : "hover:bg-muted"}`}>
                {s === "meta" ? "Facebook and Instagram" : "LinkedIn"}
              </button>
            ))}
          </div>
          <Input value={phrase} onChange={(e) => setPhrase(e.target.value)} placeholder="veteran discount" className="h-10 min-w-[200px] flex-1" data-testid="prospects-q" />
          <Button type="submit" disabled={busy || !phrase.trim()} className="h-10 gap-1.5">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />} Search</Button>
        </form>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {(q.data?.phrases ?? []).map((p) => (
            <button key={p} type="button" onClick={() => void search(p)} className="rounded-full border border-border px-2.5 py-1 text-xs text-muted-foreground hover:border-[#053877]/40 hover:text-foreground">{p}</button>
          ))}
        </div>

        {found && (
          <ul className="mt-4 divide-y divide-border rounded-xl border border-border">
            {found.length === 0 && <li className="p-4 text-sm text-muted-foreground">No advertisers for “{lastQ}”.</li>}
            {found.map((a) => (
              <li key={a.name} className="flex flex-wrap items-start gap-3 p-3">
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">{a.name} <span className="ml-1 text-xs font-normal text-muted-foreground">{a.ads} {a.ads === 1 ? "ad" : "ads"}{a.website ? ` · ${a.website}` : ""}</span></p>
                  {a.sample && <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{a.sample}</p>}
                </div>
                {a.link && <a href={a.link} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:underline">Their ads <ExternalLink className="h-3 w-3" /></a>}
                {a.saved ? <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-600"><Check className="h-3.5 w-3.5" /> On the list</span>
                  : <Button size="sm" variant="outline" className="gap-1" onClick={() => void save(a)}><Plus className="h-3.5 w-3.5" /> Save</Button>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <div className="flex items-baseline justify-between gap-3">
          <h3 className="text-lg font-semibold">The list <span className="text-sm font-normal text-muted-foreground">· {saved.length}</span></h3>
          <AddByHand onAdd={async (name, website) => { await adminSend("POST", "/api/admin/prospects", { name, website }); refresh(); }} />
        </div>
        {saved.length === 0 ? (
          <p className="mt-3 rounded-2xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">Nobody yet. Search above, or add a company by hand.</p>
        ) : (
          <ul className="mt-3 divide-y divide-border rounded-2xl border border-border bg-card">
            {saved.map((p) => (
              <li key={p.id} className="flex flex-wrap items-start gap-3 p-4">
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">{p.name}{p.website && <a href={/^https?:/.test(p.website) ? p.website : `https://${p.website}`} target="_blank" rel="noreferrer" className="ml-2 text-xs font-normal text-muted-foreground hover:underline">{p.website.replace(/^https?:\/\/(www\.)?/, "")}</a>}</p>
                  <p className="text-xs text-muted-foreground">{p.source === "manual" ? "Added by hand" : `${p.adCount} ${p.adCount === 1 ? "ad" : "ads"} on ${p.source === "meta" ? "Facebook and Instagram" : "LinkedIn"}${p.query ? ` for “${p.query}”` : ""}`}</p>
                  {p.sample && <p className="mt-1 line-clamp-2 text-xs text-foreground/70">{p.sample}</p>}
                  <input defaultValue={p.notes} onBlur={(e) => { if (e.target.value !== p.notes) void update(p, { notes: e.target.value }); }} placeholder="A note: who to talk to, what they said" className="mt-2 h-8 w-full rounded-lg border border-input bg-background px-2.5 text-xs" />
                </div>
                <select value={p.status} onChange={(e) => void update(p, { status: e.target.value })} className="h-8 rounded-lg border border-input bg-background px-2 text-xs" aria-label="Stage">
                  {STAGES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
                {p.link && <a href={p.link} target="_blank" rel="noreferrer" className="p-1.5 text-muted-foreground hover:text-foreground" aria-label="Their ads"><ExternalLink className="h-4 w-4" /></a>}
                <button type="button" onClick={() => void remove(p)} className="p-1.5 text-muted-foreground hover:text-red-600" aria-label={`Remove ${p.name}`}><Trash2 className="h-4 w-4" /></button>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-xs text-muted-foreground">Inviting one? Send them to militaryvoices.ai/for-brands?ref=prospects so their sign-up shows where it came from.</p>
      </section>
    </div>
  );
}

function AddByHand({ onAdd }: { onAdd: (name: string, website: string) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [site, setSite] = useState("");
  if (!open) return <Button size="sm" variant="outline" className="gap-1" onClick={() => setOpen(true)}><Plus className="h-3.5 w-3.5" /> Add a company</Button>;
  return (
    <form className="flex flex-wrap gap-2" onSubmit={async (e) => { e.preventDefault(); if (!name.trim()) return; await onAdd(name.trim(), site.trim()); setName(""); setSite(""); setOpen(false); }}>
      <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Company" className="h-8 w-40 text-sm" />
      <Input value={site} onChange={(e) => setSite(e.target.value)} placeholder="website.com" className="h-8 w-36 text-sm" />
      <Button size="sm" type="submit" disabled={!name.trim()}>Add</Button>
    </form>
  );
}
