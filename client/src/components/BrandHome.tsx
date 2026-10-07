import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest, apiUpload } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { IconTile } from "@/components/ui/icon-tile";
import { useToast } from "@/hooks/use-toast";
import { ArrowRight, BadgeCheck, Bookmark, Building2, Check, Clock, Compass, Handshake, Loader2, Megaphone, Send, Users } from "lucide-react";
import type { OrganizationRow } from "@shared/schema";

// The brand's side of the platform (7 Oct): a brand or agency signs up to
// find military and veteran creators, save them to lists with their team, and
// (next) send them requests and run deals. Setup asks only who they are.

const GOALS = [
  { key: "sponsor", label: "Sponsor podcasts and shows" },
  { key: "campaign", label: "Creators for a campaign" },
  { key: "speakers", label: "Speakers or guests for an event" },
  { key: "ambassadors", label: "Ambassadors for our brand" },
] as const;

async function call(method: string, url: string, body?: unknown) {
  return (await apiRequest(method, url, body)).json();
}

/** Who they are, once: their name, the company, brand or agency, and what they're here for. */
export function BrandSetup({ onDone }: { onDone: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [company, setCompany] = useState("");
  const [kind, setKind] = useState<"brand" | "agency">("brand");
  const [website, setWebsite] = useState("");
  const [goals, setGoals] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const ready = name.trim() && company.trim();

  const save = async () => {
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("hostName", name.trim());
      fd.append("interests", "brand");
      await apiUpload("PUT", "/api/host/profile", fd);
      const joined = (await call("POST", "/api/discover/join", { role: kind, orgName: company.trim(), website, source: "brand-signup" })) as { orgId: number };
      if (joined.orgId && goals.length) {
        const about = `Here for: ${goals.map((g) => GOALS.find((x) => x.key === g)?.label.toLowerCase()).join(", ")}.`;
        await call("PUT", `/api/host/orgs/${joined.orgId}`, { about }).catch(() => undefined);
      }
      try { localStorage.removeItem("mv_interests"); } catch { /* fine */ }
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["/api/host/profile"] }),
        qc.invalidateQueries({ queryKey: ["/api/host/orgs"] }),
        qc.invalidateQueries({ queryKey: ["/api/discover/me"] }),
      ]);
      onDone();
    } catch (e) {
      toast({ title: "Not saved", description: (e as Error).message, variant: "destructive" });
    } finally { setBusy(false); }
  };

  return (
    <section className="mx-auto mt-6 max-w-2xl" data-testid="brand-setup">
      <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#F0A71F]">For brands and agencies</p>
      <h1 className="mt-1 text-3xl font-bold tracking-tight" style={{ fontFamily: "'General Sans', 'Inter', sans-serif" }}>Tell us who you are</h1>
      <p className="mt-2 text-muted-foreground">Four quick answers. Then you're in Discovery, searching military and veteran creators.</p>
      <form className="mt-6 space-y-5 rounded-2xl border border-border bg-card p-6" onSubmit={(e) => { e.preventDefault(); if (ready) void save(); }}>
        <label className="block text-sm font-medium">Your name
          <Input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" placeholder="Jordan Ellis" className="mt-1" data-testid="brand-name" />
        </label>
        <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
          <label className="block text-sm font-medium">Company
            <Input value={company} onChange={(e) => setCompany(e.target.value)} autoComplete="organization" placeholder="Acme Outdoor Co." className="mt-1" data-testid="brand-company" />
          </label>
          <div className="flex rounded-xl border border-border p-1" role="radiogroup" aria-label="Brand or agency">
            {(["brand", "agency"] as const).map((k) => (
              <button key={k} type="button" role="radio" aria-checked={kind === k} onClick={() => setKind(k)} className={`rounded-lg px-3.5 py-1.5 text-sm ${kind === k ? "bg-[#053877] font-semibold text-white" : "text-foreground hover:bg-muted"}`}>
                {k === "brand" ? "A brand" : "An agency"}
              </button>
            ))}
          </div>
        </div>
        <label className="block text-sm font-medium">Website <span className="font-normal text-muted-foreground">(optional)</span>
          <Input value={website} onChange={(e) => setWebsite(e.target.value)} inputMode="url" placeholder="acme.com" className="mt-1" />
        </label>
        <fieldset>
          <legend className="text-sm font-medium">What are you here for? <span className="font-normal text-muted-foreground">(pick any)</span></legend>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {GOALS.map((g) => {
              const on = goals.includes(g.key);
              return (
                <button key={g.key} type="button" aria-pressed={on} onClick={() => setGoals((v) => on ? v.filter((x) => x !== g.key) : [...v, g.key])}
                  className={`flex items-center gap-2 rounded-xl border-2 px-3 py-2.5 text-left text-sm transition ${on ? "border-[#053877] bg-[#053877]/[0.06] font-semibold" : "border-border hover:border-[#053877]/40"}`}>
                  <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${on ? "border-[#053877] bg-[#053877] text-white" : "border-muted-foreground/40"}`}>{on && <Check className="h-3 w-3" />}</span>
                  {g.label}
                </button>
              );
            })}
          </div>
        </fieldset>
        <Button type="submit" disabled={busy || !ready} className="h-11 w-full gap-2 rounded-full bg-[#053877] text-base text-white hover:bg-[#0a4a99]" data-testid="brand-save">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <>Start finding creators <ArrowRight className="h-4 w-4" /></>}
        </Button>
        <p className="text-center text-xs text-muted-foreground">Searching is free. We check every brand before it can send creators requests, usually within a day.</p>
      </form>
    </section>
  );
}

type Org = OrganizationRow & { role: string; team: { id: number; email: string; status: string }[] };
type List = { id: number; name: string; items: unknown[] };

/** The brand's home: their account, their lists, and what comes next. */
export function BrandHome({ firstName, goTo }: { firstName: string; goTo: (s: "discovery" | "verified" | "organization") => void }) {
  const orgs = useQuery<{ orgs: Org[] }>({ queryKey: ["/api/host/orgs"], queryFn: () => call("GET", "/api/host/orgs") });
  const lists = useQuery<List[]>({ queryKey: ["/api/discover/lists"], queryFn: () => call("GET", "/api/discover/lists"), retry: false });
  const me = useQuery<{ reveals?: { used: number; allowance: number } | null }>({ queryKey: ["/api/discover/me"], queryFn: () => call("GET", "/api/discover/me") });
  const org = (orgs.data?.orgs ?? []).find((o) => o.kind === "brand" || o.kind === "agency") ?? orgs.data?.orgs[0];
  const saved = (lists.data ?? []).reduce((n, l) => n + l.items.length, 0);
  const team = org?.team.length ?? 0;
  const reveals = me.data?.reveals;

  const steps = [
    { key: "search", label: "Search for creators", done: saved > 0, go: () => goTo("discovery"), cta: "Open Discovery" },
    { key: "save", label: "Save the ones you like to a list", done: saved > 0, go: () => goTo("discovery"), cta: "Find creators" },
    { key: "team", label: "Bring your team in", done: team > 1, go: () => goTo("organization"), cta: "Invite them" },
    { key: "logo", label: "Add your logo", done: !!org?.logoUrl, go: () => goTo("organization"), cta: "Add it" },
  ];

  return (
    <section className="mt-6 space-y-6" data-testid="brand-home">
      <div className="overflow-hidden rounded-3xl bg-[#000741] p-6 text-white sm:p-8">
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#F0A71F]">{org ? (org.kind === "agency" ? "Agency" : "Brand") : "Brand"}</p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight" style={{ fontFamily: "'General Sans', 'Inter', sans-serif" }}>Welcome, {firstName}</h1>
        <p className="mt-1 text-white/75">{org?.name ?? "Your company"}: military and veteran creators, measured.</p>
        {org?.status === "pending" && (
          <p className="mt-4 inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1.5 text-sm"><Clock className="h-4 w-4 text-[#F0A71F]" /> We're checking your account. Search and save creators now; requests open once you're approved.</p>
        )}
        {org?.status === "approved" && (
          <p className="mt-4 inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1.5 text-sm"><BadgeCheck className="h-4 w-4 text-emerald-300" /> Approved</p>
        )}
        <div className="mt-6 flex flex-wrap gap-3">
          <Button onClick={() => goTo("discovery")} className="gap-2 rounded-full bg-[#F0A71F] text-[#1a1200] hover:bg-[#f5b944]" data-testid="brand-go-discovery"><Compass className="h-4 w-4" /> Find creators</Button>
          <Button onClick={() => goTo("verified")} variant="outline" className="gap-2 rounded-full border-white/30 bg-transparent text-white hover:bg-white/10 hover:text-white"><BadgeCheck className="h-4 w-4" /> Verified creators</Button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Tile icon={Bookmark} label="Saved creators" value={String(saved)} sub={`${lists.data?.length ?? 0} ${lists.data?.length === 1 ? "list" : "lists"}, shared with your team`} onClick={() => goTo("discovery")} />
        <Tile icon={Users} label="Your team" value={String(team)} sub={team > 1 ? "Everyone shares the lists" : "Invite the people you work with"} onClick={() => goTo("organization")} />
        <Tile icon={Compass} label="Contact emails" value={reveals ? `${Math.max(0, reveals.allowance - reveals.used)}` : "…"} sub={reveals ? `left this month, of ${reveals.allowance}` : ""} onClick={() => goTo("discovery")} />
        <Tile icon={Send} label="Requests" value="0" sub={org?.status === "approved" ? "Opening next" : "Open once you're approved"} />
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <section className="rounded-2xl border border-border bg-card p-5">
          <h2 className="text-base font-semibold">Getting started</h2>
          <ul className="mt-3 divide-y divide-border">
            {steps.map((s) => (
              <li key={s.key} className="flex items-center gap-3 py-2.5">
                <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 ${s.done ? "border-emerald-600 bg-emerald-600 text-white" : "border-muted-foreground/40"}`}>{s.done && <Check className="h-3 w-3" />}</span>
                <span className={`min-w-0 flex-1 text-sm ${s.done ? "text-muted-foreground line-through" : "font-medium"}`}>{s.label}</span>
                {!s.done && <button type="button" onClick={s.go} className="shrink-0 text-sm font-semibold text-[#053877] hover:underline dark:text-[#9cc2ff]">{s.cta}</button>}
              </li>
            ))}
          </ul>
        </section>
        <section className="rounded-2xl border border-border bg-card p-5">
          <h2 className="text-base font-semibold">Ways to work with creators</h2>
          <ul className="mt-3 space-y-3 text-sm">
            <li className="flex gap-3"><IconTile icon={Megaphone} /><span><span className="block font-semibold">Sponsor a show</span><span className="text-muted-foreground">An ad read or a segment on a military or veteran podcast.</span></span></li>
            <li className="flex gap-3"><IconTile icon={Handshake} /><span><span className="block font-semibold">Run a campaign</span><span className="text-muted-foreground">Posts and videos from creators whose audience is yours.</span></span></li>
            <li className="flex gap-3"><IconTile icon={Building2} /><span><span className="block font-semibold">Book a speaker</span><span className="text-muted-foreground">Veterans with a story, for your event or your team.</span></span></li>
          </ul>
          <p className="mt-4 text-xs text-muted-foreground">Send a request from any creator's profile once you're approved. Questions? hello@militaryvoices.ai</p>
        </section>
      </div>
    </section>
  );
}

function Tile({ icon: Icon, label, value, sub, onClick }: { icon: typeof Users; label: string; value: string; sub: string; onClick?: () => void }) {
  const body = (
    <>
      <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground"><Icon className="h-4 w-4" /> {label}</span>
      <span className="mt-2 block text-3xl font-bold tabular-nums text-foreground">{value}</span>
      <span className="mt-1 block text-xs text-muted-foreground">{sub}</span>
    </>
  );
  return onClick ? (
    <button type="button" onClick={onClick} className="rounded-2xl border border-border bg-card p-5 text-left transition hover:border-[#053877]/40">{body}</button>
  ) : <div className="rounded-2xl border border-border bg-card p-5">{body}</div>;
}
