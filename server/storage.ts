import { randomBytes } from "node:crypto";
import { events, signups, reminders, loginTokens, podcasterProfiles, sponsors, adminUsers, sponsorInquiries, siteSettings, showAssets, runOfShow, platformInterest, studios, studioParticipants, recordings, destinations, ingresses, scenes, youtubeAccounts, eventShows, nudges, campaignPosts, helpRequests, contacts, broadcasts, eventTeam, broadcastSends, broadcastEvents, type EventTeamMember } from "../shared/schema.js";
import type {
  CampaignPostRow,
  HelpRequestRow,
  EventRow,
  InsertEvent,
  UpdateEvent,
  SignupRow,
  InsertSignup,
  ReminderRow,
  InsertReminder,
  LoginTokenRow,
  ProfileRow,
  InsertProfile,
  SponsorRow,
  UpdateSponsor,
  AdminUserRow,
  ShowAssetRow,
  RunItemRow,
  RunItemInput,
  GeneratedRunItem,
  PlatformInterestRow,
  StudioRow,
  StudioParticipantRow,
  RecordingRow,
  DestinationRow,
  DestinationInput,
  IngressRow,
  SceneRow,
  YoutubeAccountRow,
  EventShowRow,
  NudgeRow,
  NudgeKind,
  SponsorInquiryRow,
  InsertSponsorInquiry,
  ContactRow,
  BroadcastRow,
} from "../shared/schema.js";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { and, eq, ne, asc, desc, isNull, inArray } from "drizzle-orm";
import { ensureSchema as syncSchemaFromDefinitions, schemaFingerprint } from "./schemaSync.js";

// Resolve the Postgres connection string lazily (not at module load) so a
// missing/bad value surfaces as a normal caught error on first request—
// visible in the API response—instead of crashing the whole serverless
// function before Express can respond. Supabase's Vercel Marketplace
// integration sets POSTGRES_URL (pooled, safe for serverless). Fall back to a
// plain DATABASE_URL for anyone wiring the DB up manually.
let _sql: ReturnType<typeof postgres> | null = null;
let _db: ReturnType<typeof drizzle> | null = null;

function getConnection(): { sql: ReturnType<typeof postgres>; db: ReturnType<typeof drizzle> } {
  if (!_sql || !_db) {
    const CONNECTION_STRING =
      process.env.POSTGRES_URL ||
      process.env.POSTGRES_PRISMA_URL ||
      process.env.DATABASE_URL;

    if (!CONNECTION_STRING) {
      throw new Error(
        "No Postgres connection string found. Set POSTGRES_URL (from the Supabase " +
          "Vercel integration) or DATABASE_URL in your environment.",
      );
    }

    // Serverless + Supabase pooler rules:
    //  - Session mode (port 5432 on *.pooler.supabase.com) is capped at 15
    //    clients total; every warm instance holding a pool of 10 blew through
    //    that under a small burst (EMAXCONNSESSION). Route through transaction
    //    mode (6543) instead, which multiplexes thousands of clients.
    //  - `prepare: false` is required in transaction mode (pgbouncer).
    //  - A small per-instance pool (4) lets a page's parallel requests run
    //    side by side; idle connections close so instances don't pin the pooler.
    let url = CONNECTION_STRING;
    try {
      const u = new URL(url);
      if (/\.pooler\.supabase\.com$/i.test(u.hostname) && (u.port === "5432" || u.port === "")) {
        u.port = "6543";
        url = u.toString();
      }
    } catch {
      /* leave the string untouched if it isn't a parseable URL */
    }
    _sql = postgres(url, { prepare: false, max: 4, idle_timeout: 20, connect_timeout: 10 });
    _db = drizzle(_sql);
  }
  return { sql: _sql, db: _db };
}

// Proxy so existing `db.select()...` call sites keep working unchanged while
// the underlying client is created lazily on first real use.
export const db: ReturnType<typeof drizzle> = new Proxy({} as ReturnType<typeof drizzle>, {
  get(_target, prop) {
    const { db: realDb } = getConnection();
    return (realDb as any)[prop];
  },
});

const DEFAULT_EVENT_SLUG = "marathon";

// Create tables on boot if they don't exist yet (no migration tooling needed for MVP)
async function ensureSchema() {
  const { sql } = getConnection();
  // Every table, column and index the code declares, derived from
  // shared/schema.ts. The hand-written DDL below is now only for data
  // backfills and the few things the schema can't express — structure comes
  // from one source, so it can't drift again.
  await syncSchemaFromDefinitions(sql as unknown as { unsafe: (q: string) => Promise<unknown> });
  await sql`
    CREATE TABLE IF NOT EXISTS events (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      tagline TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      start_at_utc TEXT NOT NULL,
      duration_hours INTEGER NOT NULL DEFAULT 24,
      slot_minutes INTEGER NOT NULL DEFAULT 60,
      on_air_minutes INTEGER NOT NULL DEFAULT 25,
      buffer_minutes INTEGER NOT NULL DEFAULT 5,
      buffer_position TEXT NOT NULL DEFAULT 'after',
      admin_password TEXT NOT NULL DEFAULT 'militaryvoice2026'
    );
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS signups (
      id SERIAL PRIMARY KEY,
      slot_index INTEGER NOT NULL,
      podcast_name TEXT NOT NULL,
      host_name TEXT NOT NULL,
      email TEXT NOT NULL,
      phone TEXT NOT NULL DEFAULT '',
      num_people INTEGER NOT NULL DEFAULT 1,
      has_video_intro BOOLEAN NOT NULL DEFAULT false,
      has_video_outro BOOLEAN NOT NULL DEFAULT false,
      has_slides BOOLEAN NOT NULL DEFAULT false,
      has_images BOOLEAN NOT NULL DEFAULT false,
      needs_interviewer BOOLEAN NOT NULL DEFAULT false,
      social_links TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      timezone TEXT NOT NULL DEFAULT '',
      photo_url TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'confirmed',
      created_at TEXT NOT NULL
    );
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS reminders (
      id SERIAL PRIMARY KEY,
      signup_id INTEGER NOT NULL,
      email TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS login_tokens (
      id SERIAL PRIMARY KEY,
      email TEXT NOT NULL,
      token TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      used_at TEXT,
      created_at TEXT NOT NULL
    );
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS podcaster_profiles (
      id SERIAL PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      podcast_name TEXT NOT NULL DEFAULT '',
      host_name TEXT NOT NULL DEFAULT '',
      phone TEXT NOT NULL DEFAULT '',
      num_people INTEGER NOT NULL DEFAULT 1,
      has_video_intro BOOLEAN NOT NULL DEFAULT false,
      has_video_outro BOOLEAN NOT NULL DEFAULT false,
      has_slides BOOLEAN NOT NULL DEFAULT false,
      has_images BOOLEAN NOT NULL DEFAULT false,
      needs_interviewer BOOLEAN NOT NULL DEFAULT false,
      social_links TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      photo_url TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS sponsors (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      url TEXT NOT NULL DEFAULT '',
      logo_url TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      active BOOLEAN NOT NULL DEFAULT true,
      created_at TEXT NOT NULL
    );
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS show_assets (
      id SERIAL PRIMARY KEY,
      email TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'Other',
      label TEXT NOT NULL DEFAULT '',
      file_url TEXT NOT NULL DEFAULT '',
      link_url TEXT NOT NULL DEFAULT '',
      file_name TEXT NOT NULL DEFAULT '',
      size_bytes INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
  `;
  await sql`CREATE INDEX IF NOT EXISTS show_assets_email_idx ON show_assets (email)`;

  await sql`
    CREATE TABLE IF NOT EXISTS run_of_show (
      id SERIAL PRIMARY KEY,
      event_id INTEGER NOT NULL,
      sort_index INTEGER NOT NULL DEFAULT 0,
      kind TEXT NOT NULL DEFAULT 'Custom',
      title TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      start_at_utc TEXT NOT NULL DEFAULT '',
      duration_minutes INTEGER NOT NULL DEFAULT 0,
      signup_id INTEGER,
      created_at TEXT NOT NULL
    );
  `;
  await sql`CREATE INDEX IF NOT EXISTS run_of_show_event_idx ON run_of_show (event_id, sort_index)`;
  await sql`ALTER TABLE run_of_show ADD COLUMN IF NOT EXISTS source_key TEXT NOT NULL DEFAULT ''`;
  await sql`ALTER TABLE run_of_show ADD COLUMN IF NOT EXISTS edited BOOLEAN NOT NULL DEFAULT false`;

  await sql`
    CREATE TABLE IF NOT EXISTS studios (
      id SERIAL PRIMARY KEY,
      event_id INTEGER NOT NULL,
      name TEXT NOT NULL DEFAULT 'Main studio',
      status TEXT NOT NULL DEFAULT 'Offline',
      max_on_stage INTEGER NOT NULL DEFAULT 5,
      fallback_video_url TEXT NOT NULL DEFAULT '',
      fallback_label TEXT NOT NULL DEFAULT '',
      fallback_playing BOOLEAN NOT NULL DEFAULT false,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS studio_participants (
      id SERIAL PRIMARY KEY,
      studio_id INTEGER NOT NULL,
      client_key TEXT NOT NULL,
      display_name TEXT NOT NULL DEFAULT '',
      email TEXT NOT NULL DEFAULT '',
      role TEXT NOT NULL DEFAULT 'Speaker',
      state TEXT NOT NULL DEFAULT 'Green room',
      cam_ready BOOLEAN NOT NULL DEFAULT false,
      mic_ready BOOLEAN NOT NULL DEFAULT false,
      last_seen_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS studio_participants_key_idx ON studio_participants (studio_id, client_key)`;

  await sql`ALTER TABLE studios ADD COLUMN IF NOT EXISTS broadcast_egress_id TEXT NOT NULL DEFAULT ''`;
  await sql`ALTER TABLE studios ADD COLUMN IF NOT EXISTS recording_egress_id TEXT NOT NULL DEFAULT ''`;
  await sql`ALTER TABLE studios ADD COLUMN IF NOT EXISTS recording_signup_id INTEGER`;
  await sql`ALTER TABLE studios ADD COLUMN IF NOT EXISTS stage_media_url TEXT NOT NULL DEFAULT ''`;
  await sql`ALTER TABLE studios ADD COLUMN IF NOT EXISTS stage_media_kind TEXT NOT NULL DEFAULT 'video'`;
  await sql`ALTER TABLE studios ADD COLUMN IF NOT EXISTS stage_media_label TEXT NOT NULL DEFAULT ''`;
  await sql`ALTER TABLE studios ADD COLUMN IF NOT EXISTS stage_media_playing BOOLEAN NOT NULL DEFAULT false`;

  await sql`
    CREATE TABLE IF NOT EXISTS scenes (
      id SERIAL PRIMARY KEY,
      studio_id INTEGER NOT NULL,
      name TEXT NOT NULL DEFAULT 'Scene',
      sort_index INTEGER NOT NULL DEFAULT 0,
      media_url TEXT NOT NULL DEFAULT '',
      media_kind TEXT NOT NULL DEFAULT 'video',
      media_label TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );
  `;
  await sql`CREATE INDEX IF NOT EXISTS scenes_studio_idx ON scenes (studio_id)`;
  await sql`ALTER TABLE run_of_show ADD COLUMN IF NOT EXISTS media_url TEXT NOT NULL DEFAULT ''`;
  await sql`ALTER TABLE run_of_show ADD COLUMN IF NOT EXISTS media_kind TEXT NOT NULL DEFAULT 'video'`;
  await sql`ALTER TABLE run_of_show ADD COLUMN IF NOT EXISTS media_label TEXT NOT NULL DEFAULT ''`;

  await sql`
    CREATE TABLE IF NOT EXISTS youtube_accounts (
      id SERIAL PRIMARY KEY,
      email TEXT NOT NULL,
      channel_id TEXT NOT NULL DEFAULT '',
      channel_title TEXT NOT NULL DEFAULT '',
      refresh_token TEXT NOT NULL,
      access_token TEXT NOT NULL DEFAULT '',
      expires_at TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );
  `;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS youtube_accounts_email_idx ON youtube_accounts (email)`;

  await sql`
    CREATE TABLE IF NOT EXISTS event_shows (
      id SERIAL PRIMARY KEY,
      email TEXT NOT NULL,
      event_id INTEGER NOT NULL,
      show_name TEXT NOT NULL DEFAULT '',
      show_format TEXT NOT NULL DEFAULT 'live',
      recording_url TEXT NOT NULL DEFAULT '',
      intro_style TEXT NOT NULL DEFAULT 'virtual',
      image_url TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT ''
    );
  `;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS event_shows_email_event_idx ON event_shows (email, event_id)`;
  // CREATE TABLE IF NOT EXISTS will not add a column to a table that already
  // exists, so anything added to event_shows later needs its own ALTER here.
  await sql`ALTER TABLE event_shows ADD COLUMN IF NOT EXISTS image_url TEXT NOT NULL DEFAULT ''`;
  await sql`ALTER TABLE event_shows ADD COLUMN IF NOT EXISTS updated_at TEXT NOT NULL DEFAULT ''`;
  await sql`ALTER TABLE event_shows ADD COLUMN IF NOT EXISTS interview_need TEXT NOT NULL DEFAULT 'none'`;

  await sql`
    CREATE TABLE IF NOT EXISTS nudges (
      id SERIAL PRIMARY KEY,
      signup_id INTEGER NOT NULL,
      kind TEXT NOT NULL,
      emailed BOOLEAN NOT NULL DEFAULT true,
      sent_at TEXT NOT NULL
    );
  `;
  // The unique index is what actually stops a double send: two overlapping
  // cron runs race to insert, and the loser is rejected by the database
  // rather than politely deciding not to send.
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS nudges_signup_kind_idx ON nudges (signup_id, kind)`;

  await sql`ALTER TABLE events ADD COLUMN IF NOT EXISTS image_url TEXT NOT NULL DEFAULT ''`;
  // Give the marathon its card artwork once, without clobbering a later choice.
  await sql`UPDATE events SET image_url = '/event-marathon.jpg' WHERE slug = 'marathon' AND image_url = ''`;

  // Backfill: everyone who already has a profile keeps their show on the
  // featured event, so nobody logs in to find their booked show missing.
  await sql`
    INSERT INTO event_shows (email, event_id, show_name, show_format, recording_url, intro_style, image_url, created_at)
    SELECT p.email, e.id, p.podcast_name, p.show_format, p.recording_url, p.intro_style, '', NOW()::text
    FROM podcaster_profiles p
    CROSS JOIN (SELECT id FROM events WHERE is_featured = true ORDER BY id LIMIT 1) e
    WHERE p.podcast_name <> ''
    ON CONFLICT (email, event_id) DO NOTHING
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS recordings (
      id SERIAL PRIMARY KEY,
      event_id INTEGER NOT NULL,
      studio_id INTEGER NOT NULL,
      signup_id INTEGER,
      email TEXT NOT NULL DEFAULT '',
      title TEXT NOT NULL DEFAULT '',
      egress_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'Recording',
      url TEXT NOT NULL DEFAULT '',
      duration_sec INTEGER NOT NULL DEFAULT 0,
      size_bytes TEXT NOT NULL DEFAULT '0',
      started_at TEXT NOT NULL,
      ended_at TEXT
    );
  `;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS recordings_egress_idx ON recordings (egress_id)`;
  await sql`CREATE INDEX IF NOT EXISTS recordings_email_idx ON recordings (email)`;
  await sql`ALTER TABLE recordings ADD COLUMN IF NOT EXISTS error TEXT NOT NULL DEFAULT ''`;

  await sql`
    CREATE TABLE IF NOT EXISTS destinations (
      id SERIAL PRIMARY KEY,
      event_id INTEGER NOT NULL,
      signup_id INTEGER,
      owner_email TEXT NOT NULL DEFAULT '',
      platform TEXT NOT NULL DEFAULT 'custom',
      label TEXT NOT NULL DEFAULT '',
      rtmp_url TEXT NOT NULL DEFAULT '',
      stream_key TEXT NOT NULL DEFAULT '',
      enabled BOOLEAN NOT NULL DEFAULT true,
      live BOOLEAN NOT NULL DEFAULT false,
      created_at TEXT NOT NULL
    );
  `;
  await sql`CREATE INDEX IF NOT EXISTS destinations_event_idx ON destinations (event_id)`;

  await sql`
    CREATE TABLE IF NOT EXISTS ingresses (
      id SERIAL PRIMARY KEY,
      event_id INTEGER NOT NULL,
      studio_id INTEGER NOT NULL,
      signup_id INTEGER,
      owner_email TEXT NOT NULL DEFAULT '',
      ingress_id TEXT NOT NULL,
      participant_identity TEXT NOT NULL DEFAULT '',
      display_name TEXT NOT NULL DEFAULT '',
      url TEXT NOT NULL DEFAULT '',
      stream_key TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );
  `;
  await sql`CREATE INDEX IF NOT EXISTS ingresses_owner_idx ON ingresses (owner_email)`;

  await sql`
    CREATE TABLE IF NOT EXISTS platform_interest (
      id SERIAL PRIMARY KEY,
      intent TEXT NOT NULL DEFAULT 'beta',
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      organization TEXT NOT NULL DEFAULT '',
      event_timing TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      handled BOOLEAN NOT NULL DEFAULT false,
      created_at TEXT NOT NULL
    );
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS site_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS sponsor_inquiries (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      company TEXT NOT NULL DEFAULT '',
      email TEXT NOT NULL,
      phone TEXT NOT NULL DEFAULT '',
      message TEXT NOT NULL DEFAULT '',
      handled BOOLEAN NOT NULL DEFAULT false,
      created_at TEXT NOT NULL
    );
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS admin_users (
      id SERIAL PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL DEFAULT '',
      is_owner BOOLEAN NOT NULL DEFAULT false,
      created_at TEXT NOT NULL
    );
  `;
  // Seed the account owner so there is always a way in.
  await sql`
    INSERT INTO admin_users (email, name, is_owner, created_at)
    VALUES ('andrew@podlogix.co', 'Andrew Appleton', true, ${new Date().toISOString()})
    ON CONFLICT (email) DO UPDATE SET is_owner = true
  `;

  for (const t of ["signups", "podcaster_profiles"]) {
    await sql.unsafe(`ALTER TABLE ${t} ADD COLUMN IF NOT EXISTS show_format TEXT NOT NULL DEFAULT 'live'`);
    await sql.unsafe(`ALTER TABLE ${t} ADD COLUMN IF NOT EXISTS recording_url TEXT NOT NULL DEFAULT ''`);
    await sql.unsafe(`ALTER TABLE ${t} ADD COLUMN IF NOT EXISTS intro_style TEXT NOT NULL DEFAULT 'virtual'`);
    await sql.unsafe(`ALTER TABLE ${t} ADD COLUMN IF NOT EXISTS branch TEXT NOT NULL DEFAULT ''`);
    await sql.unsafe(`ALTER TABLE ${t} ADD COLUMN IF NOT EXISTS service_status TEXT NOT NULL DEFAULT ''`);
    await sql.unsafe(`ALTER TABLE ${t} ADD COLUMN IF NOT EXISTS recording_mode TEXT NOT NULL DEFAULT ''`);
    await sql.unsafe(`ALTER TABLE ${t} ADD COLUMN IF NOT EXISTS post_edits TEXT NOT NULL DEFAULT ''`);
    await sql.unsafe(`ALTER TABLE ${t} ADD COLUMN IF NOT EXISTS stream_platform TEXT NOT NULL DEFAULT ''`);
    await sql.unsafe(`ALTER TABLE ${t} ADD COLUMN IF NOT EXISTS stream_platform_other TEXT NOT NULL DEFAULT ''`);
    await sql.unsafe(`ALTER TABLE ${t} ADD COLUMN IF NOT EXISTS guests TEXT NOT NULL DEFAULT ''`);
    await sql.unsafe(`ALTER TABLE ${t} ADD COLUMN IF NOT EXISTS interview_questions TEXT NOT NULL DEFAULT ''`);
    await sql.unsafe(`ALTER TABLE ${t} ADD COLUMN IF NOT EXISTS promo_notes TEXT NOT NULL DEFAULT ''`);
    // These three live in the drizzle schema and in the deployed database
    // (drizzle-kit push put them there) but were never in this migration, so
    // a database created by the server alone was missing them and every
    // signups query failed. Kept here so the migration stands on its own.
    await sql.unsafe(`ALTER TABLE ${t} ADD COLUMN IF NOT EXISTS rss_url TEXT NOT NULL DEFAULT ''`);
    await sql.unsafe(`ALTER TABLE ${t} ADD COLUMN IF NOT EXISTS youtube_url TEXT NOT NULL DEFAULT ''`);
    await sql.unsafe(`ALTER TABLE ${t} ADD COLUMN IF NOT EXISTS social_accounts TEXT NOT NULL DEFAULT ''`);
  }

  // Migrate older databases created before these columns existed.
  await sql`ALTER TABLE signups ADD COLUMN IF NOT EXISTS photo_url TEXT NOT NULL DEFAULT ''`;
  await sql`ALTER TABLE events ADD COLUMN IF NOT EXISTS on_air_minutes INTEGER NOT NULL DEFAULT 25`;
  await sql`ALTER TABLE events ADD COLUMN IF NOT EXISTS buffer_minutes INTEGER NOT NULL DEFAULT 5`;
  await sql`ALTER TABLE events ADD COLUMN IF NOT EXISTS buffer_position TEXT NOT NULL DEFAULT 'after'`;

  // Multi-event support: every event gets a slug + a featured flag, signups
  // now belong to a specific event. `watch_signups` from an earlier build is
  // intentionally left alone (orphaned, not referenced) rather than dropped.
  await sql`ALTER TABLE events ADD COLUMN IF NOT EXISTS slug TEXT NOT NULL DEFAULT ''`;
  await sql`ALTER TABLE events ADD COLUMN IF NOT EXISTS is_featured BOOLEAN NOT NULL DEFAULT false`;
  await sql`ALTER TABLE events ADD COLUMN IF NOT EXISTS created_at TEXT NOT NULL DEFAULT ''`;
  await sql`UPDATE events SET slug = ${DEFAULT_EVENT_SLUG} WHERE slug = '' AND id = (SELECT MIN(id) FROM events)`;
  await sql`UPDATE events SET is_featured = true WHERE id = (SELECT MIN(id) FROM events) AND NOT EXISTS (SELECT 1 FROM events WHERE is_featured = true)`;
  await sql`UPDATE events SET created_at = start_at_utc WHERE created_at = ''`;

  await sql`ALTER TABLE signups ADD COLUMN IF NOT EXISTS event_id INTEGER`;
  await sql`UPDATE signups SET event_id = (SELECT id FROM events WHERE is_featured = true LIMIT 1) WHERE event_id IS NULL`;
}

// Two serverless instances booting at the same instant can both run the
// CREATE/ALTER ... IF NOT EXISTS statements above; Postgres then rejects one
// of them with a duplicate-object error even though the schema is fine.
// Treat those as success, and give anything else one quiet retry.
const BENIGN_SCHEMA_ERRORS = new Set(["23505", "42P07", "42701", "42710"]);
// Bump this whenever ensureSchema() gains a new table or column, and point
// SCHEMA_SENTINEL at something that migration creates. The fast path below
// skips ~12 DDL round-trips on every cold start, so a stale sentinel silently
// skips new migrations — which is exactly how show_format went missing once.
/**
 * Skip the whole bootstrap when the database already matches the code. The
 * marker is a fingerprint of the schema's own shape rather than one
 * hand-chosen column, so adding a column invalidates it automatically. The
 * old sentinel had to be bumped by hand and silently skipped migrations
 * whenever it wasn't — which is how events.slug and signups.rss_url ended up
 * missing from a database the migration claimed to build.
 */
async function schemaAlreadyPresent(): Promise<boolean> {
  const { sql } = getConnection();
  await sql`CREATE TABLE IF NOT EXISTS schema_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`;
  const rows = await sql`SELECT value FROM schema_meta WHERE key = 'fingerprint' LIMIT 1`;
  return rows.length > 0 && rows[0].value === schemaFingerprint();
}

async function recordSchemaFingerprint(): Promise<void> {
  const { sql } = getConnection();
  const fp = schemaFingerprint();
  await sql`
    INSERT INTO schema_meta (key, value) VALUES ('fingerprint', ${fp})
    ON CONFLICT (key) DO UPDATE SET value = ${fp}`;
}

async function ensureSchemaSafe(attempt = 0): Promise<void> {
  try {
    if (await schemaAlreadyPresent()) return;
    await ensureSchema();
    await recordSchemaFingerprint();
  } catch (err: any) {
    const code = String(err?.code ?? "");
    if (BENIGN_SCHEMA_ERRORS.has(code)) {
      console.warn(`Schema bootstrap race ignored (${code}).`);
      return;
    }
    if (attempt < 1) {
      await new Promise((r) => setTimeout(r, 400));
      return ensureSchemaSafe(attempt + 1);
    }
    throw err;
  }
}

let schemaReady: Promise<void> | null = null;
function ready(): Promise<void> {
  if (!schemaReady) {
    schemaReady = ensureSchemaSafe().catch((err) => {
      schemaReady = null;
      throw err;
    });
  }
  return schemaReady;
}

export interface IStorage {
  listEvents(): Promise<EventRow[]>;
  getFeaturedEvent(): Promise<EventRow>;
  getEventBySlug(slug: string): Promise<EventRow | undefined>;
  getEventById(id: number): Promise<EventRow | undefined>;
  createEvent(data: InsertEvent): Promise<EventRow>;
  updateEvent(id: number, patch: UpdateEvent): Promise<EventRow | undefined>;
  listSignups(eventId?: number): Promise<SignupRow[]>;
  getSignupBySlot(eventId: number, slotIndex: number): Promise<SignupRow | undefined>;
  createSignup(signup: InsertSignup): Promise<SignupRow>;
  cancelSignup(id: number): Promise<SignupRow | undefined>;
  deleteSignup(id: number): Promise<{ changes: number }>;
  getSignupById(id: number): Promise<SignupRow | undefined>;
  createReminder(reminder: InsertReminder): Promise<ReminderRow>;
  listReminders(): Promise<ReminderRow[]>;
  /** Mark a reminder as sent, atomically; false if it already was. */
  claimReminder(id: number): Promise<boolean>;
  releaseReminder(id: number): Promise<void>;
  createLoginToken(email: string, token: string, expiresAt: string): Promise<LoginTokenRow>;
  getLoginToken(email: string, token: string): Promise<LoginTokenRow | undefined>;
  markLoginTokenUsed(id: number): Promise<void>;
  supersedeLoginTokens(email: string): Promise<void>;
  getProfileByEmail(email: string): Promise<ProfileRow | undefined>;
  upsertProfile(
    email: string,
    patch: Partial<InsertProfile> & { photoUrl?: string; uploadPostUsername?: string; socialAccounts?: string },
  ): Promise<ProfileRow>;
  updateSignupSocialAccountsByEmail(email: string, socialAccountsJson: string): Promise<void>;
  syncSignupsFromProfile(email: string, profile: ProfileRow): Promise<number>;
  syncSignupsFromEventShow(email: string, eventId: number, show: EventShowRow): Promise<number>;
  listCompleteProfiles(): Promise<ProfileRow[]>;
  listSponsors(activeOnly: boolean, eventIds?: number[]): Promise<SponsorRow[]>;
  createSponsor(data: { name: string; url: string; logoUrl: string; eventId: number }): Promise<SponsorRow>;
  updateSponsor(id: number, patch: UpdateSponsor): Promise<SponsorRow | undefined>;
  deleteSponsor(id: number): Promise<void>;
  listAdmins(): Promise<AdminUserRow[]>;
  isAdminEmail(email: string): Promise<boolean>;
  addAdmin(email: string, name: string): Promise<AdminUserRow>;
  removeAdmin(id: number): Promise<{ removed: boolean; reason?: string }>;
  createSponsorInquiry(data: InsertSponsorInquiry): Promise<SponsorInquiryRow>;
  listSponsorInquiries(): Promise<SponsorInquiryRow[]>;
  setSponsorInquiryHandled(id: number, handled: boolean): Promise<void>;
  listAssetsByEmail(email: string): Promise<ShowAssetRow[]>;
  listAllAssets(): Promise<ShowAssetRow[]>;
  createAsset(a: Omit<ShowAssetRow, "id" | "createdAt">): Promise<ShowAssetRow>;
  deleteAsset(id: number, email?: string): Promise<boolean>;
  listRunOfShow(eventId: number): Promise<RunItemRow[]>;
  mergeRunOfShow(eventId: number, generated: GeneratedRunItem[]): Promise<RunItemRow[]>;
  createRunItem(eventId: number, item: RunItemInput, sortIndex: number): Promise<RunItemRow>;
  updateRunItem(id: number, patch: Partial<RunItemInput> & { sortIndex?: number }): Promise<RunItemRow | undefined>;
  deleteRunItem(id: number): Promise<void>;
  createPlatformInterest(v: Omit<PlatformInterestRow, "id" | "handled" | "createdAt">): Promise<PlatformInterestRow>;
  listPlatformInterest(): Promise<PlatformInterestRow[]>;
  getOrCreateStudio(eventId: number): Promise<StudioRow>;
  listStudios(eventId: number): Promise<StudioRow[]>;
  getStudioById(id: number): Promise<StudioRow | undefined>;
  createStudio(eventId: number, name: string): Promise<StudioRow>;
  deleteStudio(id: number): Promise<void>;
  listScenes(studioId: number): Promise<SceneRow[]>;
  getScene(id: number): Promise<SceneRow | undefined>;
  createScene(v: Omit<SceneRow, "id" | "createdAt">): Promise<SceneRow>;
  deleteScene(id: number): Promise<void>;
  listNudgesForSignups(signupIds: number[]): Promise<NudgeRow[]>;
  /** Insert-if-absent. Returns false when this nudge was already recorded. */
  claimNudge(signupId: number, kind: NudgeKind, emailed: boolean): Promise<boolean>;
  /** Give a claim back so the next run retries it. */
  releaseNudge(signupId: number, kind: NudgeKind): Promise<void>;
  listCampaignPosts(signupId: number): Promise<CampaignPostRow[]>;
  listAllStudios(): Promise<StudioRow[]>;
  createHelpRequest(v: { name: string; email: string; question: string; transcript: string; page: string }): Promise<HelpRequestRow>;
  listHelpRequests(): Promise<HelpRequestRow[]>;
  /** Make the stored plan match `picks`; posts already sent are left alone. */
  replaceCampaignPlan(
    signupId: number,
    picks: { kind: string; platforms: string[]; scheduledFor: string }[],
  ): Promise<CampaignPostRow[]>;
  listDueCampaignPosts(nowIso: string): Promise<CampaignPostRow[]>;
  /** planned -> posting, atomically; false if someone else got it. */
  claimCampaignPost(id: number): Promise<boolean>;
  finishCampaignPost(id: number, ok: boolean, error?: string): Promise<void>;
  getEventShow(email: string, eventId: number): Promise<EventShowRow | undefined>;
  listEventShows(email: string): Promise<EventShowRow[]>;
  upsertEventShow(email: string, eventId: number, v: Partial<EventShowRow>): Promise<EventShowRow>;
  getYoutubeAccount(email: string): Promise<YoutubeAccountRow | undefined>;
  upsertYoutubeAccount(email: string, v: Partial<YoutubeAccountRow> & { refreshToken: string }): Promise<YoutubeAccountRow>;
  deleteYoutubeAccount(email: string): Promise<void>;
  updateStudio(id: number, patch: Partial<StudioRow>): Promise<StudioRow | undefined>;
  listStudioParticipants(studioId: number): Promise<StudioParticipantRow[]>;
  upsertStudioParticipant(
    studioId: number,
    clientKey: string,
    v: Partial<StudioParticipantRow>,
  ): Promise<StudioParticipantRow>;
  setParticipantState(id: number, state: string): Promise<StudioParticipantRow | undefined>;
  removeStudioParticipant(id: number): Promise<void>;
  createRecording(v: {
    eventId: number;
    studioId: number;
    signupId?: number | null;
    email: string;
    title: string;
    egressId: string;
    filepath: string;
  }): Promise<RecordingRow>;
  finishRecording(
    egressId: string,
    v: { status: string; url?: string; durationSec?: number; sizeBytes?: string; error?: string },
  ): Promise<RecordingRow | undefined>;
  listRecordingsByEmail(email: string): Promise<RecordingRow[]>;
  listRecordings(eventId?: number): Promise<RecordingRow[]>;
  getRecording(id: number): Promise<RecordingRow | undefined>;
  listDestinations(eventId: number): Promise<DestinationRow[]>;
  getDestination(id: number): Promise<DestinationRow | undefined>;
  createDestination(eventId: number, ownerEmail: string, v: DestinationInput): Promise<DestinationRow>;
  updateDestination(id: number, patch: Partial<DestinationRow>): Promise<DestinationRow | undefined>;
  deleteDestination(id: number): Promise<void>;
  listIngresses(eventId: number): Promise<IngressRow[]>;
  getIngressByEmail(email: string): Promise<IngressRow | undefined>;
  getIngressRow(id: number): Promise<IngressRow | undefined>;
  createIngressRow(v: Omit<IngressRow, "id" | "createdAt">): Promise<IngressRow>;
  deleteIngressRow(id: number): Promise<void>;
  getSetting(key: string): Promise<string | null>;
  setSetting(key: string, value: string): Promise<void>;
}

// Default marathon: kicks off the next Saturday at 12:00 PM Eastern for 24 hours,
// one slot per hour. Admin can change all of this from the dashboard.
function defaultStartAtUtc(): string {
  const now = new Date();
  const target = new Date(now);
  const daysUntilSaturday = (6 - now.getUTCDay() + 7) % 7 || 7;
  target.setUTCDate(now.getUTCDate() + daysUntilSaturday);
  target.setUTCHours(16, 0, 0, 0); // 12:00 PM Eastern (UTC-4 in daylight time)
  return target.toISOString();
}

class DatabaseStorage implements IStorage {
  /** Bootstraps the default marathon event on first boot if no events exist at all. */
  private async ensureAtLeastOneEvent(): Promise<void> {
    const [existing] = await db.select().from(events).limit(1);
    if (existing) return;
    await db.insert(events).values({
      slug: DEFAULT_EVENT_SLUG,
      isFeatured: true,
      name: "MilitaryVoice.ai 24-Hour Podcast Marathon",
      tagline: "One mic, every time zone, twenty-four hours straight.",
      description:
        "Claim your hour. We'll build the on-air agenda automatically as podcasters sign up around the clock.",
      startAtUtc: defaultStartAtUtc(),
      durationHours: 24,
      slotMinutes: 60,
      onAirMinutes: 25,
      bufferMinutes: 5,
      bufferPosition: "after",
      adminPassword: "militaryvoice2026",
      createdAt: new Date().toISOString(),
    });
  }

  async listEvents(): Promise<EventRow[]> {
    await ready();
    await this.ensureAtLeastOneEvent();
    return db.select().from(events).orderBy(events.id);
  }

  async getFeaturedEvent(): Promise<EventRow> {
    await ready();
    await this.ensureAtLeastOneEvent();
    const [featured] = await db.select().from(events).where(eq(events.isFeatured, true));
    if (featured) return featured;
    // No event flagged featured yet (shouldn't happen post-bootstrap) — fall back to the first one.
    const [first] = await db.select().from(events).orderBy(events.id).limit(1);
    return first;
  }

  async getEventBySlug(slug: string): Promise<EventRow | undefined> {
    await ready();
    const [row] = await db.select().from(events).where(eq(events.slug, slug));
    return row;
  }

  async getEventById(id: number): Promise<EventRow | undefined> {
    await ready();
    const [row] = await db.select().from(events).where(eq(events.id, id));
    return row;
  }

  async createEvent(data: InsertEvent): Promise<EventRow> {
    await ready();
    if (data.isFeatured) {
      await db.update(events).set({ isFeatured: false }).where(eq(events.isFeatured, true));
    }
    // Every event carries its own legacy admin password, and the schema default
    // is a known string — so a new event must never keep it.
    const adminPassword = data.adminPassword?.trim() || randomBytes(18).toString("base64url");
    const [created] = await db
      .insert(events)
      .values({ ...data, adminPassword, createdAt: new Date().toISOString() })
      .returning();
    return created;
  }

  async updateEvent(id: number, patch: UpdateEvent): Promise<EventRow | undefined> {
    await ready();
    if (patch.isFeatured) {
      await db.update(events).set({ isFeatured: false }).where(eq(events.isFeatured, true));
    }
    const [updated] = await db.update(events).set(patch).where(eq(events.id, id)).returning();
    return updated;
  }

  async listSignups(eventId?: number): Promise<SignupRow[]> {
    await ready();
    if (eventId === undefined) return db.select().from(signups);
    return db.select().from(signups).where(eq(signups.eventId, eventId));
  }

  async getSignupBySlot(eventId: number, slotIndex: number): Promise<SignupRow | undefined> {
    await ready();
    const [row] = await db
      .select()
      .from(signups)
      .where(and(eq(signups.eventId, eventId), eq(signups.slotIndex, slotIndex)));
    return row;
  }

  async createSignup(signup: InsertSignup): Promise<SignupRow> {
    await ready();
    const [created] = await db
      .insert(signups)
      .values({ ...signup, createdAt: new Date().toISOString(), status: "confirmed" })
      .returning();
    return created;
  }

  async cancelSignup(id: number): Promise<SignupRow | undefined> {
    await ready();
    const [updated] = await db
      .update(signups)
      .set({ status: "cancelled" })
      .where(eq(signups.id, id))
      .returning();
    return updated;
  }

  async deleteSignup(id: number): Promise<{ changes: number }> {
    await ready();
    const deleted = await db.delete(signups).where(eq(signups.id, id)).returning();
    return { changes: deleted.length };
  }

  async getSignupById(id: number): Promise<SignupRow | undefined> {
    await ready();
    const [row] = await db.select().from(signups).where(eq(signups.id, id));
    return row;
  }

  async createReminder(reminder: InsertReminder): Promise<ReminderRow> {
    await ready();
    const [created] = await db
      .insert(reminders)
      .values({ ...reminder, createdAt: new Date().toISOString() })
      .returning();
    return created;
  }

  async claimReminder(id: number): Promise<boolean> {
    await ready();
    const rows = await db
      .update(reminders)
      .set({ remindedAt: new Date().toISOString() })
      .where(and(eq(reminders.id, id), eq(reminders.remindedAt, "")))
      .returning({ id: reminders.id });
    return rows.length > 0;
  }

  async releaseReminder(id: number): Promise<void> {
    await ready();
    await db.update(reminders).set({ remindedAt: "" }).where(eq(reminders.id, id));
  }

  async listReminders(): Promise<ReminderRow[]> {
    await ready();
    return db.select().from(reminders);
  }

  async createLoginToken(email: string, token: string, expiresAt: string): Promise<LoginTokenRow> {
    await ready();
    const [created] = await db
      .insert(loginTokens)
      .values({ email, token, expiresAt, createdAt: new Date().toISOString() })
      .returning();
    return created;
  }

  async getLoginToken(email: string, token: string): Promise<LoginTokenRow | undefined> {
    await ready();
    const [row] = await db
      .select()
      .from(loginTokens)
      .where(and(eq(loginTokens.email, email.toLowerCase()), eq(loginTokens.token, token)))
      .orderBy(loginTokens.id);
    return row;
  }

  async markLoginTokenUsed(id: number): Promise<void> {
    await ready();
    await db.update(loginTokens).set({ usedAt: new Date().toISOString() }).where(eq(loginTokens.id, id));
  }

  /**
   * Retires any code still outstanding for this address. Asking for a new code
   * should make the old email useless — otherwise someone types the first code
   * they find in their inbox and gets told it's invalid, which reads like the
   * system is broken.
   */
  async supersedeLoginTokens(email: string): Promise<void> {
    await ready();
    await db
      .update(loginTokens)
      .set({ usedAt: new Date().toISOString() })
      .where(and(eq(loginTokens.email, email), isNull(loginTokens.usedAt)));
  }

  async getProfileByEmail(email: string): Promise<ProfileRow | undefined> {
    await ready();
    const [row] = await db
      .select()
      .from(podcasterProfiles)
      .where(eq(podcasterProfiles.email, email.trim().toLowerCase()));
    return row;
  }

  /** Profiles that have everything a public card needs (name, host, photo). */
  async listCompleteProfiles(): Promise<ProfileRow[]> {
    await ready();
    return db
      .select()
      .from(podcasterProfiles)
      .where(
        and(ne(podcasterProfiles.podcastName, ""), ne(podcasterProfiles.hostName, ""), ne(podcasterProfiles.photoUrl, "")),
      )
      .orderBy(podcasterProfiles.createdAt);
  }

  async listAssetsByEmail(email: string): Promise<ShowAssetRow[]> {
    await ready();
    return db.select().from(showAssets).where(eq(showAssets.email, email.trim().toLowerCase())).orderBy(asc(showAssets.id));
  }

  async listAllAssets(): Promise<ShowAssetRow[]> {
    await ready();
    return db.select().from(showAssets).orderBy(asc(showAssets.id));
  }

  async createAsset(a: Omit<ShowAssetRow, "id" | "createdAt">): Promise<ShowAssetRow> {
    await ready();
    const [row] = await db
      .insert(showAssets)
      .values({ ...a, email: a.email.trim().toLowerCase(), createdAt: new Date().toISOString() })
      .returning();
    return row;
  }

  /** `email` scopes the delete so a podcaster can only remove their own. */
  async deleteAsset(id: number, email?: string): Promise<boolean> {
    await ready();
    const where = email ? and(eq(showAssets.id, id), eq(showAssets.email, email.trim().toLowerCase())) : eq(showAssets.id, id);
    const rows = await db.delete(showAssets).where(where).returning({ id: showAssets.id });
    return rows.length > 0;
  }

  async listRunOfShow(eventId: number): Promise<RunItemRow[]> {
    await ready();
    return db.select().from(runOfShow).where(eq(runOfShow.eventId, eventId)).orderBy(asc(runOfShow.sortIndex), asc(runOfShow.id));
  }

  /**
   * Fold a freshly generated plan into whatever is already there.
   *
   *  - a generated row that already exists keeps its wording if an admin edited
   *    it, and always takes the new time, length and podcaster
   *  - a generated row that's new gets inserted
   *  - a generated row that no longer applies is dropped, unless it was edited
   *  - rows an admin added by hand are never touched
   *
   * Everything is then re-sorted by start time so the list still reads in order.
   */
  async mergeRunOfShow(eventId: number, generated: GeneratedRunItem[]): Promise<RunItemRow[]> {
    await ready();
    const existing = await db.select().from(runOfShow).where(eq(runOfShow.eventId, eventId));
    const byKey = new Map(existing.filter((r) => r.sourceKey).map((r) => [r.sourceKey, r]));
    const now = new Date().toISOString();
    const wanted = new Set(generated.map((g) => g.sourceKey));

    for (const g of generated) {
      const prev = byKey.get(g.sourceKey);
      if (!prev) {
        await db.insert(runOfShow).values({
          eventId,
          sortIndex: 0,
          kind: g.kind,
          title: g.title,
          notes: g.notes,
          startAtUtc: g.startAtUtc,
          durationMinutes: g.durationMinutes,
          signupId: g.signupId ?? null,
          sourceKey: g.sourceKey,
          edited: false,
          createdAt: now,
        });
        continue;
      }
      // Timing and the linked podcaster always follow the schedule; the wording
      // only refreshes when nobody has rewritten it.
      const patch: Record<string, unknown> = {
        startAtUtc: g.startAtUtc,
        durationMinutes: prev.edited ? prev.durationMinutes : g.durationMinutes,
        signupId: g.signupId ?? null,
      };
      if (!prev.edited) {
        patch.kind = g.kind;
        patch.title = g.title;
        patch.notes = g.notes;
      }
      await db.update(runOfShow).set(patch).where(eq(runOfShow.id, prev.id));
    }

    const orphans = existing.filter((r) => r.sourceKey && !wanted.has(r.sourceKey) && !r.edited);
    for (const o of orphans) await db.delete(runOfShow).where(eq(runOfShow.id, o.id));

    // Re-sort: timed rows in chronological order, untimed ones after.
    const all = await db.select().from(runOfShow).where(eq(runOfShow.eventId, eventId));
    all.sort((a, b) => {
      if (!a.startAtUtc && !b.startAtUtc) return a.sortIndex - b.sortIndex;
      if (!a.startAtUtc) return 1;
      if (!b.startAtUtc) return -1;
      const d = a.startAtUtc.localeCompare(b.startAtUtc);
      return d !== 0 ? d : a.sortIndex - b.sortIndex;
    });
    for (let i = 0; i < all.length; i++) {
      if (all[i].sortIndex !== i) await db.update(runOfShow).set({ sortIndex: i }).where(eq(runOfShow.id, all[i].id));
    }
    return this.listRunOfShow(eventId);
  }

  async createRunItem(eventId: number, item: RunItemInput, sortIndex: number): Promise<RunItemRow> {
    await ready();
    const [row] = await db
      .insert(runOfShow)
      .values({ ...item, signupId: item.signupId ?? null, eventId, sortIndex, createdAt: new Date().toISOString() })
      .returning();
    return row;
  }

  async updateRunItem(id: number, patch: Partial<RunItemInput> & { sortIndex?: number }): Promise<RunItemRow | undefined> {
    await ready();
    const [row] = await db.update(runOfShow).set(patch).where(eq(runOfShow.id, id)).returning();
    return row;
  }

  async deleteRunItem(id: number): Promise<void> {
    await ready();
    await db.delete(runOfShow).where(eq(runOfShow.id, id));
  }

  async createPlatformInterest(v: Omit<PlatformInterestRow, "id" | "handled" | "createdAt">): Promise<PlatformInterestRow> {
    await ready();
    const [row] = await db
      .insert(platformInterest)
      .values({ ...v, email: v.email.trim().toLowerCase(), handled: false, createdAt: new Date().toISOString() })
      .returning();
    return row;
  }

  async listPlatformInterest(): Promise<PlatformInterestRow[]> {
    await ready();
    return db.select().from(platformInterest).orderBy(desc(platformInterest.id));
  }

  /** One studio per event, made on first use so admin never has to create it. */
  async getOrCreateStudio(eventId: number): Promise<StudioRow> {
    await ready();
    const [found] = await db.select().from(studios).where(eq(studios.eventId, eventId));
    if (found) return found;
    const now = new Date().toISOString();
    const [created] = await db
      .insert(studios)
      .values({ eventId, name: "Main studio", createdAt: now, updatedAt: now })
      .returning();
    return created;
  }

  /**
   * Every studio for an event, oldest first. The oldest is the event's own —
   * the one the schedule and run of show belong to. Anything after it is a
   * side room someone made on purpose.
   */
  async listStudios(eventId: number): Promise<StudioRow[]> {
    await ready();
    return db.select().from(studios).where(eq(studios.eventId, eventId)).orderBy(asc(studios.id));
  }

  async getStudioById(id: number): Promise<StudioRow | undefined> {
    await ready();
    const [row] = await db.select().from(studios).where(eq(studios.id, id));
    return row;
  }

  async createStudio(eventId: number, name: string): Promise<StudioRow> {
    await ready();
    const now = new Date().toISOString();
    const [row] = await db
      .insert(studios)
      .values({ eventId, name: name.trim() || "New studio", createdAt: now, updatedAt: now })
      .returning();
    return row;
  }

  async deleteStudio(id: number): Promise<void> {
    await ready();
    await db.delete(studioParticipants).where(eq(studioParticipants.studioId, id));
    await db.delete(studios).where(eq(studios.id, id));
  }

  // ---- Scenes -------------------------------------------------------------
  async listScenes(studioId: number): Promise<SceneRow[]> {
    await ready();
    return db.select().from(scenes).where(eq(scenes.studioId, studioId)).orderBy(asc(scenes.sortIndex), asc(scenes.id));
  }

  async getScene(id: number): Promise<SceneRow | undefined> {
    await ready();
    const [row] = await db.select().from(scenes).where(eq(scenes.id, id));
    return row;
  }

  async createScene(v: Omit<SceneRow, "id" | "createdAt">): Promise<SceneRow> {
    await ready();
    const [row] = await db.insert(scenes).values({ ...v, createdAt: new Date().toISOString() }).returning();
    return row;
  }

  async deleteScene(id: number): Promise<void> {
    await ready();
    await db.delete(scenes).where(eq(scenes.id, id));
  }

  // ---- YouTube ------------------------------------------------------------
  async listNudgesForSignups(signupIds: number[]): Promise<NudgeRow[]> {
    await ready();
    if (signupIds.length === 0) return [];
    return db.select().from(nudges).where(inArray(nudges.signupId, signupIds));
  }

  async claimNudge(signupId: number, kind: NudgeKind, emailed: boolean): Promise<boolean> {
    await ready();
    // Claim it before sending, not after: if the send then fails we would
    // rather miss one nudge than send it twice on the next run.
    const rows = await db
      .insert(nudges)
      .values({ signupId, kind, emailed, sentAt: new Date().toISOString() })
      .onConflictDoNothing({ target: [nudges.signupId, nudges.kind] })
      .returning({ id: nudges.id });
    return rows.length > 0;
  }

  async releaseNudge(signupId: number, kind: NudgeKind): Promise<void> {
    await ready();
    await db.delete(nudges).where(and(eq(nudges.signupId, signupId), eq(nudges.kind, kind)));
  }

  async createHelpRequest(v: { name: string; email: string; question: string; transcript: string; page: string }): Promise<HelpRequestRow> {
    await ready();
    const [row] = await db.insert(helpRequests).values({ ...v, status: "open", createdAt: new Date().toISOString() }).returning();
    return row;
  }

  async listHelpRequests(): Promise<HelpRequestRow[]> {
    await ready();
    return db.select().from(helpRequests).orderBy(desc(helpRequests.id));
  }

  async listAllStudios(): Promise<StudioRow[]> {
    await ready();
    return db.select().from(studios).orderBy(asc(studios.id));
  }

  async listCampaignPosts(signupId: number): Promise<CampaignPostRow[]> {
    await ready();
    return db.select().from(campaignPosts).where(eq(campaignPosts.signupId, signupId));
  }

  async replaceCampaignPlan(
    signupId: number,
    picks: { kind: string; platforms: string[]; scheduledFor: string }[],
  ): Promise<CampaignPostRow[]> {
    await ready();
    const now = new Date().toISOString();
    const existing = await this.listCampaignPosts(signupId);
    const wanted = new Set(picks.map((p) => p.kind));
    // Unticked: drop it unless it has already gone out (that's history, not a plan).
    for (const row of existing) {
      if (!wanted.has(row.kind) && row.status !== "posted" && row.status !== "posting") {
        await db.delete(campaignPosts).where(eq(campaignPosts.id, row.id));
      }
    }
    for (const pick of picks) {
      const row = existing.find((r) => r.kind === pick.kind);
      const platforms = pick.platforms.join(",");
      if (!row) {
        await db.insert(campaignPosts).values({
          signupId, kind: pick.kind, platforms, scheduledFor: pick.scheduledFor,
          status: "planned", createdAt: now, updatedAt: now,
        });
      } else if (row.status === "planned" || row.status === "failed") {
        await db.update(campaignPosts)
          .set({ platforms, scheduledFor: pick.scheduledFor, status: "planned", error: "", updatedAt: now })
          .where(eq(campaignPosts.id, row.id));
      }
    }
    return this.listCampaignPosts(signupId);
  }

  async listDueCampaignPosts(nowIso: string): Promise<CampaignPostRow[]> {
    await ready();
    const rows = await db.select().from(campaignPosts).where(eq(campaignPosts.status, "planned"));
    return rows.filter((r) => r.scheduledFor <= nowIso);
  }

  async claimCampaignPost(id: number): Promise<boolean> {
    await ready();
    const rows = await db.update(campaignPosts)
      .set({ status: "posting", updatedAt: new Date().toISOString() })
      .where(and(eq(campaignPosts.id, id), eq(campaignPosts.status, "planned")))
      .returning({ id: campaignPosts.id });
    return rows.length > 0;
  }

  async finishCampaignPost(id: number, ok: boolean, error = ""): Promise<void> {
    await ready();
    const now = new Date().toISOString();
    await db.update(campaignPosts)
      .set(ok ? { status: "posted", postedAt: now, error: "", updatedAt: now } : { status: "failed", error: error.slice(0, 500), updatedAt: now })
      .where(eq(campaignPosts.id, id));
  }

  async getEventShow(email: string, eventId: number): Promise<EventShowRow | undefined> {
    await ready();
    const [row] = await db
      .select()
      .from(eventShows)
      .where(and(eq(eventShows.email, email.toLowerCase().trim()), eq(eventShows.eventId, eventId)));
    return row;
  }

  async listEventShows(email: string): Promise<EventShowRow[]> {
    await ready();
    return db.select().from(eventShows).where(eq(eventShows.email, email.toLowerCase().trim()));
  }

  async upsertEventShow(email: string, eventId: number, v: Partial<EventShowRow>): Promise<EventShowRow> {
    await ready();
    const key = email.toLowerCase().trim();
    const now = new Date().toISOString();
    const existing = await this.getEventShow(key, eventId);
    if (existing) {
      const [row] = await db
        .update(eventShows)
        .set({ ...v, email: key, eventId, updatedAt: now })
        .where(eq(eventShows.id, existing.id))
        .returning();
      return row;
    }
    const [row] = await db
      .insert(eventShows)
      .values({
        // Spread first: enumerating the columns here meant every field added
        // later was silently dropped on create and only stuck on a second
        // save. interviewNeed was lost exactly that way.
        ...v,
        email: key,
        eventId,
        showName: v.showName ?? "",
        showFormat: v.showFormat ?? "live",
        recordingUrl: v.recordingUrl ?? "",
        introStyle: v.introStyle ?? "virtual",
        imageUrl: v.imageUrl ?? "",
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    return row;
  }

  async getYoutubeAccount(email: string): Promise<YoutubeAccountRow | undefined> {
    await ready();
    const [row] = await db.select().from(youtubeAccounts).where(eq(youtubeAccounts.email, email.toLowerCase().trim()));
    return row;
  }

  async upsertYoutubeAccount(
    email: string,
    v: Partial<YoutubeAccountRow> & { refreshToken: string },
  ): Promise<YoutubeAccountRow> {
    await ready();
    const key = email.toLowerCase().trim();
    const existing = await this.getYoutubeAccount(key);
    if (existing) {
      const [row] = await db
        .update(youtubeAccounts)
        .set({ ...v, email: key })
        .where(eq(youtubeAccounts.id, existing.id))
        .returning();
      return row;
    }
    const [row] = await db
      .insert(youtubeAccounts)
      .values({ ...v, email: key, createdAt: new Date().toISOString() })
      .returning();
    return row;
  }

  async deleteYoutubeAccount(email: string): Promise<void> {
    await ready();
    await db.delete(youtubeAccounts).where(eq(youtubeAccounts.email, email.toLowerCase().trim()));
  }

  async updateStudio(id: number, patch: Partial<StudioRow>): Promise<StudioRow | undefined> {
    await ready();
    const [row] = await db
      .update(studios)
      .set({ ...patch, updatedAt: new Date().toISOString() })
      .where(eq(studios.id, id))
      .returning();
    return row;
  }

  async listStudioParticipants(studioId: number): Promise<StudioParticipantRow[]> {
    await ready();
    return db
      .select()
      .from(studioParticipants)
      .where(eq(studioParticipants.studioId, studioId))
      .orderBy(asc(studioParticipants.id));
  }

  async upsertStudioParticipant(
    studioId: number,
    clientKey: string,
    v: Partial<StudioParticipantRow>,
  ): Promise<StudioParticipantRow> {
    await ready();
    const now = new Date().toISOString();
    const [existing] = await db
      .select()
      .from(studioParticipants)
      .where(and(eq(studioParticipants.studioId, studioId), eq(studioParticipants.clientKey, clientKey)));
    if (existing) {
      const [row] = await db
        .update(studioParticipants)
        .set({ ...v, lastSeenAt: now })
        .where(eq(studioParticipants.id, existing.id))
        .returning();
      return row;
    }
    const [row] = await db
      .insert(studioParticipants)
      .values({
        studioId,
        clientKey,
        displayName: v.displayName ?? "",
        email: v.email ?? "",
        role: v.role ?? "Speaker",
        state: v.state ?? "Green room",
        camReady: v.camReady ?? false,
        micReady: v.micReady ?? false,
        lastSeenAt: now,
        createdAt: now,
      })
      .returning();
    return row;
  }

  async setParticipantState(id: number, state: string): Promise<StudioParticipantRow | undefined> {
    await ready();
    const [row] = await db.update(studioParticipants).set({ state }).where(eq(studioParticipants.id, id)).returning();
    return row;
  }

  async removeStudioParticipant(id: number): Promise<void> {
    await ready();
    await db.delete(studioParticipants).where(eq(studioParticipants.id, id));
  }

  // ---- Recordings ------------------------------------------------------------
  async createRecording(v: {
    eventId: number;
    studioId: number;
    signupId?: number | null;
    email: string;
    title: string;
    egressId: string;
    filepath: string;
  }): Promise<RecordingRow> {
    await ready();
    const [row] = await db
      .insert(recordings)
      .values({
        eventId: v.eventId,
        studioId: v.studioId,
        signupId: v.signupId ?? null,
        email: v.email,
        title: v.title,
        egressId: v.egressId,
        status: "Recording",
        // Where we told LiveKit to put it. The webhook usually confirms the
        // path back to us, but not always — and the file is there either way.
        url: v.filepath,
        startedAt: new Date().toISOString(),
      })
      .returning();
    return row;
  }

  /** Called from the LiveKit webhook, so it has to be safe to run twice. */
  async finishRecording(
    egressId: string,
    v: { status: string; url?: string; durationSec?: number; sizeBytes?: string; error?: string },
  ): Promise<RecordingRow | undefined> {
    await ready();
    const [existing] = await db.select().from(recordings).where(eq(recordings.egressId, egressId));
    const [row] = await db
      .update(recordings)
      .set({
        status: v.status,
        url: v.url || existing?.url || "",
        durationSec: v.durationSec ?? 0,
        sizeBytes: v.sizeBytes ?? "0",
        error: (v.error ?? "").slice(0, 500),
        endedAt: new Date().toISOString(),
      })
      .where(eq(recordings.egressId, egressId))
      .returning();
    return row;
  }

  async listRecordingsByEmail(email: string): Promise<RecordingRow[]> {
    await ready();
    return db
      .select()
      .from(recordings)
      .where(eq(recordings.email, email.toLowerCase().trim()))
      .orderBy(desc(recordings.startedAt));
  }

  async listRecordings(eventId?: number): Promise<RecordingRow[]> {
    await ready();
    const q = db.select().from(recordings);
    const rows = eventId ? await q.where(eq(recordings.eventId, eventId)) : await q;
    return rows.sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1));
  }

  async getRecording(id: number): Promise<RecordingRow | undefined> {
    await ready();
    const [row] = await db.select().from(recordings).where(eq(recordings.id, id));
    return row;
  }

  // ---- Destinations ----------------------------------------------------------
  async listDestinations(eventId: number): Promise<DestinationRow[]> {
    await ready();
    return db.select().from(destinations).where(eq(destinations.eventId, eventId)).orderBy(asc(destinations.id));
  }

  async getDestination(id: number): Promise<DestinationRow | undefined> {
    await ready();
    const [row] = await db.select().from(destinations).where(eq(destinations.id, id));
    return row;
  }

  async createDestination(eventId: number, ownerEmail: string, v: DestinationInput): Promise<DestinationRow> {
    await ready();
    const [row] = await db
      .insert(destinations)
      .values({
        eventId,
        signupId: v.signupId ?? null,
        ownerEmail: ownerEmail.toLowerCase().trim(),
        platform: v.platform,
        label: v.label,
        rtmpUrl: v.rtmpUrl,
        streamKey: v.streamKey,
        enabled: v.enabled,
        createdAt: new Date().toISOString(),
      })
      .returning();
    return row;
  }

  async updateDestination(id: number, patch: Partial<DestinationRow>): Promise<DestinationRow | undefined> {
    await ready();
    const [row] = await db.update(destinations).set(patch).where(eq(destinations.id, id)).returning();
    return row;
  }

  async deleteDestination(id: number): Promise<void> {
    await ready();
    await db.delete(destinations).where(eq(destinations.id, id));
  }

  // ---- Ingress -----------------------------------------------------------------
  async listIngresses(eventId: number): Promise<IngressRow[]> {
    await ready();
    return db.select().from(ingresses).where(eq(ingresses.eventId, eventId)).orderBy(asc(ingresses.id));
  }

  async getIngressByEmail(email: string): Promise<IngressRow | undefined> {
    await ready();
    const [row] = await db.select().from(ingresses).where(eq(ingresses.ownerEmail, email.toLowerCase().trim()));
    return row;
  }

  async getIngressRow(id: number): Promise<IngressRow | undefined> {
    await ready();
    const [row] = await db.select().from(ingresses).where(eq(ingresses.id, id));
    return row;
  }

  async createIngressRow(v: Omit<IngressRow, "id" | "createdAt">): Promise<IngressRow> {
    await ready();
    const [row] = await db
      .insert(ingresses)
      .values({ ...v, createdAt: new Date().toISOString() })
      .returning();
    return row;
  }

  async deleteIngressRow(id: number): Promise<void> {
    await ready();
    await db.delete(ingresses).where(eq(ingresses.id, id));
  }

  async getSetting(key: string): Promise<string | null> {
    await ready();
    const [row] = await db.select().from(siteSettings).where(eq(siteSettings.key, key));
    return row?.value ?? null;
  }

  async setSetting(key: string, value: string): Promise<void> {
    await ready();
    const existing = await this.getSetting(key);
    if (existing === null) {
      await db.insert(siteSettings).values({ key, value });
    } else {
      await db.update(siteSettings).set({ value }).where(eq(siteSettings.key, key));
    }
  }

  async createSponsorInquiry(data: InsertSponsorInquiry): Promise<SponsorInquiryRow> {
    await ready();
    const [created] = await db
      .insert(sponsorInquiries)
      .values({ ...data, createdAt: new Date().toISOString() })
      .returning();
    return created;
  }

  async listSponsorInquiries(): Promise<SponsorInquiryRow[]> {
    await ready();
    return db.select().from(sponsorInquiries).orderBy(desc(sponsorInquiries.id));
  }

  async setSponsorInquiryHandled(id: number, handled: boolean): Promise<void> {
    await ready();
    await db.update(sponsorInquiries).set({ handled }).where(eq(sponsorInquiries.id, id));
  }

  async listAdmins(): Promise<AdminUserRow[]> {
    await ready();
    return db.select().from(adminUsers).orderBy(asc(adminUsers.id));
  }

  async isAdminEmail(email: string): Promise<boolean> {
    await ready();
    const [row] = await db.select().from(adminUsers).where(eq(adminUsers.email, email.trim().toLowerCase()));
    return !!row;
  }

  async addAdmin(email: string, name: string): Promise<AdminUserRow> {
    await ready();
    const normalized = email.trim().toLowerCase();
    const [existing] = await db.select().from(adminUsers).where(eq(adminUsers.email, normalized));
    if (existing) return existing;
    const [created] = await db
      .insert(adminUsers)
      .values({ email: normalized, name: name.trim(), isOwner: false, createdAt: new Date().toISOString() })
      .returning();
    return created;
  }

  /** Owners can't be removed, and the last admin can't be removed. */
  async removeAdmin(id: number): Promise<{ removed: boolean; reason?: string }> {
    await ready();
    const all = await this.listAdmins();
    const target = all.find((a) => a.id === id);
    if (!target) return { removed: false, reason: "That teammate isn't on the list." };
    if (target.isOwner) return { removed: false, reason: "The account owner can't be removed." };
    if (all.length <= 1) return { removed: false, reason: "You can't remove the last admin." };
    await db.delete(adminUsers).where(eq(adminUsers.id, id));
    return { removed: true };
  }

  async listSponsors(activeOnly: boolean, eventIds?: number[]): Promise<SponsorRow[]> {
    await ready();
    const conds = [];
    if (activeOnly) conds.push(eq(sponsors.active, true));
    if (eventIds && eventIds.length) conds.push(inArray(sponsors.eventId, eventIds));
    const q = db.select().from(sponsors);
    const rows = conds.length
      ? await q.where(and(...conds)).orderBy(asc(sponsors.sortOrder), asc(sponsors.id))
      : await q.orderBy(asc(sponsors.sortOrder), asc(sponsors.id));
    return rows;
  }

  async createSponsor(data: { name: string; url: string; logoUrl: string; eventId: number }): Promise<SponsorRow> {
    await ready();
    const existing = await this.listSponsors(false, [data.eventId, 0]);
    const sortOrder = existing.length ? Math.max(...existing.map((s) => s.sortOrder)) + 1 : 0;
    const [created] = await db
      .insert(sponsors)
      .values({ ...data, sortOrder, active: true, createdAt: new Date().toISOString() })
      .returning();
    return created;
  }

  async updateSponsor(id: number, patch: UpdateSponsor): Promise<SponsorRow | undefined> {
    await ready();
    const [updated] = await db.update(sponsors).set(patch).where(eq(sponsors.id, id)).returning();
    return updated;
  }

  async deleteSponsor(id: number): Promise<void> {
    await ready();
    await db.delete(sponsors).where(eq(sponsors.id, id));
  }

  /**
   * A signup stores its own copy of the podcaster's details, taken when the
   * slot was claimed, so the public agenda can be read without joining. That
   * copy goes stale the moment someone edits their profile — push the new
   * values onto every slot they still hold. Slot, event, timezone and status
   * belong to the booking, not the profile, so they're left alone.
   */
  async syncSignupsFromProfile(email: string, profile: ProfileRow): Promise<number> {
    await ready();
    const key = email.trim().toLowerCase();
    // Everything here is about the person, so it flows to every slot they
    // hold. What the show is called, its format and its artwork belong to the
    // event now — writing them from the profile would undo the per-event
    // setup, so they are deliberately absent.
    const rows = await db
      .update(signups)
      .set({
        hostName: profile.hostName,
        phone: profile.phone,
        numPeople: profile.numPeople,
        hasVideoIntro: profile.hasVideoIntro,
        hasVideoOutro: profile.hasVideoOutro,
        hasSlides: profile.hasSlides,
        hasImages: profile.hasImages,
        needsInterviewer: profile.needsInterviewer,
        socialLinks: profile.socialLinks,
        rssUrl: profile.rssUrl,
        youtubeUrl: profile.youtubeUrl,
        socialAccounts: profile.socialAccounts,
        branch: profile.branch,
        serviceStatus: profile.serviceStatus,
        recordingMode: profile.recordingMode,
        postEdits: profile.postEdits,
        streamPlatform: profile.streamPlatform,
        streamPlatformOther: profile.streamPlatformOther,
        guests: profile.guests,
        interviewQuestions: profile.interviewQuestions,
        promoNotes: profile.promoNotes,
        notes: profile.notes,
      })
      .where(and(eq(signups.email, key), ne(signups.status, "cancelled")))
      .returning({ id: signups.id, eventId: signups.eventId });

    // The lineup photo is the show's artwork where there is one, and the
    // person's own photo otherwise — so a changed profile photo still reaches
    // the slots that have no artwork of their own.
    const shows = await this.listEventShows(key);
    for (const row of rows) {
      const art = shows.find((sh) => sh.eventId === row.eventId)?.imageUrl;
      await db
        .update(signups)
        .set({ photoUrl: art || profile.photoUrl })
        .where(eq(signups.id, row.id));
    }
    return rows.length;
  }

  /** Push one event's show record onto the slot held for that event. */
  async syncSignupsFromEventShow(email: string, eventId: number, show: EventShowRow): Promise<number> {
    await ready();
    const key = email.trim().toLowerCase();
    const profile = await this.getProfileByEmail(key);
    const rows = await db
      .update(signups)
      .set({
        podcastName: show.showName,
        showFormat: show.showFormat,
        recordingUrl: show.recordingUrl,
        introStyle: show.introStyle,
        photoUrl: show.imageUrl || profile?.photoUrl || "",
        // Keep the boolean the run of show and the admin views already read.
        // Only a live slot can want an interviewer.
        needsInterviewer: show.showFormat === "live" && show.interviewNeed === "interview_me",
      })
      .where(and(eq(signups.email, key), eq(signups.eventId, eventId), ne(signups.status, "cancelled")))
      .returning({ id: signups.id });
    return rows.length;
  }

  async updateSignupSocialAccountsByEmail(email: string, socialAccountsJson: string): Promise<void> {
    await ready();
    await db
      .update(signups)
      .set({ socialAccounts: socialAccountsJson })
      .where(eq(signups.email, email.trim().toLowerCase()));
  }

  async upsertProfile(
    email: string,
    patch: Partial<InsertProfile> & { photoUrl?: string; uploadPostUsername?: string; socialAccounts?: string },
  ): Promise<ProfileRow> {
    await ready();
    const normalizedEmail = email.trim().toLowerCase();
    const now = new Date().toISOString();
    const existing = await this.getProfileByEmail(normalizedEmail);
    if (existing) {
      const [updated] = await db
        .update(podcasterProfiles)
        .set({ ...patch, updatedAt: now })
        .where(eq(podcasterProfiles.email, normalizedEmail))
        .returning();
      return updated;
    }
    const [created] = await db
      .insert(podcasterProfiles)
      .values({
        email: normalizedEmail,
        podcastName: patch.podcastName ?? "",
        hostName: patch.hostName ?? "",
        phone: patch.phone ?? "",
        numPeople: patch.numPeople ?? 1,
        hasVideoIntro: patch.hasVideoIntro ?? false,
        hasVideoOutro: patch.hasVideoOutro ?? false,
        hasSlides: patch.hasSlides ?? false,
        hasImages: patch.hasImages ?? false,
        needsInterviewer: patch.needsInterviewer ?? false,
        socialLinks: patch.socialLinks ?? "",
        rssUrl: patch.rssUrl ?? "",
        youtubeUrl: patch.youtubeUrl ?? "",
        uploadPostUsername: patch.uploadPostUsername ?? "",
        socialAccounts: patch.socialAccounts ?? "",
        showFormat: patch.showFormat ?? "live",
        recordingUrl: patch.recordingUrl ?? "",
        introStyle: patch.introStyle ?? "virtual",
        branch: patch.branch ?? "",
        serviceStatus: patch.serviceStatus ?? "",
        recordingMode: patch.recordingMode ?? "",
        postEdits: patch.postEdits ?? "",
        streamPlatform: patch.streamPlatform ?? "",
        streamPlatformOther: patch.streamPlatformOther ?? "",
        guests: patch.guests ?? "",
        interviewQuestions: patch.interviewQuestions ?? "",
        promoNotes: patch.promoNotes ?? "",
        notes: patch.notes ?? "",
        photoUrl: patch.photoUrl ?? "",
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    return created;
  }

  // -------------------------------------------------------------------------
  // CRM — contacts
  // -------------------------------------------------------------------------

  async listContacts(): Promise<ContactRow[]> {
    await ready();
    return db.select().from(contacts).orderBy(desc(contacts.importedAt));
  }

  async upsertContacts(rows: { email: string; firstName: string; lastName: string; source: string }[]): Promise<{ inserted: number; updated: number }> {
    await ready();
    let inserted = 0;
    let updated = 0;
    const now = new Date().toISOString();
    const { sql } = getConnection();
    for (const row of rows) {
      const res = (await sql`
        INSERT INTO contacts (email, first_name, last_name, source, status, imported_at)
        VALUES (${row.email.toLowerCase().trim()}, ${row.firstName}, ${row.lastName}, ${row.source}, 'active', ${now})
        ON CONFLICT (email) DO UPDATE SET first_name = EXCLUDED.first_name, last_name = EXCLUDED.last_name
        RETURNING (xmax = 0) AS was_inserted
      `) as { was_inserted: boolean }[];
      if (res[0]?.was_inserted) inserted++;
      else updated++;
    }
    return { inserted, updated };
  }

  async deleteContact(id: number): Promise<void> {
    await ready();
    await db.delete(contacts).where(eq(contacts.id, id));
  }

  async unsubscribeContact(email: string): Promise<void> {
    await ready();
    await db.update(contacts).set({ status: "unsubscribed" }).where(eq(contacts.email, email.toLowerCase().trim()));
  }

  async listActiveContactEmails(): Promise<{ id: number; email: string; firstName: string }[]> {
    await ready();
    const rows = await db.select({ id: contacts.id, email: contacts.email, firstName: contacts.firstName })
      .from(contacts).where(eq(contacts.status, "active")).orderBy(contacts.id);
    return rows;
  }

  // -------------------------------------------------------------------------
  // CRM — broadcasts
  // -------------------------------------------------------------------------

  async listBroadcasts(eventId?: number | null): Promise<BroadcastRow[]> {
    await ready();
    if (eventId != null) {
      return db.select().from(broadcasts).where(eq(broadcasts.eventId, eventId)).orderBy(desc(broadcasts.createdAt));
    }
    return db.select().from(broadcasts).where(isNull(broadcasts.eventId)).orderBy(desc(broadcasts.createdAt));
  }

  async listSignupContactsForEvent(eventId: number): Promise<{ email: string; firstName: string }[]> {
    await ready();
    const rows = await db.select({ email: signups.email, hostName: signups.hostName })
      .from(signups)
      .where(and(eq(signups.eventId, eventId), ne(signups.status, "cancelled")));
    return rows.map((r) => ({ email: r.email, firstName: r.hostName.split(" ")[0] }));
  }

  async createBroadcast(data: { subject: string; bodyText: string; eventId?: number | null; segment?: string; sender?: string; banner?: string }): Promise<BroadcastRow> {
    await ready();
    const [row] = await db.insert(broadcasts).values({
      subject: data.subject,
      bodyText: data.bodyText,
      eventId: data.eventId ?? null,
      segment: data.segment ?? "contacts",
      sender: data.sender ?? "team",
      banner: data.banner ?? "welcome",
      status: "draft",
      createdAt: new Date().toISOString(),
    }).returning();
    return row;
  }

  async updateBroadcast(id: number, data: { subject?: string; bodyText?: string; segment?: string; sender?: string; banner?: string }): Promise<BroadcastRow | null> {
    await ready();
    const patch: Partial<BroadcastRow> = {};
    if (data.subject !== undefined) patch.subject = data.subject;
    if (data.bodyText !== undefined) patch.bodyText = data.bodyText;
    if (data.segment !== undefined) patch.segment = data.segment;
    if (data.sender !== undefined) patch.sender = data.sender;
    if (data.banner !== undefined) patch.banner = data.banner;
    if (Object.keys(patch).length === 0) return null;
    const [row] = await db.update(broadcasts).set(patch).where(and(eq(broadcasts.id, id), eq(broadcasts.status, "draft"))).returning();
    return row ?? null;
  }

  async markBroadcastSent(id: number, recipientCount: number): Promise<void> {
    await ready();
    await db.update(broadcasts).set({ status: "sent", recipientCount, sentAt: new Date().toISOString() }).where(eq(broadcasts.id, id));
  }

  async deleteBroadcast(id: number): Promise<void> {
    await ready();
    await db.delete(broadcasts).where(and(eq(broadcasts.id, id), eq(broadcasts.status, "draft")));
  }

  // ── Event team ────────────────────────────────────────────────────────────

  async listEventTeam(eventId: number): Promise<EventTeamMember[]> {
    await ready();
    return db.select().from(eventTeam).where(eq(eventTeam.eventId, eventId)).orderBy(eventTeam.createdAt);
  }

  async addTeamMember(eventId: number, data: { name: string; title: string; email?: string; photoUrl?: string }): Promise<EventTeamMember> {
    await ready();
    const [row] = await db.insert(eventTeam).values({
      eventId,
      name: data.name,
      title: data.title,
      email: data.email ?? "",
      photoUrl: data.photoUrl ?? "",
      createdAt: new Date().toISOString(),
    }).returning();
    return row;
  }

  async updateTeamMember(id: number, data: { name?: string; title?: string; email?: string; photoUrl?: string }): Promise<EventTeamMember | null> {
    await ready();
    const patch: Record<string, unknown> = {};
    if (data.name !== undefined) patch.name = data.name;
    if (data.title !== undefined) patch.title = data.title;
    if (data.email !== undefined) patch.email = data.email;
    if (data.photoUrl !== undefined) patch.photoUrl = data.photoUrl;
    if (Object.keys(patch).length === 0) return null;
    const [row] = await db.update(eventTeam).set(patch as any).where(eq(eventTeam.id, id)).returning();
    return row ?? null;
  }

  async deleteTeamMember(id: number): Promise<void> {
    await ready();
    await db.delete(eventTeam).where(eq(eventTeam.id, id));
  }

  async getTeamMember(id: number): Promise<EventTeamMember | null> {
    await ready();
    const [row] = await db.select().from(eventTeam).where(eq(eventTeam.id, id));
    return row ?? null;
  }

  async recordBroadcastSend(broadcastId: number, email: string, resendId: string): Promise<void> {
    await ready();
    await db.insert(broadcastSends).values({ broadcastId, email, resendId, sentAt: new Date().toISOString() });
  }

  async recordBroadcastEvent(resendId: string, eventType: string, occurredAt: string, url?: string): Promise<void> {
    await ready();
    await db.insert(broadcastEvents).values({ resendId, eventType, occurredAt, url: url ?? "" });
  }

  async getBroadcastStats(broadcastId: number): Promise<{ sent: number; delivered: number; opened: number; clicked: number; bounced: number }> {
    await ready();
    const sends = await db.select().from(broadcastSends).where(eq(broadcastSends.broadcastId, broadcastId));
    const ids = sends.map((s) => s.resendId).filter(Boolean);
    if (ids.length === 0) return { sent: 0, delivered: 0, opened: 0, clicked: 0, bounced: 0 };
    const events = await db.select().from(broadcastEvents).where(inArray(broadcastEvents.resendId, ids));
    const count = (type: string) => new Set(events.filter((e) => e.eventType === type).map((e) => e.resendId)).size;
    return { sent: sends.length, delivered: count("delivered"), opened: count("opened"), clicked: count("clicked"), bounced: count("bounced") };
  }

  async getBroadcastSendsByEngagement(broadcastId: number, types: string[]): Promise<{ email: string; resendId: string }[]> {
    await ready();
    const sends = await db.select().from(broadcastSends).where(eq(broadcastSends.broadcastId, broadcastId));
    const ids = sends.map((s) => s.resendId).filter(Boolean);
    if (ids.length === 0) return [];
    const events = await db.select().from(broadcastEvents).where(
      and(inArray(broadcastEvents.resendId, ids), inArray(broadcastEvents.eventType, types))
    );
    const engagedIds = new Set(events.map((e) => e.resendId));
    return sends.filter((s) => engagedIds.has(s.resendId)).map((s) => ({ email: s.email, resendId: s.resendId }));
  }
}

export const storage = new DatabaseStorage();
