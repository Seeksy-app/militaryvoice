import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { adminGet, adminSend } from "@/lib/adminApi";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Building2, ExternalLink, Eye } from "lucide-react";
import { ORG_KINDS, type OrganizationRow } from "@shared/schema";
import { AdminProspects } from "@/components/AdminProspects";

// Admin → Organizations: every brand, agency and event organizer on the
// platform, with its team, events and lists. Brands wait here for approval
// before they can send creators requests.

type Org = OrganizationRow & {
  team: { id: number; email: string; role: string; status: string }[];
  events: { id: number; name: string; review: string }[];
  lists: number;
  source: string;
};
const FILTERS = [
  { key: "all", label: "All" },
  { key: "pending", label: "Waiting for approval" },
  { key: "brand", label: "Brands" },
  { key: "agency", label: "Agencies" },
  { key: "organizer", label: "Event organizers" },
] as const;

export function AdminOrgs() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const q = useQuery<Org[]>({ queryKey: ["/api/admin/orgs"], queryFn: () => adminGet("/api/admin/orgs") });
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["key"]>("all");
  // Accounts we have, and prospects we're after.
  const [view, setView] = useState<"accounts" | "prospects">("accounts");
  const all = q.data ?? [];
  const rows = all.filter((o) => filter === "all" ? true : filter === "pending" ? o.status === "pending" : o.kind === filter);
  const count = (k: string) => all.filter((o) => k === "all" ? true : k === "pending" ? o.status === "pending" : o.kind === k).length;

  const setStatus = async (o: Org, status: string) => {
    try {
      await adminSend("POST", `/api/admin/orgs/${o.id}/status`, { status });
      void qc.invalidateQueries({ queryKey: ["/api/admin/orgs"] });
    } catch (e) { toast({ title: "Didn't work", description: (e as Error).message, variant: "destructive" }); }
  };
  const viewAs = async (email: string) => {
    try {
      const r = (await (await adminSend("POST", "/api/admin/view-as", { email })).json()) as { to?: string };
      window.open(r.to || "/host/dashboard", "_blank");
    } catch (e) { toast({ title: "Couldn't open their view", description: (e as Error).message, variant: "destructive" }); }
  };
  const backfill = async () => {
    try {
      const r = (await (await adminSend("POST", "/api/admin/orgs/backfill", {})).json()) as { made: number; eventsMoved: number; listsMoved: number };
      toast({ title: `${r.made} organizations made`, description: `${r.eventsMoved} events and ${r.listsMoved} saved lists now belong to one.` });
      void qc.invalidateQueries({ queryKey: ["/api/admin/orgs"] });
    } catch (e) { toast({ title: "Didn't work", description: (e as Error).message, variant: "destructive" }); }
  };

  return (
    <div className="max-w-5xl space-y-5" data-testid="admin-orgs">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Organizations</h2>
          <p className="mt-1 text-sm text-muted-foreground">Brands, agencies and event organizers, each with its own team. Brands are approved here before they can send creators requests.</p>
        </div>
        <Button variant="outline" onClick={() => void backfill()} title="Make organizations for planners who already have events, and for brands and agencies already on Discovery" data-testid="orgs-backfill">Bring existing accounts in</Button>
      </div>

      <div className="flex gap-5 border-b border-border" role="tablist">
        {([["accounts", "Accounts"], ["prospects", "Brand prospects"]] as const).map(([k, l]) => (
          <button key={k} type="button" role="tab" aria-selected={view === k} onClick={() => setView(k)} className={`-mb-px border-b-2 pb-2 text-sm font-semibold ${view === k ? "border-[#053877] text-foreground dark:border-[#9cc2ff]" : "border-transparent text-muted-foreground hover:text-foreground"}`} data-testid={`orgs-tab-${k}`}>{l}</button>
        ))}
      </div>

      {view === "prospects" ? <AdminProspects /> : <>
      <div className="flex flex-wrap gap-1.5">
        {FILTERS.map((f) => (
          <button key={f.key} type="button" onClick={() => setFilter(f.key)} className={`rounded-lg px-3 py-1.5 text-sm ${filter === f.key ? "bg-[#053877] font-semibold text-white" : "hover:bg-muted"}`}>
            {f.label} <span className={`ml-1 text-xs tabular-nums ${filter === f.key ? "text-white/80" : "text-muted-foreground"}`}>{count(f.key)}</span>
          </button>
        ))}
      </div>

      {q.isLoading ? <p className="text-sm text-muted-foreground">Loading…</p> : rows.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground"><Building2 className="mx-auto mb-2 h-6 w-6 opacity-50" />No organizations here yet.</p>
      ) : (
        <ul className="space-y-3">
          {rows.map((o) => {
            const owner = o.team.find((t) => t.role === "owner" && t.status === "active");
            return (
              <li key={o.id} className={`rounded-2xl border bg-card p-5 ${o.status === "pending" ? "border-2 border-[#F0A71F]/60" : "border-border"}`} data-testid={`admin-org-${o.id}`}>
                <div className="flex flex-wrap items-start gap-4">
                  {o.logoUrl ? <img src={o.logoUrl} alt="" className="h-12 w-12 shrink-0 rounded-xl border border-border bg-white object-contain p-1" /> : (
                    <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-[#053877] text-lg font-bold text-white">{o.name.trim().charAt(0).toUpperCase()}</span>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">{o.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {ORG_KINDS[o.kind as keyof typeof ORG_KINDS] ?? o.kind} · since {new Date(o.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                      {o.website && <> · <a href={o.website} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 hover:underline">{o.website.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "")}<ExternalLink className="h-3 w-3" /></a></>}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {o.source && <span title="Where they signed up from">From {o.source.replace(/^brand-/, "")} · </span>}
                      {o.team.length} on the team{o.events.length ? ` · ${o.events.length} ${o.events.length === 1 ? "event" : "events"}` : ""}{o.lists ? ` · ${o.lists} saved ${o.lists === 1 ? "list" : "lists"}` : ""}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    {o.status === "pending" ? (
                      <>
                        <Button size="sm" onClick={() => void setStatus(o, "approved")} data-testid={`org-approve-${o.id}`}>Approve</Button>
                        <Button size="sm" variant="outline" onClick={() => void setStatus(o, "declined")}>Decline</Button>
                      </>
                    ) : (
                      <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${o.status === "approved" ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300" : "bg-red-100 text-red-700"}`}>{o.status === "approved" ? "Approved" : "Declined"}</span>
                    )}
                    {owner && <Button size="sm" variant="ghost" className="gap-1" onClick={() => void viewAs(owner.email)} title={`See the dashboard as ${owner.email}`}><Eye className="h-3.5 w-3.5" /> View as</Button>}
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {o.team.map((t) => (
                    <span key={t.id} className="rounded-full bg-muted px-2.5 py-0.5 text-xs">{t.email}{t.role === "owner" ? " · owner" : ""}{t.status === "invited" ? " · invited" : ""}</span>
                  ))}
                  {o.events.map((e) => (
                    <a key={e.id} href={`/admin/e/${e.id}`} className="rounded-full bg-[#053877]/10 px-2.5 py-0.5 text-xs font-medium text-[#053877] hover:underline dark:text-[#9cc2ff]">{e.name}{e.review && e.review !== "approved" ? ` · ${e.review}` : ""}</a>
                  ))}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      </>}
    </div>
  );
}
