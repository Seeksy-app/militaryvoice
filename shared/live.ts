/**
 * Military Voices LIVE, phase 1 API contract (Packet A, Podcasting, 26 Nov 2026). FROZEN: UI/UX builds against
 * these shapes. Add fields only; never rename or remove one without telling UI/UX first.
 *
 * Every route is under /api/production/*, signed in with the ordinary emailed-code session (clients and crew too).
 * Access comes only from production_members, never admin_users; a platform admin (admin session) passes everywhere
 * except approving (the client approves content, and nobody approves their own change).
 * While the setting live:on is off, only platform admins (and the two test logins below) get past the gate (403).
 *
 * Errors are always { message } with 400 (bad input), 401 (not signed in), 403 (not your role / gate off),
 * 404 (no such thing, or not one you can see: we never say which), 409 (conflict, e.g. already a member).
 */

/** Roles, held per production. mv_admin is never stored: it's what a platform admin is on every production. */
export const LIVE_ROLES = ["mv_admin", "mv_producer", "mv_coordinator", "mv_editor", "crew_lead", "crew_operator", "client_admin", "client_reviewer", "client_viewer"] as const;
export type LiveRole = (typeof LIVE_ROLES)[number];
/** The roles a production_members row can hold. */
export const MEMBER_ROLES = LIVE_ROLES.filter((r) => r !== "mv_admin") as Exclude<LiveRole, "mv_admin">[];
export const MV_ROLES: LiveRole[] = ["mv_admin", "mv_producer", "mv_coordinator", "mv_editor"];
export const CREW_ROLES: LiveRole[] = ["crew_lead", "crew_operator"];
export const CLIENT_ROLES: LiveRole[] = ["client_admin", "client_reviewer", "client_viewer"];
/** Plain-word names for screens. */
export const ROLE_LABEL: Record<LiveRole, string> = {
  mv_admin: "MV Admin", mv_producer: "MV Producer", mv_coordinator: "MV Coordinator", mv_editor: "MV Editor",
  crew_lead: "Crew Lead", crew_operator: "Crew Operator", client_admin: "Client Admin", client_reviewer: "Client Reviewer", client_viewer: "Client Viewer",
};

export const PRODUCTION_STATUSES = ["scoping", "planning", "rehearsal", "live", "post", "delivered", "closed"] as const;
export type ProductionStatus = (typeof PRODUCTION_STATUSES)[number];
export const MEMBER_STATUSES = ["invited", "active", "removed"] as const;
export type MemberStatus = (typeof MEMBER_STATUSES)[number];
export const APPROVAL_STATES = ["pending", "approved", "changes_requested", "withdrawn"] as const;
export type ApprovalState = (typeof APPROVAL_STATES)[number];

/** The parties a production touches (organizations.kind gains client and vendor). */
export type LiveOrg = { id: number; name: string; kind: "client" | "vendor" | string; logoUrl: string;
  /** For the client portal at /live/<slug>: made from the name, unique among LIVE orgs (a clash gets -<id>). */
  slug: string;
  /** The portal's accent, "#rrggbb"; "" means use the MV look. Set with PATCH /api/production/orgs/:id or newOrg. */
  brandColor: string };
/** GET /api/production/orgs?kind=client|vendor → LiveOrg[] (MV roles and admins). Create one with newOrg on a production or member POST.
 *  PATCH /api/production/orgs/:id { logoUrl?, brandColor? } → LiveOrg (MV roles and admins; logoUrl https:// or ""). */

/** GET /api/production/productions → Production[] (the ones I can see, newest first). GET /api/production/productions/:id → Production. */
export type Production = {
  id: number;
  name: string;
  status: ProductionStatus;
  /** The client organisation (organizations row, kind client). */
  org: LiveOrg | null;
  startsOn: string; // YYYY-MM-DD, "" when not set
  endsOn: string;
  timezone: string; // IANA, e.g. "America/New_York"
  scope: string; // plain text
  eventId: number | null; // optional public event page
  createdAt: string; // ISO
  updatedAt: string;
  /** My role on it (mv_admin for platform admins). */
  myRole: LiveRole;
  stageCount: number;
  memberCount: number; // active + invited
  /** What my role may do here, so screens hide what isn't mine (the server still checks every call). */
  can: ProductionCan;
};
export type ProductionCan = {
  edit: boolean; // PATCH the production
  invite: boolean; // add members (client_admin: client roles in own org; crew_lead: crew_operator in own org)
  stages: boolean; // add stages / venues
  audit: boolean; // read the audit log
  approve: boolean; // decide approvals addressed to my role
};

/** POST /api/production/productions (platform admins only in phase 1) and PATCH /api/production/productions/:id: any subset. */
export type ProductionInput = {
  name?: string; // 2–120 chars, required on create
  status?: ProductionStatus;
  orgId?: number | null; // a client org; or newOrg to make one
  newOrg?: { name: string; logoUrl?: string; brandColor?: string };
  startsOn?: string;
  endsOn?: string;
  timezone?: string;
  scope?: string; // up to 4000 chars
  eventId?: number | null;
};

/** GET /api/production/productions/:id/members → Member[]. MV roles see everyone; crew_lead and client_admin see their own org; others see themselves. */
export type Member = {
  id: number;
  productionId: number;
  email: string;
  name: string; // "" until we know it
  org: LiveOrg | null; // the client or vendor org they're with; null for MV staff
  role: Exclude<LiveRole, "mv_admin">;
  status: MemberStatus;
  invitedBy: string;
  createdAt: string;
  /** Invites are stored only in phase 1: no email goes out. Always false until invites are switched on. */
  inviteSent: boolean;
};
/** POST /api/production/productions/:id/members → Member (201). 409 when that email is already on the production. */
export type MemberInput = { email: string; name?: string; role: Exclude<LiveRole, "mv_admin">; orgId?: number | null; newOrg?: { name: string; kind: "client" | "vendor" } };
/** PATCH /api/production/productions/:id/members/:memberId → Member. Nobody changes their own row. */
export type MemberPatch = { role?: Exclude<LiveRole, "mv_admin">; status?: "active" | "removed"; name?: string };

/** GET/POST /api/production/venues → Venue[] / Venue. Venues are shared across productions (MV roles and admins). */
export type Venue = { id: number; name: string; address: string; timezone: string; power: string; network: string; createdAt: string };
export type VenueInput = { name: string; address?: string; timezone?: string; power?: string; network?: string };

/** GET/POST /api/production/productions/:id/stages → Stage[] / Stage. Each stage runs in one existing studio. */
export type Stage = { id: number; productionId: number; name: string; venue: Pick<Venue, "id" | "name"> | null; studioId: number | null; ingestProfile: string; createdAt: string };
export type StageInput = { name: string; venueId?: number | null; studioId?: number | null; ingestProfile?: string };

/** GET /api/production/productions/:id/approvals → Approval[] (MV and client roles; crew see none). */
export type Approval = {
  id: number;
  productionId: number;
  subjectType: string; // "run_of_show" | "asset" | "script" | "speaker" | ... (later phases)
  subjectId: number;
  version: number;
  summary: string; // one line for the list
  requestedBy: string;
  approverRole: LiveRole; // who decides it (client_admin or client_reviewer)
  state: ApprovalState;
  decidedBy: string;
  decidedAt: string;
  note: string;
  createdAt: string;
  /** True when I can decide it now (my role matches, it's pending, and I didn't ask for it). */
  mine: boolean;
};
/** Client content: only the client decides these (a platform admin can't). Any other subject type (e.g. "go_no_go")
 *  is decided by the role it's addressed to, MV ones included; a platform admin may decide those. Nobody decides their own. */
export const CLIENT_CONTENT_SUBJECTS = ["run_of_show", "session", "speaker", "script", "asset"] as const;
/** POST /api/production/approvals/:id/decide → Approval. Only from pending. */
export type ApprovalDecision = { decision: "approved" | "changes_requested"; note?: string };

/** GET /api/production/productions/:id/audit → AuditEntry[] (newest first, 200 max; ?before=<id> for more). MV Admin, Producer, Coordinator. */
export type AuditEntry = { id: number; productionId: number | null; who: string; what: string; subjectType: string; subjectId: number | null; before: unknown; after: unknown; at: string };

/** GET /api/production/me → who I am in LIVE: whether the gate lets me in, and my productions count. */
export type LiveMe = { email: string; admin: boolean; open: boolean; productions: number };

/** The two test logins (phase 1 "done when"): each must see only its own production. */
export const LIVE_TEST_CLIENT = "hello+liveclient@militaryvoices.ai";
export const LIVE_TEST_CREW = "hello+livecrew@militaryvoices.ai";
