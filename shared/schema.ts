import { pgTable, text, integer, boolean, serial } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Event — singleton settings for the marathon (start time, slot length, etc.)
// ---------------------------------------------------------------------------
export const events = pgTable("events", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  tagline: text("tagline").notNull().default(""),
  description: text("description").notNull().default(""),
  startAtUtc: text("start_at_utc").notNull(), // ISO 8601 UTC string
  durationHours: integer("duration_hours").notNull().default(24),
  slotMinutes: integer("slot_minutes").notNull().default(60),
  // On-air time vs. sponsor/transition buffer within each booked slot.
  // e.g. a 30-minute slot with onAirMinutes=25 and bufferMinutes=5 (bufferPosition="after")
  // means the podcaster is live for the first 25 minutes, then 5 minutes for the
  // sponsor read / transition to the next show.
  onAirMinutes: integer("on_air_minutes").notNull().default(25),
  bufferMinutes: integer("buffer_minutes").notNull().default(5),
  bufferPosition: text("buffer_position").notNull().default("after"), // "before" | "after"
  adminPassword: text("admin_password").notNull().default("militaryvoice2026"),
});

export const insertEventSchema = createInsertSchema(events)
  .omit({ id: true })
  .extend({
    onAirMinutes: z.number().int().min(1),
    bufferMinutes: z.number().int().min(0),
    bufferPosition: z.enum(["before", "after"]),
  });
export const updateEventSchema = insertEventSchema.partial();
export type InsertEvent = z.infer<typeof insertEventSchema>;
export type UpdateEvent = z.infer<typeof updateEventSchema>;
export type EventRow = typeof events.$inferSelect;

// Public-safe event shape (never leak the admin password to the client)
export type PublicEvent = Omit<EventRow, "adminPassword">;

// ---------------------------------------------------------------------------
// Signups — one podcaster/team claiming one slot
// ---------------------------------------------------------------------------
export const signups = pgTable("signups", {
  id: serial("id").primaryKey(),
  slotIndex: integer("slot_index").notNull(),
  podcastName: text("podcast_name").notNull(),
  hostName: text("host_name").notNull(),
  email: text("email").notNull(),
  phone: text("phone").notNull().default(""),
  numPeople: integer("num_people").notNull().default(1),
  hasVideoIntro: boolean("has_video_intro").notNull().default(false),
  hasVideoOutro: boolean("has_video_outro").notNull().default(false),
  hasSlides: boolean("has_slides").notNull().default(false),
  hasImages: boolean("has_images").notNull().default(false),
  needsInterviewer: boolean("needs_interviewer").notNull().default(false),
  socialLinks: text("social_links").notNull().default(""),
  notes: text("notes").notNull().default(""),
  timezone: text("timezone").notNull().default(""),
  photoUrl: text("photo_url").notNull().default(""),
  status: text("status").notNull().default("confirmed"), // confirmed | cancelled
  createdAt: text("created_at").notNull(),
});

export const insertSignupSchema = createInsertSchema(signups)
  .omit({ id: true, createdAt: true, status: true })
  .extend({
    podcastName: z.string().min(1, "Podcast or show name is required"),
    hostName: z.string().min(1, "Your name is required"),
    email: z.string().email("Enter a valid email"),
    numPeople: z.number().int().min(1).max(2),
    slotIndex: z.number().int().min(0),
    photoUrl: z.string().min(1, "A photo is required"),
  });

export type InsertSignup = z.infer<typeof insertSignupSchema>;
export type SignupRow = typeof signups.$inferSelect;

// Public-safe signup shape shown on the open schedule (no contact info)
export type PublicSignup = Pick<
  SignupRow,
  | "id"
  | "slotIndex"
  | "podcastName"
  | "hostName"
  | "photoUrl"
  | "numPeople"
  | "hasVideoIntro"
  | "hasVideoOutro"
  | "hasSlides"
  | "hasImages"
  | "needsInterviewer"
  | "socialLinks"
  | "status"
>;

// ---------------------------------------------------------------------------
// Reminders — a fan asking to be notified before a specific signup goes live
// ---------------------------------------------------------------------------
export const reminders = pgTable("reminders", {
  id: serial("id").primaryKey(),
  signupId: integer("signup_id").notNull(),
  email: text("email").notNull(),
  createdAt: text("created_at").notNull(),
});

export const insertReminderSchema = createInsertSchema(reminders)
  .omit({ id: true, createdAt: true })
  .extend({
    signupId: z.number().int().min(1),
    email: z.string().email("Enter a valid email"),
  });

export type InsertReminder = z.infer<typeof insertReminderSchema>;
export type ReminderRow = typeof reminders.$inferSelect;

// ---------------------------------------------------------------------------
// Watch signups — a fan claiming a slot to watch (no account needed), gets a
// short confirmation code back. Distinct from `reminders`, which is a fan
// asking to be pinged about one specific podcaster's slot.
// ---------------------------------------------------------------------------
export const watchSignups = pgTable("watch_signups", {
  id: serial("id").primaryKey(),
  email: text("email").notNull(),
  confirmationCode: text("confirmation_code").notNull(),
  createdAt: text("created_at").notNull(),
});

export const insertWatchSignupSchema = createInsertSchema(watchSignups)
  .omit({ id: true, confirmationCode: true, createdAt: true })
  .extend({
    email: z.string().email("Enter a valid email"),
  });

export type InsertWatchSignup = z.infer<typeof insertWatchSignupSchema>;
export type WatchSignupRow = typeof watchSignups.$inferSelect;

// ---------------------------------------------------------------------------
// Login tokens — one-time magic-link tokens for podcaster (host) login.
// A host only exists implicitly as "whoever has a signups row with this
// email" — there's no separate accounts table.
// ---------------------------------------------------------------------------
export const loginTokens = pgTable("login_tokens", {
  id: serial("id").primaryKey(),
  email: text("email").notNull(),
  token: text("token").notNull(),
  expiresAt: text("expires_at").notNull(),
  usedAt: text("used_at"),
  createdAt: text("created_at").notNull(),
});

export type LoginTokenRow = typeof loginTokens.$inferSelect;
