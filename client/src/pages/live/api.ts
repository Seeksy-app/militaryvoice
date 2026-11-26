import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

/**
 * Military Voices LIVE, phase 1 (Packet C screens on Packet A's /api/live/* contract, 26 Nov 2026).
 * Every role is held per production. A platform admin passes everywhere, as mv_admin.
 *
 * Mock: in local dev only, ?mock=client|crew|admin (remembered for the tab) answers every /api/live call from
 * memory, so nothing touches the live database and no invite email can go out. Production builds never mock.
 */

export type Role =
  | "mv_admin" | "mv_producer" | "mv_coordinator" | "mv_editor"
  | "crew_lead" | "crew_operator"
  | "client_admin" | "client_reviewer" | "client_viewer";

export const ROLE_LABEL: Record<Role, string> = {
  mv_admin: "MV Admin", mv_producer: "MV Producer", mv_coordinator: "MV Coordinator", mv_editor: "MV Editor",
  crew_lead: "Crew Lead", crew_operator: "Crew Operator",
  client_admin: "Client Admin", client_reviewer: "Client Reviewer", client_viewer: "Client Viewer",
};
export const MV_ROLES: Role[] = ["mv_producer", "mv_coordinator", "mv_editor"];
export const CREW_ROLES: Role[] = ["crew_lead", "crew_operator"];
export const CLIENT_ROLES: Role[] = ["client_admin", "client_reviewer", "client_viewer"];

export type Side = "mv" | "crew" | "client";
export const sideOf = (r: Role | null | undefined): Side => (!r || r.startsWith("mv_") ? "mv" : r.startsWith("crew_") ? "crew" : "client");

export type Status = "scoping" | "planning" | "rehearsal" | "live" | "post" | "delivered" | "closed";
export const STATUSES: Status[] = ["scoping", "planning", "rehearsal", "live", "post", "delivered", "closed"];
export const STATUS_LABEL: Record<Status, string> = {
  scoping: "Scoping", planning: "Planning", rehearsal: "Rehearsal", live: "Show days", post: "Post", delivered: "Delivered", closed: "Closed",
};

export type ClientOrg = { id: number; name: string; slug: string; logo_url: string; brand_color: string };
export type Production = {
  id: number; name: string; status: Status; starts_on: string; ends_on: string; timezone: string; scope: string;
  event_id: number | null; client: ClientOrg | null; my_role: Role | null; stage_count: number; member_count: number;
};
export type Venue = { id: number; name: string; address: string; city: string; state: string; timezone: string };
export type Stage = { id: number; production_id: number; venue_id: number | null; name: string; studio_id: number | null };
export type MemberStatus = "invited" | "active" | "removed";
export type Member = {
  id: number; production_id: number; email: string; name: string; org_id: number | null; org_name: string;
  role: Role; status: MemberStatus; invited_by: string; created_at: string;
};
export type Approval = {
  id: number; subject_type: string; subject_id: number; title: string; version: number; requested_by: string;
  approver_role: Role; state: "pending" | "approved" | "changes_requested" | "withdrawn"; decided_by: string; decided_at: string; note: string;
};
export type AuditRow = { id: number; who: string; what: string; subject: string; at: string };

/* ------------------------------------------------------------------ permissions (plan section 4) */

/** Platform admins act as mv_admin on every production. */
export const effectiveRole = (p: Production | null | undefined, isAdmin: boolean): Role | null => (isAdmin ? p?.my_role ?? "mv_admin" : p?.my_role ?? null);

export const can = {
  editProduction: (r: Role | null) => r === "mv_admin" || r === "mv_producer" || r === "mv_coordinator",
  /** Roles this person may add or change on a production; empty means they can't manage people. */
  assignable: (r: Role | null): Role[] =>
    r === "mv_admin" || r === "mv_coordinator" ? [...MV_ROLES, ...CREW_ROLES, ...CLIENT_ROLES]
      : r === "crew_lead" ? ["crew_operator"]
        : r === "client_admin" ? ["client_reviewer", "client_viewer"]
          : [],
  decide: (r: Role | null) => r === "client_admin" || r === "client_reviewer",
};

/* ------------------------------------------------------------------ transport */

export class LiveError extends Error { constructor(public status: number, message: string) { super(message); } }

const MOCK_KEY = "live:mock";
export function mockAs(): "admin" | "client" | "crew" | null {
  if (!import.meta.env.DEV || typeof window === "undefined") return null;
  const q = new URLSearchParams(window.location.search).get("mock");
  try {
    if (q) sessionStorage.setItem(MOCK_KEY, q);
    const v = q ?? sessionStorage.getItem(MOCK_KEY);
    return v === "admin" || v === "client" || v === "crew" ? v : null;
  } catch { return q === "admin" || q === "client" || q === "crew" ? q : null; }
}

async function live<T>(method: string, path: string, body?: unknown): Promise<T> {
  const as = mockAs();
  if (as) return mock(as, method, path, body) as T;
  const r = await fetch(`/api/live${path}`, {
    method, credentials: "include", cache: "no-store",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json().catch(() => null);
  if (!r.ok) throw new LiveError(r.status, data?.message || "Something went wrong. Try again.");
  return data as T;
}

/* ------------------------------------------------------------------ hooks */

export function useProductions() {
  return useQuery<Production[], LiveError>({
    queryKey: ["/api/live/productions"],
    queryFn: async () => {
      const rows = await live<Production[]>("GET", "/productions");
      // Before Packet A's routes land, /api/live/productions falls through to the watch page's /api/live/:handle.
      if (!Array.isArray(rows)) throw new LiveError(404, "Not open yet.");
      return rows;
    },
    retry: false,
    staleTime: 30_000,
  });
}

export function useProduction(id: number | null) {
  return useQuery<Production & { stages: Stage[]; venues: Venue[] }, LiveError>({
    queryKey: ["/api/live/productions", id],
    queryFn: () => live("GET", `/productions/${id}`),
    enabled: !!id,
  });
}

export const useVenues = () => useQuery<Venue[], LiveError>({ queryKey: ["/api/live/venues"], queryFn: () => live("GET", "/venues") });
export const useMembers = (id: number | null) =>
  useQuery<Member[], LiveError>({ queryKey: ["/api/live/productions", id, "members"], queryFn: () => live("GET", `/productions/${id}/members`), enabled: !!id });
export const useApprovals = (id: number | null) =>
  useQuery<Approval[], LiveError>({ queryKey: ["/api/live/productions", id, "approvals"], queryFn: () => live("GET", `/productions/${id}/approvals`), enabled: !!id });
export const useAudit = (id: number | null, on = true) =>
  useQuery<AuditRow[], LiveError>({ queryKey: ["/api/live/productions", id, "audit"], queryFn: () => live("GET", `/productions/${id}/audit`), enabled: !!id && on });

/** One write; refreshes everything under /api/live afterwards. */
export function useLiveWrite<B, T = unknown>(method: "POST" | "PATCH", path: (b: B) => string) {
  const qc = useQueryClient();
  return useMutation<T, LiveError, B>({
    mutationFn: (b) => live<T>(method, path(b), b),
    onSuccess: () => qc.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith("/api/live") }),
  });
}

/* ------------------------------------------------------------------ dev mock (never in a production build) */

type Db = { productions: Production[]; venues: Venue[]; stages: Stage[]; members: Member[]; approvals: Approval[]; audit: AuditRow[]; seq: number };
let db: Db | null = null;
const now = () => new Date().toISOString();

function seed(): Db {
  const client: ClientOrg = { id: 501, name: "Test Client Org", slug: "test-client", logo_url: "", brand_color: "#1f4f8f" };
  const p: Production = {
    id: 1, name: "National Convention · Exhibit Hall Stage", status: "planning", starts_on: "2027-07-24", ends_on: "2027-07-27",
    timezone: "America/Chicago", scope: "One stage, three cameras, remote production, client approvals, post within 14 days.",
    event_id: null, client, my_role: null, stage_count: 1, member_count: 5,
  };
  const p2: Production = { ...p, id: 2, name: "Fall Leadership Summit", status: "scoping", starts_on: "2027-10-12", ends_on: "2027-10-13", client: { ...client, id: 502, name: "Second Test Org", slug: "second-test" }, stage_count: 0, member_count: 1 };
  const members: Member[] = [
    { id: 11, production_id: 1, email: "producer@militaryvoices.ai", name: "MV Producer", org_id: null, org_name: "MilitaryVoices.ai", role: "mv_producer", status: "active", invited_by: "", created_at: now() },
    { id: 12, production_id: 1, email: "hello+livecrew@militaryvoices.ai", name: "Test Crew Lead", org_id: 601, org_name: "Test AV Vendor", role: "crew_lead", status: "active", invited_by: "producer@militaryvoices.ai", created_at: now() },
    { id: 13, production_id: 1, email: "cam1@example.com", name: "Camera operator", org_id: 601, org_name: "Test AV Vendor", role: "crew_operator", status: "invited", invited_by: "hello+livecrew@militaryvoices.ai", created_at: now() },
    { id: 14, production_id: 1, email: "hello+liveclient@militaryvoices.ai", name: "Test Client Admin", org_id: 501, org_name: "Test Client Org", role: "client_admin", status: "active", invited_by: "producer@militaryvoices.ai", created_at: now() },
    { id: 15, production_id: 1, email: "reviewer@example.com", name: "Client reviewer", org_id: 501, org_name: "Test Client Org", role: "client_reviewer", status: "invited", invited_by: "hello+liveclient@militaryvoices.ai", created_at: now() },
    { id: 21, production_id: 2, email: "producer@militaryvoices.ai", name: "MV Producer", org_id: null, org_name: "MilitaryVoices.ai", role: "mv_producer", status: "active", invited_by: "", created_at: now() },
  ];
  return {
    productions: [p, p2],
    venues: [{ id: 31, name: "Convention Center", address: "", city: "Test City", state: "TX", timezone: "America/Chicago" }],
    stages: [{ id: 41, production_id: 1, venue_id: 31, name: "Exhibit Hall Stage", studio_id: null }],
    members, approvals: [], seq: 1000,
    audit: [{ id: 1, who: "producer@militaryvoices.ai", what: "Created the production", subject: "production 1", at: now() }],
  };
}

const MOCK_ME = { admin: "", client: "hello+liveclient@militaryvoices.ai", crew: "hello+livecrew@militaryvoices.ai" } as const;
export const mockEmail = (as: "admin" | "client" | "crew") => MOCK_ME[as] || "admin@militaryvoices.ai";

function mock(as: "admin" | "client" | "crew", method: string, path: string, body: any): unknown {
  db ??= seed();
  const d = db;
  const me = MOCK_ME[as];
  const roleOn = (pid: number): Role | null => (as === "admin" ? null : d.members.find((m) => m.production_id === pid && m.email === me && m.status !== "removed")?.role ?? null);
  const visible = (pid: number) => as === "admin" || !!roleOn(pid);
  const deny = () => { throw new LiveError(403, "You don't have access to that."); };
  const log = (what: string, subject: string) => d.audit.unshift({ id: ++d.seq, who: me || "admin@militaryvoices.ai", what, subject, at: now() });
  const row = (p: Production): Production => ({
    ...p, my_role: roleOn(p.id),
    stage_count: d.stages.filter((s) => s.production_id === p.id).length,
    member_count: d.members.filter((m) => m.production_id === p.id && m.status !== "removed").length,
  });
  const parts = path.split("/").filter(Boolean);

  if (parts[0] === "venues") {
    if (method === "GET") return d.venues;
    if (as !== "admin") deny();
    const v: Venue = { id: ++d.seq, name: String(body?.name ?? ""), address: body?.address ?? "", city: body?.city ?? "", state: body?.state ?? "", timezone: body?.timezone ?? "America/New_York" };
    d.venues.push(v); log(`Added venue ${v.name}`, `venue ${v.id}`); return v;
  }
  if (parts[0] === "approvals" && parts[2] === "decide") {
    const a = d.approvals.find((x) => x.id === Number(parts[1]));
    if (!a) throw new LiveError(404, "That approval is gone.");
    Object.assign(a, { state: body?.state, note: body?.note ?? "", decided_by: me, decided_at: now() });
    return a;
  }
  if (parts[0] !== "productions") throw new LiveError(404, "Not found.");
  if (parts.length === 1) {
    if (method === "GET") return d.productions.filter((p) => visible(p.id)).map(row);
    if (as !== "admin") deny();
    const p: Production = { id: ++d.seq, name: String(body?.name ?? "").trim(), status: "scoping", starts_on: body?.starts_on ?? "", ends_on: body?.ends_on ?? "", timezone: body?.timezone ?? "America/New_York", scope: body?.scope ?? "", event_id: null, client: body?.client_name ? { id: ++d.seq, name: body.client_name, slug: String(body.client_name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""), logo_url: "", brand_color: "#1f4f8f" } : null, my_role: null, stage_count: 0, member_count: 0 };
    d.productions.push(p); log("Created the production", `production ${p.id}`); return row(p);
  }
  const pid = Number(parts[1]);
  const p = d.productions.find((x) => x.id === pid);
  if (!p || !visible(pid)) throw new LiveError(404, "That production isn't here.");
  const r = as === "admin" ? "mv_admin" : roleOn(pid);
  const sub = parts[2];
  if (!sub) {
    if (method === "GET") {
      const stages = d.stages.filter((s) => s.production_id === pid);
      return { ...row(p), stages, venues: d.venues.filter((v) => stages.some((s) => s.venue_id === v.id)) };
    }
    if (!can.editProduction(r)) deny();
    const { name, status, starts_on, ends_on, timezone, scope } = body ?? {};
    Object.assign(p, Object.fromEntries(Object.entries({ name, status, starts_on, ends_on, timezone, scope }).filter(([, v]) => v !== undefined)));
    log("Edited the production", `production ${pid}`); return row(p);
  }
  if (sub === "stages") {
    if (method === "GET") return d.stages.filter((s) => s.production_id === pid);
    if (!can.editProduction(r)) deny();
    const s: Stage = { id: ++d.seq, production_id: pid, venue_id: body?.venue_id ?? null, name: String(body?.name ?? ""), studio_id: null };
    d.stages.push(s); log(`Added stage ${s.name}`, `stage ${s.id}`); return s;
  }
  if (sub === "members") {
    const mine = d.members.find((m) => m.production_id === pid && m.email === me);
    const scoped = (m: Member) => m.production_id === pid && m.status !== "removed" && (sideOf(r) === "mv" || m.org_id === mine?.org_id);
    if (method === "GET") return d.members.filter(scoped);
    const allowed = can.assignable(r);
    if (method === "POST") {
      if (!allowed.includes(body?.role)) deny();
      const email = String(body?.email ?? "").trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new LiveError(400, "That email doesn't look right.");
      if (d.members.some((m) => m.production_id === pid && m.email === email && m.status !== "removed")) throw new LiveError(409, "They're already on this production.");
      const orgName = sideOf(r) === "mv" ? String(body?.org_name ?? "").trim() : mine?.org_name ?? "";
      const orgId = sideOf(r) === "mv" ? (orgName ? d.members.find((m) => m.org_name === orgName)?.org_id ?? ++d.seq : null) : mine?.org_id ?? null;
      const m: Member = { id: ++d.seq, production_id: pid, email, name: String(body?.name ?? "").trim(), org_id: orgId, org_name: orgName || "MilitaryVoices.ai", role: body.role, status: "invited", invited_by: me || "admin@militaryvoices.ai", created_at: now() };
      d.members.push(m); log(`Saved an invite for ${email} as ${ROLE_LABEL[m.role]}`, `member ${m.id}`); return m;
    }
    const m = d.members.find((x) => x.id === Number(parts[3]));
    if (!m || !scoped(m)) throw new LiveError(404, "They're not on this production.");
    if ((body?.role && !allowed.includes(body.role)) || !allowed.includes(m.role)) deny();
    Object.assign(m, body?.role ? { role: body.role } : {}, body?.status ? { status: body.status } : {});
    log(body?.status === "removed" ? `Removed ${m.email}` : `Changed ${m.email} to ${ROLE_LABEL[m.role]}`, `member ${m.id}`); return m;
  }
  if (sub === "approvals") return d.approvals.filter((a) => a.id && sideOf(r) !== "crew");
  if (sub === "audit") { if (sideOf(r) !== "mv") deny(); return d.audit.slice(0, 50); }
  throw new LiveError(404, "Not found.");
}
