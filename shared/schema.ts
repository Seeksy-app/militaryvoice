import { pgTable, text, integer, boolean, serial } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Events — every event lives as its own row now. One is flagged `isFeatured`
// (the event shown at "/" and used as the default for legacy links/admin).
// ---------------------------------------------------------------------------
export const events = pgTable("events", {
  id: serial("id").primaryKey(),
  slug: text("slug").notNull().default(""),
  isFeatured: boolean("is_featured").notNull().default(false),
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
  createdAt: text("created_at").notNull().default(""),
});

export const insertEventSchema = createInsertSchema(events)
  .omit({ id: true, createdAt: true })
  .extend({
    name: z.string().min(1, "Event name is required"),
    slug: z
      .string()
      .min(1, "Slug is required")
      .regex(/^[a-z0-9-]+$/, "Use lowercase letters, numbers, and hyphens only"),
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
  eventId: integer("event_id").notNull(),
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
    eventId: z.number().int().min(1),
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
  | "eventId"
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
// Login tokens — one-time typed sign-in codes for podcaster (host) login.
// `token` holds a short human-typeable code (e.g. "482913"), not a link.
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

// ---------------------------------------------------------------------------
// Podcaster profiles — one-time account setup per email. Claiming a slot
// reuses this instead of asking for the same details (name, photo, etc.)
// every time.
// ---------------------------------------------------------------------------
export const podcasterProfiles = pgTable("podcaster_profiles", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().unique(),
  podcastName: text("podcast_name").notNull().default(""),
  hostName: text("host_name").notNull().default(""),
  phone: text("phone").notNull().default(""),
  numPeople: integer("num_people").notNull().default(1),
  hasVideoIntro: boolean("has_video_intro").notNull().default(false),
  hasVideoOutro: boolean("has_video_outro").notNull().default(false),
  hasSlides: boolean("has_slides").notNull().default(false),
  hasImages: boolean("has_images").notNull().default(false),
  needsInterviewer: boolean("needs_interviewer").notNull().default(false),
  socialLinks: text("social_links").notNull().default(""),
  notes: text("notes").notNull().default(""),
  photoUrl: text("photo_url").notNull().default(""),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const insertProfileSchema = createInsertSchema(podcasterProfiles)
  .omit({ id: true, email: true, createdAt: true, updatedAt: true, photoUrl: true })
  .extend({
    podcastName: z.string().min(1, "Podcast or show name is required"),
    hostName: z.string().min(1, "Your name is required"),
    numPeople: z.number().int().min(1).max(2),
  });

export type InsertProfile = z.infer<typeof insertProfileSchema>;
export type ProfileRow = typeof podcasterProfiles.$inferSelect;
