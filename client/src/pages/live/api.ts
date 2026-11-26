import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CLIENT_ROLES, CREW_ROLES, LIVE_TEST_CLIENT, LIVE_TEST_CREW, MV_ROLES, PRODUCTION_STATUSES, ROLE_LABEL,
  type Approval, type ApprovalDecision, type AuditEntry, type LiveMe, type LiveOrg, type LiveRole, type Member, type MemberInput,
  type MemberPatch, type Production, type ProductionInput, type ProductionStatus, type Stage, type StageInput, type Venue, type VenueInput,
} from "@shared/live";

/**
 * Military Voices LIVE, phase 1 screens (Packet C) on Packet A's contract, shared/live.ts (frozen, add-only), under
 * /api/production/*. Production.can says what my role may do here; the server checks every call anyway.
 *
 * Mock: in local dev only, ?mock=client|crew|admin (remembered for the tab) answers every call from memory, so nothing
 * touches the live database and no invite can go out. Production builds never mock.
 */

export type Role = LiveRole;
export type MemberRole = Exclude<LiveRole, "mv_admin">;
export type { Approval, AuditEntry, LiveMe, LiveOrg, Member, Production, Stage, Venue };
export { CLIENT_ROLES, CREW_ROLES, MV_ROLES, ROLE_LABEL };
export type Status = ProductionStatus;
export const STATUSES = PRODUCTION_STATUSES;
export const STATUS_LABEL: Record<Status, string> = {
  scoping: "Scoping", planning: "Planning", rehearsal: "Rehearsal", live: "Show days", post: "Post", delivered: "Delivered", closed: "Closed",
};

export type Side = "mv" | "crew" | "client";
export const sideOf = (r: Role | null | undefined): Side => (!r || r.startsWith("mv_") ? "mv" : r.startsWith("crew_") ? "crew" : "client");

/** Roles this person may give on a production (from can.invite and their role, as the routes table says). */
export function assignable(p: Production | null | undefined): MemberRole[] {
  if (!p?.can.invite) return [];
  if (p.myRole === "mv_admin" || p.myRole === "mv_coordinator") return [...MV_ROLES, ...CREW_ROLES, ...CLIENT_ROLES].filter((r): r is MemberRole => r !== "mv_admin");
  if (p.myRole === "crew_lead") return ["crew_operator"];
  if (p.myRole === "client_admin") return ["client_reviewer", "client_viewer"];
  return [];
}

/* ------------------------------------------------------------------ transport */

export class LiveError extends Error { constructor(public status: number, message: string) { super(message); } }

const MOCK_KEY = "live:mock";
type As = "admin" | "client" | "crew";
export function mockAs(): As | null {
  if (!import.meta.env.DEV || typeof window === "undefined") return null;
  const ok = (v: string | null): v is As => v === "admin" || v === "client" || v === "crew";
  const q = new URLSearchParams(window.location.search).get("mock");
  try {
    if (q) sessionStorage.setItem(MOCK_KEY, q);
    const v = q ?? sessionStorage.getItem(MOCK_KEY);
    return ok(v) ? v : null;
  } catch { return ok(q) ? q : null; }
}

async function live<T>(method: string, path: string, body?: unknown): Promise<T> {
  const as = mockAs();
  if (as && MOCK) return MOCK(as, method, path, body) as T;
  const r = await fetch(`/api/production${path}`, {
    method, credentials: "include", cache: "no-store",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json().catch(() => null);
  if (!r.ok) throw new LiveError(r.status, data?.message || "Something went wrong. Try again.");
  return data as T;
}

/* ------------------------------------------------------------------ hooks */

const K = "/api/production";
export const useMe = () => useQuery<LiveMe, LiveError>({ queryKey: [K, "me"], queryFn: () => live("GET", "/me"), retry: false, staleTime: 30_000 });
export const useProductions = (on: boolean) =>
  useQuery<Production[], LiveError>({ queryKey: [K, "productions"], queryFn: () => live("GET", "/productions"), enabled: on, retry: false, staleTime: 30_000 });
export const useProduction = (id: number | null) =>
  useQuery<Production, LiveError>({ queryKey: [K, "productions", id], queryFn: () => live("GET", `/productions/${id}`), enabled: !!id, retry: false });
export const useStages = (id: number | null) =>
  useQuery<Stage[], LiveError>({ queryKey: [K, "productions", id, "stages"], queryFn: () => live("GET", `/productions/${id}/stages`), enabled: !!id });
export const useMembers = (id: number | null) =>
  useQuery<Member[], LiveError>({ queryKey: [K, "productions", id, "members"], queryFn: () => live("GET", `/productions/${id}/members`), enabled: !!id });
/** MV and client roles only (crew see none), so callers pass null for crew. */
export const useApprovals = (id: number | null) =>
  useQuery<Approval[], LiveError>({ queryKey: [K, "productions", id, "approvals"], queryFn: () => live("GET", `/productions/${id}/approvals`), enabled: !!id });
export const useAudit = (id: number | null) =>
  useQuery<AuditEntry[], LiveError>({ queryKey: [K, "productions", id, "audit"], queryFn: () => live("GET", `/productions/${id}/audit`), enabled: !!id });
/** MV roles and admins only. */
export const useVenues = (on: boolean) => useQuery<Venue[], LiveError>({ queryKey: [K, "venues"], queryFn: () => live("GET", "/venues"), enabled: on });
export const useOrgs = (kind: "client" | "vendor", on: boolean) =>
  useQuery<LiveOrg[], LiveError>({ queryKey: [K, "orgs", kind], queryFn: () => live("GET", `/orgs?kind=${kind}`), enabled: on });

/** One write; refreshes everything under /api/production afterwards. */
function useWrite<B, T>(method: "POST" | "PATCH", path: (b: B) => string, send: (b: B) => unknown = (b) => b) {
  const qc = useQueryClient();
  return useMutation<T, LiveError, B>({
    mutationFn: (b) => live<T>(method, path(b), send(b)),
    onSuccess: () => qc.invalidateQueries({ queryKey: [K] }),
  });
}
export const useCreateProduction = () => useWrite<ProductionInput, Production>("POST", () => "/productions");
export const usePatchProduction = (id: number) => useWrite<ProductionInput, Production>("PATCH", () => `/productions/${id}`);
export const useAddStage = (id: number) => useWrite<StageInput, Stage>("POST", () => `/productions/${id}/stages`);
export const useAddVenue = () => useWrite<VenueInput, Venue>("POST", () => "/venues");
export const useInvite = (id: number) => useWrite<MemberInput, Member>("POST", () => `/productions/${id}/members`);
export const usePatchMember = (id: number, memberId: number) => useWrite<MemberPatch, Member>("PATCH", () => `/productions/${id}/members/${memberId}`);
export const useDecide = () =>
  useWrite<ApprovalDecision & { id: number }, Approval>("POST", (b) => `/approvals/${b.id}/decide`, ({ decision, note }) => ({ decision, note }));

/* ------------------------------------------------------------------ dev mock (never in a production build) */

type Db = { productions: Omit<Production, "myRole" | "can" | "stageCount" | "memberCount">[]; orgs: LiveOrg[]; venues: Venue[]; stages: Stage[]; members: Member[]; approvals: Approval[]; audit: AuditEntry[]; seq: number };
let db: Db | null = null;
const now = () => new Date().toISOString();
const ME: Record<As, string> = { admin: "admin@militaryvoices.ai", client: LIVE_TEST_CLIENT, crew: LIVE_TEST_CREW };

function seed(): Db {
  const client: LiveOrg = { id: 501, name: "Test Client Org", kind: "client", logoUrl: "", slug: "test-client" };
  const client2: LiveOrg = { id: 502, name: "Second Test Org", kind: "client", logoUrl: "", slug: "second-test" };
  const vendor: LiveOrg = { id: 601, name: "Test AV Vendor", kind: "vendor", logoUrl: "", slug: "test-av-vendor" };
  const base = { timezone: "America/Chicago", eventId: null, createdAt: now(), updatedAt: now() };
  const m = (id: number, productionId: number, email: string, name: string, org: LiveOrg | null, role: MemberRole, status: Member["status"], invitedBy = "producer@militaryvoices.ai"): Member =>
    ({ id, productionId, email, name, org, role, status, invitedBy, createdAt: now(), inviteSent: false });
  return {
    productions: [
      { ...base, id: 1, name: "National Convention · Exhibit Hall Stage", status: "planning", org: client, startsOn: "2027-07-24", endsOn: "2027-07-27", scope: "One stage, three cameras, remote production, client approvals, post within 14 days." },
      { ...base, id: 2, name: "Fall Leadership Summit", status: "scoping", org: client2, startsOn: "2027-10-12", endsOn: "2027-10-13", scope: "" },
    ],
    orgs: [client, client2, vendor],
    venues: [{ id: 31, name: "Convention Center", address: "Test City, TX", timezone: "America/Chicago", power: "", network: "", createdAt: now() }],
    stages: [{ id: 41, productionId: 1, name: "Exhibit Hall Stage", venue: { id: 31, name: "Convention Center" }, studioId: null, ingestProfile: "", createdAt: now() }],
    members: [
      m(11, 1, "producer@militaryvoices.ai", "MV Producer", null, "mv_producer", "active", ""),
      m(12, 1, LIVE_TEST_CREW, "Test Crew Lead", vendor, "crew_lead", "active"),
      m(13, 1, "cam1@example.com", "Camera operator", vendor, "crew_operator", "invited", LIVE_TEST_CREW),
      m(14, 1, LIVE_TEST_CLIENT, "Test Client Admin", client, "client_admin", "active"),
      m(15, 1, "reviewer@example.com", "Client reviewer", client, "client_reviewer", "invited", LIVE_TEST_CLIENT),
      m(21, 2, "producer@militaryvoices.ai", "MV Producer", null, "mv_producer", "active", ""),
    ],
    approvals: [], seq: 1000,
    audit: [{ id: 1, productionId: 1, who: "producer@militaryvoices.ai", what: "Created the production", subjectType: "production", subjectId: 1, before: null, after: null, at: now() }],
  };
}

function mock(as: As, method: string, path: string, body: any): unknown {
  db ??= seed();
  const d = db;
  const me = ME[as];
  const nf = () => { throw new LiveError(404, "That isn't here."); };
  const deny = () => { throw new LiveError(403, "You don't have access to that."); };
  const mine = (pid: number) => d.members.find((x) => x.productionId === pid && x.email === me && x.status !== "removed");
  const roleOn = (pid: number): Role | null => (as === "admin" ? "mv_admin" : mine(pid)?.role ?? null);
  const log = (pid: number | null, what: string, subjectType: string, subjectId: number) => d.audit.unshift({ id: ++d.seq, productionId: pid, who: me, what, subjectType, subjectId, before: null, after: null, at: now() });
  const view = (p: Db["productions"][number]): Production => {
    const r = roleOn(p.id)!;
    const mvEdit = r === "mv_admin" || r === "mv_producer" || r === "mv_coordinator";
    return {
      ...p, myRole: r,
      stageCount: d.stages.filter((s) => s.productionId === p.id).length,
      memberCount: d.members.filter((x) => x.productionId === p.id && x.status !== "removed").length,
      can: { edit: mvEdit, invite: r === "mv_admin" || r === "mv_coordinator" || r === "crew_lead" || r === "client_admin", stages: mvEdit, audit: mvEdit, approve: r === "client_admin" || r === "client_reviewer" },
    };
  };
  const [rawPath, qs] = path.split("?");
  const parts = rawPath.split("/").filter(Boolean);
  const anyMv = as === "admin" || d.members.some((x) => x.email === me && sideOf(x.role) === "mv");

  if (parts[0] === "me") return { email: me, admin: as === "admin", open: true, productions: d.productions.filter((p) => roleOn(p.id)).length } satisfies LiveMe;
  if (parts[0] === "orgs") { if (!anyMv) deny(); const kind = new URLSearchParams(qs).get("kind"); return d.orgs.filter((o) => !kind || o.kind === kind); }
  if (parts[0] === "venues") {
    if (!anyMv) deny();
    if (method === "GET") return d.venues;
    const v: Venue = { id: ++d.seq, name: String(body?.name ?? "").trim(), address: body?.address ?? "", timezone: body?.timezone ?? "America/New_York", power: "", network: "", createdAt: now() };
    d.venues.push(v); log(null, `Added venue ${v.name}`, "venue", v.id); return v;
  }
  if (parts[0] === "approvals") {
    const a = d.approvals.find((x) => x.id === Number(parts[1])) ?? nf()!;
    if (!a.mine) deny();
    Object.assign(a, { state: body?.decision, note: body?.note ?? "", decidedBy: me, decidedAt: now(), mine: false });
    return a;
  }
  if (parts[0] !== "productions") nf();
  if (parts.length === 1) {
    if (method === "GET") return d.productions.filter((p) => roleOn(p.id)).map(view);
    if (as !== "admin") deny();
    let org: LiveOrg | null = d.orgs.find((o) => o.id === body?.orgId) ?? null;
    if (body?.newOrg?.name) { org = { id: ++d.seq, name: body.newOrg.name, kind: "client", logoUrl: "", slug: slugify(body.newOrg.name) }; d.orgs.push(org); }
    const p = { id: ++d.seq, name: String(body?.name ?? "").trim(), status: "scoping" as Status, org, startsOn: body?.startsOn ?? "", endsOn: body?.endsOn ?? "", timezone: body?.timezone ?? "America/New_York", scope: body?.scope ?? "", eventId: null, createdAt: now(), updatedAt: now() };
    d.productions.unshift(p); log(p.id, "Created the production", "production", p.id); return view(p);
  }
  const pid = Number(parts[1]);
  const p = d.productions.find((x) => x.id === pid);
  if (!p || !roleOn(pid)) nf();
  const v = view(p!);
  const sub = parts[2];
  if (!sub) {
    if (method === "GET") return v;
    if (!v.can.edit) deny();
    const { name, status, startsOn, endsOn, timezone, scope } = body ?? {};
    Object.assign(p!, Object.fromEntries(Object.entries({ name, status, startsOn, endsOn, timezone, scope }).filter(([, x]) => x !== undefined)), { updatedAt: now() });
    log(pid, "Edited the production", "production", pid); return view(p!);
  }
  if (sub === "stages") {
    if (method === "GET") return d.stages.filter((s) => s.productionId === pid);
    if (!v.can.stages) deny();
    const venue = d.venues.find((x) => x.id === body?.venueId);
    const s: Stage = { id: ++d.seq, productionId: pid, name: String(body?.name ?? "").trim(), venue: venue ? { id: venue.id, name: venue.name } : null, studioId: null, ingestProfile: "", createdAt: now() };
    d.stages.push(s); log(pid, `Added stage ${s.name}`, "stage", s.id); return s;
  }
  if (sub === "members") {
    const self = mine(pid);
    const side = sideOf(v.myRole);
    const seen = (x: Member) => x.productionId === pid && x.status !== "removed" && (side === "mv" || ((v.myRole === "crew_lead" || v.myRole === "client_admin") ? x.org?.id === self?.org?.id : x.email === me));
    if (method === "GET") return d.members.filter(seen);
    const allowed = assignable(v);
    if (method === "POST") {
      if (!allowed.includes(body?.role)) deny();
      const email = String(body?.email ?? "").trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new LiveError(400, "That email doesn't look right.");
      if (d.members.some((x) => x.productionId === pid && x.email === email && x.status !== "removed")) throw new LiveError(409, "They're already on this production.");
      let org: LiveOrg | null = side === "mv" ? d.orgs.find((o) => o.id === body?.orgId) ?? null : self?.org ?? null;
      if (side === "mv" && body?.newOrg?.name) { org = { id: ++d.seq, name: body.newOrg.name, kind: body.newOrg.kind, logoUrl: "", slug: slugify(body.newOrg.name) }; d.orgs.push(org); }
      if (sideOf(body.role) === "mv") org = null;
      const nm: Member = { id: ++d.seq, productionId: pid, email, name: String(body?.name ?? "").trim(), org, role: body.role, status: "invited", invitedBy: me, createdAt: now(), inviteSent: false };
      d.members.push(nm); log(pid, `Saved an invite for ${email} as ${ROLE_LABEL[nm.role]}`, "member", nm.id); return nm;
    }
    const x = d.members.find((y) => y.id === Number(parts[3]));
    if (!x || !seen(x)) nf();
    if (x!.email === me || !allowed.includes(x!.role) || (body?.role && !allowed.includes(body.role))) deny();
    Object.assign(x!, body?.role ? { role: body.role } : {}, body?.status ? { status: body.status } : {});
    log(pid, body?.status === "removed" ? `Removed ${x!.email}` : `Changed ${x!.email} to ${ROLE_LABEL[x!.role]}`, "member", x!.id); return x;
  }
  if (sub === "approvals") { if (sideOf(v.myRole) === "crew") deny(); return d.approvals.filter((a) => a.productionId === pid); }
  if (sub === "audit") { if (!v.can.audit) deny(); return d.audit.filter((a) => a.productionId === pid || a.productionId === null).slice(0, 200); }
  return nf();
}

const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** Only a dev build keeps the mock; a production build drops it and its sample rows. */
const MOCK = import.meta.env.DEV ? mock : null;
