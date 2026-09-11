import { events, signups, reminders, watchSignups, loginTokens } from "../shared/schema.js";
import type {
  EventRow,
  InsertEvent,
  UpdateEvent,
  SignupRow,
  InsertSignup,
  ReminderRow,
  InsertReminder,
  WatchSignupRow,
  InsertWatchSignup,
  LoginTokenRow,
} from "../shared/schema.js";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { eq } from "drizzle-orm";

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
    CREATE TABLE IF NOT EXISTS watch_signups (
      id SERIAL PRIMARY KEY,
      email TEXT NOT NULL,
      confirmation_code TEXT NOT NULL,
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

  // Migrate older databases created before these columns existed.
  await sql`ALTER TABLE signups ADD COLUMN IF NOT EXISTS photo_url TEXT NOT NULL DEFAULT ''`;
  await sql`ALTER TABLE events ADD COLUMN IF NOT EXISTS on_air_minutes INTEGER NOT NULL DEFAULT 25`;
  await sql`ALTER TABLE events ADD COLUMN IF NOT EXISTS buffer_minutes INTEGER NOT NULL DEFAULT 5`;
  await sql`ALTER TABLE events ADD COLUMN IF NOT EXISTS buffer_position TEXT NOT NULL DEFAULT 'after'`;
}

let schemaReady: Promise<void> | null = null;
function ready(): Promise<void> {
  if (!schemaReady) {
    schemaReady = ensureSchema().catch((err) => {
      schemaReady = null;
      throw err;
    });
  }
  return schemaReady;
}

export interface IStorage {
  getEvent(): Promise<EventRow>;
  updateEvent(patch: UpdateEvent): Promise<EventRow>;
  listSignups(): Promise<SignupRow[]>;
  getSignupBySlot(slotIndex: number): Promise<SignupRow | undefined>;
  createSignup(signup: InsertSignup): Promise<SignupRow>;
  cancelSignup(id: number): Promise<SignupRow | undefined>;
  deleteSignup(id: number): Promise<{ changes: number }>;
  getSignupById(id: number): Promise<SignupRow | undefined>;
  createReminder(reminder: InsertReminder): Promise<ReminderRow>;
  listReminders(): Promise<ReminderRow[]>;
  createWatchSignup(signup: InsertWatchSignup): Promise<WatchSignupRow>;
  listWatchSignups(): Promise<WatchSignupRow[]>;
  createLoginToken(email: string, token: string, expiresAt: string): Promise<LoginTokenRow>;
  getLoginToken(token: string): Promise<LoginTokenRow | undefined>;
  markLoginTokenUsed(id: number): Promise<void>;
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
  private async ensureEvent(): Promise<EventRow> {
    await ready();
    const [row] = await db.select().from(events).where(eq(events.id, 1));
    if (row) return row;
    const [created] = await db
      .insert(events)
      .values({
        id: 1,
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
      })
      .returning();
    return created;
  }

  async getEvent(): Promise<EventRow> {
    return this.ensureEvent();
  }

  async updateEvent(patch: UpdateEvent): Promise<EventRow> {
    await this.ensureEvent();
    const [updated] = await db.update(events).set(patch).where(eq(events.id, 1)).returning();
    return updated;
  }

  async listSignups(): Promise<SignupRow[]> {
    await ready();
    return db.select().from(signups);
  }

  async getSignupBySlot(slotIndex: number): Promise<SignupRow | undefined> {
    await ready();
    const [row] = await db.select().from(signups).where(eq(signups.slotIndex, slotIndex));
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

  async createWatchSignup(signup: InsertWatchSignup): Promise<WatchSignupRow> {
    await ready();
    const confirmationCode = `MV-${Math.random().toString(36).slice(2, 6).toUpperCase()}${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
    const [created] = await db
      .insert(watchSignups)
      .values({ ...signup, confirmationCode, createdAt: new Date().toISOString() })
      .returning();
    return created;
  }

  async listWatchSignups(): Promise<WatchSignupRow[]> {
    await ready();
    return db.select().from(watchSignups);
  }

  async createLoginToken(email: string, token: string, expiresAt: string): Promise<LoginTokenRow> {
    await ready();
    const [created] = await db
      .insert(loginTokens)
      .values({ email, token, expiresAt, createdAt: new Date().toISOString() })
      .returning();
    return created;
  }

  async getLoginToken(token: string): Promise<LoginTokenRow | undefined> {
    await ready();
    const [row] = await db.select().from(loginTokens).where(eq(loginTokens.token, token));
    return row;
  }

  async markLoginTokenUsed(id: number): Promise<void> {
    await ready();
    await db.update(loginTokens).set({ usedAt: new Date().toISOString() }).where(eq(loginTokens.id, id));
  }
}

export const storage = new DatabaseStorage();
