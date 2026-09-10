import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Event — singleton settings for the marathon (start time, slot length, etc.)
// ---------------------------------------------------------------------------
export const events = sqliteTable("events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  tagline: text("tagline").notNull().default(""),
  description: text("description").notNull().default(""),
  startAtUtc: text("start_at_utc").notNull(), // ISO 8601 UTC string
  durationHours: integer("duration_hours").notNull().default(24),
  slotMinutes: integer("slot_minutes").notNull().default(60),
  adminPassword: text("admin_password").notNull().default("reveille2026"),
});

export const insertEventSchema = createInsertSchema(events).omit({ id: true });
export const updateEventSchema = insertEventSchema.partial();
export type InsertEvent = z.infer<typeof insertEventSchema>;
export type UpdateEvent = z.infer<typeof updateEventSchema>;
export type EventRow = typeof events.$inferSelect;

// Public-safe event shape (never leak the admin password to the client)
export type PublicEvent = Omit<EventRow, "adminPassword">;

// ---------------------------------------------------------------------------
// Signups — one podcaster/team claiming one slot
// ---------------------------------------------------------------------------
export const signups = sqliteTable("signups", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  slotIndex: integer("slot_index").notNull(),
  podcastName: text("podcast_name").notNull(),
  hostName: text("host_name").notNull(),
  email: text("email").notNull(),
  phone: text("phone").notNull().default(""),
  numPeople: integer("num_people").notNull().default(1),
  hasVideoIntro: integer("has_video_intro", { mode: "boolean" }).notNull().default(false),
  hasVideoOutro: integer("has_video_outro", { mode: "boolean" }).notNull().default(false),
  hasSlides: integer("has_slides", { mode: "boolean" }).notNull().default(false),
  hasImages: integer("has_images", { mode: "boolean" }).notNull().default(false),
  needsInterviewer: integer("needs_interviewer", { mode: "boolean" }).notNull().default(false),
  socialLinks: text("social_links").notNull().default(""),
  notes: text("notes").notNull().default(""),
  timezone: text("timezone").notNull().default(""),
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
  });

export type InsertSignup = z.infer<typeof insertSignupSchema>;
export type SignupRow = typeof signups.$inferSelect;

// Public-safe signup shape shown on the open schedule (no contact info)
export type PublicSignup = Pick<
  SignupRow,
  | "id"
  | "slotIndex"
  | "podcastName"
  | "numPeople"
  | "hasVideoIntro"
  | "hasVideoOutro"
  | "hasSlides"
  | "hasImages"
  | "needsInterviewer"
  | "socialLinks"
  | "status"
>;
