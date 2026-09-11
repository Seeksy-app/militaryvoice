import { events, signups, reminders, loginTokens, podcasterProfiles } from "../shared/schema.js";
import type {
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
} from "../shared/schema.js";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { and, eq, ne } from "drizzle-orm";

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

    // `prepare: false` is required for connecting through Supabase's transaction
    // pooler (pgbouncer), which doesn't support prepared statements.
    _sql = postgres(CONNECTION_STRING, { prepare: false });
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
async function ensureSchemaSafe(attempt = 0): Promise<void> {
  try {
    await ensureSchema();
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
  createLoginToken(email: string, token: string, expiresAt: string): Promise<LoginTokenRow>;
  getLoginToken(email: string, token: string): Promise<LoginTokenRow | undefined>;
  markLoginTokenUsed(id: number): Promise<void>;
  getProfileByEmail(email: string): Promise<ProfileRow | undefined>;
  upsertProfile(
    email: string,
    patch: Partial<InsertProfile> & { photoUrl?: string; uploadPostUsername?: string; socialAccounts?: string },
  ): Promise<ProfileRow>;
  updateSignupSocialAccountsByEmail(email: string, socialAccountsJson: string): Promise<void>;
  listCompleteProfiles(): Promise<ProfileRow[]>;
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
    const [created] = await db
      .insert(events)
      .values({ ...data, createdAt: new Date().toISOString() })
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
        notes: patch.notes ?? "",
        photoUrl: patch.photoUrl ?? "",
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    return created;
  }
}

export const storage = new DatabaseStorage();
