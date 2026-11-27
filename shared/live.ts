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
export const LIVE_ROLES = ["mv_admin", "mv_producer", "mv_coordinator", "mv_editor", "crew_lead", "crew_operator", "client_admin", "client_reviewer", "client_viewer", "alex"] as const;
export type LiveRole = (typeof LIVE_ROLES)[number];
/** The roles a production_members row can hold (alex included: her row is made with the production). */
export const MEMBER_ROLES = LIVE_ROLES.filter((r) => r !== "mv_admin") as Exclude<LiveRole, "mv_admin">[];
/** The roles a person can be invited to: every member role but Alex's. Use this for role pickers. */
export const INVITABLE_ROLES = MEMBER_ROLES.filter((r) => r !== "alex") as Exclude<LiveRole, "mv_admin" | "alex">[];
export const MV_ROLES: LiveRole[] = ["mv_admin", "mv_producer", "mv_coordinator", "mv_editor"];
export const CREW_ROLES: LiveRole[] = ["crew_lead", "crew_operator"];
export const CLIENT_ROLES: LiveRole[] = ["client_admin", "client_reviewer", "client_viewer"];
/** Plain-word names for screens. */
export const ROLE_LABEL: Record<LiveRole, string> = {
  mv_admin: "MV Admin", mv_producer: "MV Producer", mv_coordinator: "MV Coordinator", mv_editor: "MV Editor",
  crew_lead: "Crew Lead", crew_operator: "Crew Operator", client_admin: "Client Admin", client_reviewer: "Client Reviewer", client_viewer: "Client Viewer",
  alex: "Alex (AI)",
};

/**
 * Alex, the AI team member (Andrew, 26 Nov: "Alex AI is just part of the team and responsible for certain parts").
 * Every production gets her row when it's made, active, with her jobs on it. She never signs in, never decides an
 * approval and never invites anyone. MV Admin and MV Coordinator can change her jobs or take her off (status removed)
 * and back on. What she does is audited with actor "alex" and the ai_actions row behind it.
 */
export const ALEX_EMAIL = "alex@militaryvoices.ai";
export const ALEX_NAME = "Alex";
export const ALEX_JOBS = ["run_of_show", "emails", "confirmations", "intros", "media", "headshots"] as const;
export type AlexJob = (typeof ALEX_JOBS)[number];
export const ALEX_JOB_LABEL: Record<AlexJob, string> = {
  run_of_show: "Run of show", emails: "Emails", confirmations: "Confirmations and reminders",
  intros: "Intros and voiceovers", media: "Guest and host media", headshots: "Headshots and bios",
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
  /** True for Alex's row (role "alex"): no role picker, no remove for anyone but MV Admin and Coordinator. Always sent. */
  ai?: boolean;
  /** Alex's jobs (keys of ALEX_JOB_LABEL); [] for people. Always sent. */
  jobs?: AlexJob[];
};
/** POST /api/production/productions/:id/members → Member (201). 409 when that email is already on the production. */
/** role "alex" is refused (403): Alex comes with the production. */
export type MemberInput = { email: string; name?: string; role: Exclude<LiveRole, "mv_admin">; orgId?: number | null; newOrg?: { name: string; kind: "client" | "vendor" } };
/** PATCH /api/production/productions/:id/members/:memberId → Member. Nobody changes their own row. */
export type MemberPatch = { role?: Exclude<LiveRole, "mv_admin">; status?: "active" | "removed"; name?: string;
  /** Alex's row only (MV Admin, MV Coordinator): her jobs. Her role and name don't change. */
  jobs?: AlexJob[] };

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
export type AuditEntry = { id: number; productionId: number | null; who: string; what: string; subjectType: string; subjectId: number | null; before: unknown; after: unknown; at: string;
  /** "person" (who is their email), "alex" (who is ALEX_EMAIL; aiActionId says which ai_actions row), or "script" (our own scripts with the admin key). */
  actor?: "person" | "alex" | "script"; // always sent
  aiActionId?: number | null };

/** GET /api/production/me → who I am in LIVE: whether the gate lets me in, and my productions count. */
export type LiveMe = { email: string; admin: boolean; open: boolean; productions: number };

/** The two test logins (phase 1 "done when"): each must see only its own production. */
export const LIVE_TEST_CLIENT = "hello+liveclient@militaryvoices.ai";
export const LIVE_TEST_CREW = "hello+livecrew@militaryvoices.ai";

/* ══ Phase 2: Programme (Packet A, Podcasting, 27 Nov 2026) ═════════════════════════════════════════════════════
 * Run of show, speakers, scripts, sponsors and message templates. FROZEN like phase 1: add fields only.
 * Tables are live_sessions, live_speakers, live_session_people, live_scripts, live_sponsors, live_templates (the
 * live_ prefix because "sponsors" is already the show-sponsor table); every one carries production_id.
 *
 * Who may do what:
 *  - Read the run of show: every member (crew and clients too). Clients and crew never see mvOnly sessions, Alex's
 *    drafts (scripts in state "draft"), or speakers' email and phone.
 *  - Change sessions, speakers, sponsors and scripts: MV Admin, Producer, Coordinator (and MV Editor for scripts).
 *  - Templates: MV roles read and draft; Client Admin reads its own org's. Approving is phase 2's approvals.
 * Any change to an approved run of show raises its version and sets it to "changes_pending"; the stage studio's
 * console keeps the last approved version until the client approves again.
 */

export const SESSION_KINDS = ["keynote", "panel", "fireside", "interview", "performance", "presentation", "ceremony", "break", "other"] as const;
export type SessionKind = (typeof SESSION_KINDS)[number];
export const SESSION_KIND_LABEL: Record<SessionKind, string> = {
  keynote: "Keynote", panel: "Panel", fireside: "Fireside chat", interview: "Interview", performance: "Performance",
  presentation: "Presentation", ceremony: "Ceremony", break: "Break", other: "Other",
};
/** draft → confirmed; cancelled stays listed (struck through) until it's removed. removed rows are never returned. */
export const SESSION_STATUSES = ["draft", "confirmed", "cancelled"] as const;
export type SessionStatus = (typeof SESSION_STATUSES)[number];
export const SESSION_PERSON_ROLES = ["speaker", "moderator", "host", "performer"] as const;
export type SessionPersonRole = (typeof SESSION_PERSON_ROLES)[number];

/** One person on stage. Speakers belong to the production's client org. */
export type Speaker = {
  id: number;
  productionId: number;
  name: string;
  title: string; // job title, "" when unknown
  company: string; // their organisation, as words ("" when unknown)
  bio: string; // plain text
  photoUrl: string; // headshot, "" until there is one
  cutoutUrl: string; // headshot with the background removed, "" until made
  links: { label: string; url: string }[];
  pronunciationText: string; // e.g. "SHEH-vawn MAK-ee"; "" when not needed or unknown
  pronunciationAudioUrl: string;
  /** MV roles (and the client's Client Admin) only; "" for everyone else. */
  email: string;
  phone: string;
  /** Raised by every change; an approved bio is for one version. */
  version: number;
  /** The speaker's own approval state: "none" until sent, then the latest approval's state. */
  approval: "none" | ApprovalState;
  /** True when this speaker changed after its last approval. */
  changedSinceApproval: boolean;
  /** Sessions they're on (ids). */
  sessionIds: number[];
  createdAt: string;
  updatedAt: string;
};
/** POST /api/production/productions/:id/speakers → Speaker (201); PATCH .../speakers/:speakerId → Speaker (any subset). */
export type SpeakerInput = {
  name?: string; // required on create, 2–120
  title?: string; company?: string; bio?: string; // bio up to 4000
  photoUrl?: string; cutoutUrl?: string; // https:// or ""
  links?: { label: string; url: string }[]; // up to 10
  pronunciationText?: string; pronunciationAudioUrl?: string;
  email?: string; phone?: string;
};
/** GET /api/production/productions/:id/speakers → Speaker[] (by name). DELETE .../speakers/:speakerId → { ok: true }
 *  (only when they're on no session; 409 otherwise). */

/** Who's on a session, in order. */
export type SessionPerson = { speakerId: number; name: string; role: SessionPersonRole; photoUrl: string; cutoutUrl: string };

export type ScriptKind = "intro" | "transition" | "sponsor_read" | "outro";
export const SCRIPT_KINDS: ScriptKind[] = ["intro", "transition", "sponsor_read", "outro"];
/** draft (Alex's or a person's, not yet sent) → in_review (with the client) → approved | changes_requested. */
export type ScriptState = "draft" | "in_review" | "approved" | "changes_requested";
export type Script = {
  id: number;
  productionId: number;
  sessionId: number;
  kind: ScriptKind;
  sponsorId: number | null; // for a sponsor read
  text: string;
  /** Alex's voice for an approved script (only while live:voice is on); "" otherwise. Any text change clears it. */
  audioUrl: string;
  version: number;
  state: ScriptState;
  /** "alex" when she drafted it, else the person's email. */
  draftedBy: string;
  createdAt: string;
  updatedAt: string;
};
/** GET /api/production/productions/:id/scripts?sessionId= → Script[]. POST .../scripts { sessionId, kind, text, sponsorId? } → Script (201).
 *  PATCH .../scripts/:scriptId { text } → Script (a new version: back to draft, audio cleared). MV roles and MV Editor. */

/** One row of a stage's day. Times are ISO UTC; screens show them in the production's time zone. */
export type Session = {
  id: number;
  productionId: number;
  stageId: number;
  startsAt: string;
  endsAt: string;
  /** Whole minutes, ends minus starts, rounded up. */
  durationMinutes: number;
  title: string;
  kind: SessionKind;
  status: SessionStatus;
  /** Order among sessions that start at the same time. */
  sort: number;
  /** For MV and crew only (e.g. a changeover); clients never see it, and it never goes for approval. */
  mvOnly: boolean;
  notes: string; // MV notes, plain text; "" for clients
  people: SessionPerson[];
  /** Scripts on this session (clients and crew: in_review and approved only). */
  scripts: Script[];
  /** Raised by every change to the session or who's on it. */
  version: number;
  /** True when it changed after the run of show was last approved (or it's new since). */
  changedSinceApproval: boolean;
  createdAt: string;
  updatedAt: string;
};
/** POST /api/production/productions/:id/sessions → Session (201); PATCH .../sessions/:sessionId → Session (any subset).
 *  DELETE .../sessions/:sessionId → { ok: true } (removed; its console row goes at the next approval). */
export type SessionInput = {
  stageId?: number; // required on create: a stage of this production
  startsAt?: string; endsAt?: string; // ISO; required on create; ends after starts, at most 24 h
  title?: string; // required on create, 1–160
  kind?: SessionKind;
  status?: SessionStatus;
  sort?: number;
  mvOnly?: boolean;
  notes?: string; // up to 4000
  /** Replaces who's on it, in this order. Speakers must be this production's. */
  people?: { speakerId: number; role?: SessionPersonRole }[];
};

/** "draft" (never sent), "in_review" (with the client), "approved", "changes_requested" (the client asked), or
 *  "changes_pending" (approved before, edited since: the console keeps the approved version). */
export type RunOfShowState = "draft" | "in_review" | "approved" | "changes_requested" | "changes_pending";
/** GET /api/production/productions/:id/stages/:stageId/run-of-show → RunOfShow: the stage's sessions as they stand now. */
export type RunOfShow = {
  productionId: number;
  stageId: number;
  stageName: string;
  timezone: string; // the production's
  /** The working version (raised by any change) and the one last approved (null: never). */
  version: number;
  approvedVersion: number | null;
  approvedAt: string;
  state: RunOfShowState;
  /** The pending or latest approval for it, if any. */
  approvalId: number | null;
  sessions: Session[]; // by startsAt, then sort
  /** Since the last approval: session ids added, changed and removed. Empty before the first approval. */
  changes: { added: number[]; changed: number[]; removed: { id: number; title: string }[] };
};

/** A production's sponsor and what we owe them (e.g. "2 reads on Main Stage", "logo on lower thirds"). MV roles. */
export type LiveSponsor = { id: number; productionId: number; name: string; logoUrl: string; obligations: { what: string; count?: number; stageId?: number | null }[]; createdAt: string; updatedAt: string };
/** GET/POST /api/production/productions/:id/sponsors, PATCH/DELETE .../sponsors/:sponsorId. */
export type LiveSponsorInput = { name?: string; logoUrl?: string; obligations?: LiveSponsor["obligations"] };

export const TEMPLATE_KINDS = ["speaker_invite", "speaker_confirmation", "reminder", "call_time", "thank_you", "missing_info"] as const;
export type TemplateKind = (typeof TEMPLATE_KINDS)[number];
export const TEMPLATE_KIND_LABEL: Record<TemplateKind, string> = {
  speaker_invite: "Speaker invite", speaker_confirmation: "Speaker confirmation", reminder: "Reminder",
  call_time: "Call time", thank_you: "Thank you", missing_info: "Missing information",
};
/** draft → pending (sent for approval) → approved (sendable) | changes_requested; retired = replaced by a newer one. */
export type TemplateState = "draft" | "pending" | "approved" | "changes_requested" | "retired";
/** A message Alex may send. Only approved templates are sendable, and nothing leaves while live:send is off (except
 *  to the hello+live*@ test addresses). MV's blank starters (orgId 0) are copied into a client's own. */
export type LiveTemplate = {
  id: number;
  /** 0 = MV's blank starter; else the client org it belongs to. */
  orgId: number;
  productionId: number | null; // null = for every production of that org
  kind: TemplateKind;
  channel: "email" | "sms";
  subject: string; // "" for sms
  /** Plain text with {{Speaker_Name}}, {{Session_Title}}, {{Session_Time}}, {{Stage}}, {{Production}}, {{Call_Time}}. */
  text: string;
  version: number;
  state: TemplateState;
  approvedBy: string;
  approvedAt: string;
  /** True only when approved: the one thing Alex may send. */
  sendable: boolean;
  starter: boolean; // orgId 0
  createdAt: string;
  updatedAt: string;
};
/** GET /api/production/productions/:id/templates → LiveTemplate[] (MV starters, then the client's own). MV roles; Client
 *  Admin sees its org's. POST .../templates { kind, channel?, subject?, text?, fromStarterId? } → LiveTemplate (201, a draft
 *  for the production's client org). PATCH .../templates/:templateId { subject?, text? } → LiveTemplate (a new version:
 *  back to draft; approval is lost). MV roles. */

/** The test client reviewer (phase 2 done line): approves the run of show and bios in the portal. */
export const LIVE_TEST_REVIEWER = "hello+livereview@militaryvoices.ai";
/** Mail to these goes even while live:send is off (the done line's only sends). */
export const isLiveTestAddress = (email: string): boolean => /^hello\+live[a-z0-9-]*@militaryvoices?\.ai$/i.test(String(email ?? "").trim());
