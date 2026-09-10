import { events, signups } from "@shared/schema";
import type { EventRow, InsertEvent, UpdateEvent, SignupRow, InsertSignup } from "@shared/schema";
import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import { eq } from "drizzle-orm";

const sqlite = new Database("data.db");
sqlite.pragma("journal_mode = WAL");

export const db = drizzle(sqlite);

// Create tables on boot if they don't exist yet (no migration tooling needed for MVP)
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    tagline TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    start_at_utc TEXT NOT NULL,
    duration_hours INTEGER NOT NULL DEFAULT 24,
    slot_minutes INTEGER NOT NULL DEFAULT 60,
    admin_password TEXT NOT NULL DEFAULT 'reveille2026'
  );
  CREATE TABLE IF NOT EXISTS signups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slot_index INTEGER NOT NULL,
    podcast_name TEXT NOT NULL,
    host_name TEXT NOT NULL,
    email TEXT NOT NULL,
    phone TEXT NOT NULL DEFAULT '',
    num_people INTEGER NOT NULL DEFAULT 1,
    has_video_intro INTEGER NOT NULL DEFAULT 0,
    has_video_outro INTEGER NOT NULL DEFAULT 0,
    has_slides INTEGER NOT NULL DEFAULT 0,
    has_images INTEGER NOT NULL DEFAULT 0,
    needs_interviewer INTEGER NOT NULL DEFAULT 0,
    social_links TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    timezone TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'confirmed',
    created_at TEXT NOT NULL
  );
`);

export interface IStorage {
  getEvent(): Promise<EventRow>;
  updateEvent(patch: UpdateEvent): Promise<EventRow>;
  listSignups(): Promise<SignupRow[]>;
  getSignupBySlot(slotIndex: number): Promise<SignupRow | undefined>;
  createSignup(signup: InsertSignup): Promise<SignupRow>;
  cancelSignup(id: number): Promise<SignupRow | undefined>;
  deleteSignup(id: number): Promise<{ changes: number }>;
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
  private ensureEvent(): EventRow {
    let row = db.select().from(events).where(eq(events.id, 1)).get();
    if (!row) {
      row = db
        .insert(events)
        .values({
          id: 1,
          name: "Reveille 24-Hour Podcast Marathon",
          tagline: "One mic, every time zone, twenty-four hours straight.",
          description:
            "Claim your hour. We'll build the on-air agenda automatically as podcasters sign up around the clock.",
          startAtUtc: defaultStartAtUtc(),
          durationHours: 24,
          slotMinutes: 60,
          adminPassword: "reveille2026",
        })
        .returning()
        .get();
    }
    return row;
  }

  async getEvent(): Promise<EventRow> {
    return this.ensureEvent();
  }

  async updateEvent(patch: UpdateEvent): Promise<EventRow> {
    this.ensureEvent();
    return db.update(events).set(patch).where(eq(events.id, 1)).returning().get();
  }

  async listSignups(): Promise<SignupRow[]> {
    return db.select().from(signups).all();
  }

  async getSignupBySlot(slotIndex: number): Promise<SignupRow | undefined> {
    return db
      .select()
      .from(signups)
      .where(eq(signups.slotIndex, slotIndex))
      .get();
  }

  async createSignup(signup: InsertSignup): Promise<SignupRow> {
    return db
      .insert(signups)
      .values({ ...signup, createdAt: new Date().toISOString(), status: "confirmed" })
      .returning()
      .get();
  }

  async cancelSignup(id: number): Promise<SignupRow | undefined> {
    return db
      .update(signups)
      .set({ status: "cancelled" })
      .where(eq(signups.id, id))
      .returning()
      .get();
  }

  async deleteSignup(id: number): Promise<{ changes: number }> {
    return db.delete(signups).where(eq(signups.id, id)).run();
  }
}

export const storage = new DatabaseStorage();
