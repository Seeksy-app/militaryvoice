import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { Building2, Check, Clock, Globe, Loader2, Mail, UserPlus, X } from "lucide-react";
import { ORG_KINDS, type OrganizationRow } from "@shared/schema";

// Your organization: a brand, an agency or an event organizer, with a team.
// You still sign in as yourself; the organization is what you belong to, and
// its events and saved lists are shared with everyone on it.

type TeamMember = { id: number; email: string; role: string; status: string; joinedAt: string };
type Org = OrganizationRow & { role: string; myMemberId: number; team: TeamMember[]; events: number };
type Invite = { id: number; orgId: number; invitedBy: string; org: OrganizationRow };
type Data = { orgs: Org[]; invites: Invite[] };
const KEY = ["/api/host/orgs"];
const kindLabel = (k: string) => ORG_KINDS[k as keyof typeof ORG_KINDS] ?? k;

async function call(method: string, url: string, body?: unknown) {
  return (await apiRequest(method, url, body)).json();
}

/** Invitations waiting on them: shown on the dashboard home and on this screen. */
export function OrgInvites({ compact = false }: { compact?: boolean }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const q = useQuery<Data>({ queryKey: KEY, queryFn: () => call("GET", "/api/host/orgs") });
  const answer = async (inv: Invite, accept: boolean) => {
    try {
      await call("POST", `/api/host/org-invites/${inv.id}`, { accept });
      toast({ title: accept ? `You're on the ${inv.org.name} team` : "Invitation turned down" });
      void qc.invalidateQueries({ queryKey: KEY });
      void qc.invalidateQueries({ queryKey: ["/api/host/my-events"] });
    } catch (e) {
      toast({ title: "Didn't work", description: (e as Error).message, variant: "destructive" });
    }
  };
  const invites = q.data?.invites ?? [];
  if (!invites.length) return null;
  return (
    <div className={`space-y-2 ${compact ? "mt-6" : ""}`} data-testid="org-invites">
      {invites.map((inv) => (
        <div key={inv.id} className="flex flex-wrap items-center gap-3 rounded-2xl border-2 border-[#F0A71F]/60 bg-[#F0A71F]/10 p-4">
          <Building2 className="h-5 w-5 shrink-0 text-[#8a5a00] dark:text-[#F0A71F]" />
          <p className="min-w-0 flex-1 text-sm"><span className="font-semibold">{inv.invitedBy || "Someone"}</span> added you to <span className="font-semibold">{inv.org.name}</span> ({kindLabel(inv.org.kind).toLowerCase()}).</p>
          <Button size="sm" onClick={() => void answer(inv, true)} className="rounded-full bg-[#053877] text-white hover:bg-[#0a4a99]" data-testid={`org-invite-join-${inv.id}`}>Join</Button>
          <Button size="sm" variant="ghost" onClick={() => void answer(inv, false)}>No thanks</Button>
        </div>
      ))}
    </div>
  );
}

export function MyOrganization({ defaultKind = "brand" }: { defaultKind?: keyof typeof ORG_KINDS }) {
  const q = useQuery<Data>({ queryKey: KEY, queryFn: () => call("GET", "/api/host/orgs") });
  const orgs = q.data?.orgs ?? [];
  const [adding, setAdding] = useState(false);

  return (
    <section className="mt-6 max-w-3xl space-y-5" data-testid="my-organization">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{orgs.length > 1 ? "Your organizations" : "Your organization"}</h1>
        <p className="mt-1 text-sm text-muted-foreground [text-wrap:pretty]">A brand, an agency or an event organizer, with your team. You each sign in as yourselves; its events and saved lists are shared with everyone on it.</p>
      </div>
      <OrgInvites />
      {q.isLoading ? (
        <div className="flex justify-center p-10"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : (
        <>
          {orgs.map((o) => <OrgCard key={o.id} org={o} />)}
          {(orgs.length === 0 || adding) ? <NewOrg defaultKind={defaultKind} onDone={() => setAdding(false)} first={orgs.length === 0} /> : (
            <button type="button" onClick={() => setAdding(true)} className="text-sm font-semibold text-[#053877] hover:underline dark:text-[#9cc2ff]">+ Set up another organization</button>
          )}
        </>
      )}
    </section>
  );
}

function NewOrg({ defaultKind, onDone, first }: { defaultKind: string; onDone: () => void; first: boolean }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [kind, setKind] = useState(defaultKind);
  const [website, setWebsite] = useState("");
  const [busy, setBusy] = useState(false);
  const create = async () => {
    setBusy(true);
    try {
      const org = (await call("POST", "/api/host/orgs", { name, kind, website })) as OrganizationRow;
      toast({ title: `${org.name} is set up`, description: org.status === "pending" ? "We'll approve it shortly; you can add your team now." : "Add your team next." });
      void qc.invalidateQueries({ queryKey: KEY });
      onDone();
    } catch (e) {
      toast({ title: "Not set up", description: (e as Error).message, variant: "destructive" });
    } finally { setBusy(false); }
  };
  return (
    <form className="space-y-4 rounded-2xl border border-border bg-card p-5" onSubmit={(e) => { e.preventDefault(); if (name.trim()) void create(); }} data-testid="org-new">
      <h2 className="text-lg font-semibold">{first ? "Set up your organization" : "Another organization"}</h2>
      <div className="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="What kind">
        {Object.entries(ORG_KINDS).map(([k, label]) => (
          <button key={k} type="button" role="radio" aria-checked={kind === k} onClick={() => setKind(k)}
            className={`rounded-xl border-2 px-3 py-2.5 text-left text-sm transition ${kind === k ? "border-[#053877] bg-[#053877]/[0.06] font-semibold" : "border-border hover:border-[#053877]/40"}`}>
            {label}
            <span className="block text-xs font-normal text-muted-foreground">{k === "brand" ? "Sponsor shows, work with creators" : k === "agency" ? "For brands you represent" : "Run live events here"}</span>
          </button>
        ))}
      </div>
      <label className="block text-sm font-medium">Its name
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Acme Outdoor Co." className="mt-1" data-testid="org-name" />
      </label>
      <label className="block text-sm font-medium">Website <span className="font-normal text-muted-foreground">(optional)</span>
        <Input value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="acme.com" inputMode="url" className="mt-1" />
      </label>
      <div className="flex gap-2">
        <Button type="submit" disabled={busy || !name.trim()} className="rounded-full bg-[#053877] text-white hover:bg-[#0a4a99]" data-testid="org-create">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Set it up"}</Button>
        {!first && <Button type="button" variant="ghost" onClick={onDone}>Cancel</Button>}
      </div>
    </form>
  );
}

function OrgCard({ org }: { org: Org }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const owner = org.role === "owner";
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ name: org.name, website: org.website, logoUrl: org.logoUrl, about: org.about });
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const refresh = () => void qc.invalidateQueries({ queryKey: KEY });
  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    setBusy(true);
    try { await fn(); if (ok) toast({ title: ok }); refresh(); } catch (e) { toast({ title: "Didn't work", description: (e as Error).message, variant: "destructive" }); } finally { setBusy(false); }
  };
  const activeOwners = org.team.filter((t) => t.role === "owner" && t.status === "active").length;

  return (
    <article className="overflow-hidden rounded-2xl border border-border bg-card" data-testid={`org-${org.id}`}>
      <header className="flex flex-wrap items-start gap-4 p-5">
        {org.logoUrl ? <img src={org.logoUrl} alt="" className="h-14 w-14 shrink-0 rounded-xl border border-border bg-white object-contain p-1" /> : (
          <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-[#053877] text-xl font-bold text-white">{org.name.trim().charAt(0).toUpperCase()}</span>
        )}
        <div className="min-w-0 flex-1">
          <h2 className="text-xl font-semibold">{org.name}</h2>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
            <span className="rounded-full bg-[#053877]/10 px-2 py-0.5 font-semibold text-[#053877] dark:text-[#9cc2ff]">{kindLabel(org.kind)}</span>
            {org.status === "pending" && <span className="inline-flex items-center gap-1 rounded-full bg-[#F0A71F]/20 px-2 py-0.5 font-semibold text-[#8a5a00] dark:text-[#F0A71F]"><Clock className="h-3 w-3" /> Waiting for our approval</span>}
            {org.status === "declined" && <span className="rounded-full bg-red-100 px-2 py-0.5 font-semibold text-red-700">Not approved: write to hello@militaryvoices.ai</span>}
            {org.website && <a href={org.website} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-muted-foreground hover:underline"><Globe className="h-3 w-3" />{org.website.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "")}</a>}
            {org.kind === "organizer" && <span className="text-muted-foreground">· {org.events} {org.events === 1 ? "event" : "events"}</span>}
          </div>
          {org.about && !editing && <p className="mt-2 text-sm text-foreground/80">{org.about}</p>}
        </div>
        {owner && !editing && <Button variant="outline" size="sm" onClick={() => setEditing(true)}>Edit</Button>}
      </header>

      {editing && (
        <form className="space-y-3 border-t border-border p-5" onSubmit={(e) => { e.preventDefault(); void run(() => call("PUT", `/api/host/orgs/${org.id}`, form), "Saved").then(() => setEditing(false)); }}>
          <label className="block text-sm font-medium">Name<Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="mt-1" /></label>
          <label className="block text-sm font-medium">Website<Input value={form.website} onChange={(e) => setForm({ ...form, website: e.target.value })} className="mt-1" /></label>
          <label className="block text-sm font-medium">Logo link<Input value={form.logoUrl} onChange={(e) => setForm({ ...form, logoUrl: e.target.value })} placeholder="https://…/logo.png" className="mt-1" /></label>
          <label className="block text-sm font-medium">About<Textarea value={form.about} onChange={(e) => setForm({ ...form, about: e.target.value })} rows={3} placeholder="A sentence or two creators will see" className="mt-1" /></label>
          <div className="flex gap-2"><Button type="submit" disabled={busy}>Save</Button><Button type="button" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button></div>
        </form>
      )}

      <div className="border-t border-border p-5">
        <h3 className="text-sm font-semibold">Team <span className="font-normal text-muted-foreground">· {org.team.length}</span></h3>
        <ul className="mt-2 divide-y divide-border rounded-xl border border-border">
          {org.team.map((t) => (
            <li key={t.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm">
              <span className="min-w-0 flex-1 truncate">{t.email}</span>
              {t.status === "invited" && <span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><Mail className="h-3 w-3" /> Invited</span>}
              {owner ? (
                <select value={t.role} disabled={busy || (t.role === "owner" && activeOwners <= 1 && t.status === "active")} onChange={(e) => void run(() => call("PUT", `/api/host/orgs/${org.id}/members/${t.id}`, { role: e.target.value }))} className="h-8 rounded-lg border border-input bg-background px-2 text-xs" aria-label="Role">
                  <option value="owner">Owner</option>
                  <option value="member">Member</option>
                </select>
              ) : <span className="text-xs text-muted-foreground">{t.role === "owner" ? "Owner" : "Member"}</span>}
              {owner && !(t.role === "owner" && activeOwners <= 1 && t.status === "active") && (
                <button type="button" disabled={busy} onClick={() => { if (confirm(`Take ${t.email} off the team?`)) void run(() => call("DELETE", `/api/host/orgs/${org.id}/members/${t.id}`)); }} className="rounded p-1 text-muted-foreground hover:text-red-600" aria-label={`Remove ${t.email}`}><X className="h-4 w-4" /></button>
              )}
            </li>
          ))}
        </ul>
        {owner ? (
          <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (email.trim()) void run(() => call("POST", `/api/host/orgs/${org.id}/members`, { email }), `Invitation sent to ${email.trim()}`).then(() => setEmail("")); }}>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="A teammate's email" className="h-10" data-testid={`org-invite-email-${org.id}`} />
            <Button type="submit" disabled={busy || !email.trim()} className="h-10 gap-1.5 rounded-full bg-[#053877] px-5 text-white hover:bg-[#0a4a99]"><UserPlus className="h-4 w-4" /> Invite</Button>
          </form>
        ) : (
          <LeaveButton org={org} onLeft={refresh} />
        )}
        {owner && <p className="mt-2 flex items-center gap-1 text-xs text-muted-foreground"><Check className="h-3 w-3" /> They get an email, and Join on their dashboard when they sign in with that address.</p>}
      </div>
    </article>
  );
}

function LeaveButton({ org, onLeft }: { org: Org; onLeft: () => void }) {
  const { toast } = useToast();
  return (
    <button type="button" className="mt-3 text-xs font-semibold text-red-600 hover:underline" onClick={async () => {
      if (!org.myMemberId || !confirm(`Leave ${org.name}? Its events and lists stay with the team.`)) return;
      try { await call("DELETE", `/api/host/orgs/${org.id}/members/${org.myMemberId}`); onLeft(); } catch (e) { toast({ title: "Didn't work", description: (e as Error).message, variant: "destructive" }); }
    }}>Leave this organization</button>
  );
}
