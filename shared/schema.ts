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
  rssUrl: text("rss_url").notNull().default(""),
  youtubeUrl: text("youtube_url").notNull().default(""),
  // JSON array of connected social accounts (see server/uploadPost.ts),
  // snapshotted from the profile when the slot is claimed and refreshed
  // whenever the podcaster reconnects accounts.
  socialAccounts: text("social_accounts").notNull().default(""),
  // How the slot runs: "live" (they broadcast in real time) or "prerecorded"
  // (they hand us a finished episode to roll). Pre-recorded shows also choose
  // whether they open with a short live virtual intro.
  showFormat: text("show_format").notNull().default("live"),
  recordingUrl: text("recording_url").notNull().default(""),
  introStyle: text("intro_style").notNull().default("virtual"),
  // Who they are in the military community. Both optional — a supporter or an
  // organization has no branch.
  branch: text("branch").notNull().default(""),
  serviceStatus: text("service_status").notNull().default(""),
  // How they normally produce their show, so the studio team knows what to expect.
  recordingMode: text("recording_mode").notNull().default(""),
  postEdits: text("post_edits").notNull().default(""),
  streamPlatform: text("stream_platform").notNull().default(""),
  streamPlatformOther: text("stream_platform_other").notNull().default(""),
  // Show-day details the studio team needs.
  guests: text("guests").notNull().default(""),
  interviewQuestions: text("interview_questions").notNull().default(""),
  promoNotes: text("promo_notes").notNull().default(""),
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
  | "rssUrl"
  | "youtubeUrl"
  | "socialAccounts"
  | "showFormat"
  | "branch"
  | "serviceStatus"
  | "status"
>;

// ---------------------------------------------------------------------------
// Reminders — a fan asking to be notified before a specific signup goes live
// ---------------------------------------------------------------------------
export const reminders = pgTable("reminders", {
  id: serial("id").primaryKey(),
  signupId: integer("signup_id").notNull(),
  email: text("email").notNull(),
  name: text("name").notNull().default(""),
  phone: text("phone").notNull().default(""), // optional; for a future text reminder
  timezone: text("timezone").notNull().default(""), // fan's zone, for the email
  createdAt: text("created_at").notNull(),
});

export const insertReminderSchema = createInsertSchema(reminders)
  .omit({ id: true, createdAt: true })
  .extend({
    signupId: z.number().int().min(1),
    email: z.string().trim().email("Enter a valid email"),
    name: z.string().trim().min(1, "Tell us your name"),
    phone: z
      .string()
      .trim()
      .refine((v) => v === "" || v.replace(/\D/g, "").length >= 10, { message: "Enter a full phone number (or leave it blank)" })
      .default(""),
    timezone: z.string().trim().default(""),
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
  // Optional show links. Both are stored normalized with an https:// scheme
  // (see optionalUrl below) so they can be rendered as plain anchors.
  rssUrl: text("rss_url").notNull().default(""),
  youtubeUrl: text("youtube_url").notNull().default(""),
  // Upload-Post user profile name + cached JSON array of connected accounts.
  uploadPostUsername: text("upload_post_username").notNull().default(""),
  socialAccounts: text("social_accounts").notNull().default(""),
  // How the slot runs: "live" (they broadcast in real time) or "prerecorded"
  // (they hand us a finished episode to roll). Pre-recorded shows also choose
  // whether they open with a short live virtual intro.
  showFormat: text("show_format").notNull().default("live"),
  recordingUrl: text("recording_url").notNull().default(""),
  introStyle: text("intro_style").notNull().default("virtual"),
  // Who they are in the military community. Both optional — a supporter or an
  // organization has no branch.
  branch: text("branch").notNull().default(""),
  serviceStatus: text("service_status").notNull().default(""),
  // How they normally produce their show, so the studio team knows what to expect.
  recordingMode: text("recording_mode").notNull().default(""),
  postEdits: text("post_edits").notNull().default(""),
  streamPlatform: text("stream_platform").notNull().default(""),
  streamPlatformOther: text("stream_platform_other").notNull().default(""),
  // Show-day details the studio team needs.
  guests: text("guests").notNull().default(""),
  interviewQuestions: text("interview_questions").notNull().default(""),
  promoNotes: text("promo_notes").notNull().default(""),
  notes: text("notes").notNull().default(""),
  photoUrl: text("photo_url").notNull().default(""),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

// Optional URL field: blank is fine; anything else must look like a web
// address. A missing scheme is added so "youtube.com/@show" becomes a working link.
const optionalUrl = (label: string) =>
  z
    .string()
    .trim()
    .transform((v) => (v && !/^https?:\/\//i.test(v) ? `https://${v}` : v))
    .refine(
      (v) => {
        if (!v) return true;
        // "frankzaccari@gmail.com" becomes https://frankzaccari@gmail.com,
        // which is a technically valid URL with a username. Reject anything
        // carrying credentials, and require a real-looking hostname.
        if (/@/.test(v.replace(/^https?:\/\//i, "").split("/")[0])) return false;
        try {
          const u = new URL(v);
          if (!/^https?:$/.test(u.protocol)) return false;
          if (u.username || u.password) return false;
          return /^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/i.test(u.hostname);
        } catch {
          return false;
        }
      },
      { message: `Enter a valid ${label} link (or leave it blank)` },
    );

export const SERVICE_BRANCHES = [
  "Army",
  "Marine Corps",
  "Navy",
  "Air Force",
  "Space Force",
  "Coast Guard",
  "National Guard",
  "Not applicable",
] as const;

export const SERVICE_STATUSES = [
  "Active duty",
  "Veteran",
  "Retired",
  "Military spouse",
  "Military organization",
  "Supporter of the military",
] as const;

export const RECORDING_MODES = ["Record and edit", "Live stream", "Both"] as const;
export const POST_EDIT_ANSWERS = ["Yes", "No"] as const;
export const STREAM_PLATFORMS = [
  "Zoom",
  "Restream",
  "StreamYard",
  "Riverside",
  "OBS",
  "Twitch",
  "YouTube",
  "Other",
] as const;

export type ServiceBranch = (typeof SERVICE_BRANCHES)[number];
export type ServiceStatus = (typeof SERVICE_STATUSES)[number];

/** Empty (not answered) or one of the listed options. */
const optionalChoice = (options: readonly string[], label: string) =>
  z.string().trim().refine((v) => v === "" || options.includes(v), { message: `Pick a ${label} from the list` });

export const profileFieldsSchema = createInsertSchema(podcasterProfiles)
  .omit({
    id: true,
    email: true,
    createdAt: true,
    updatedAt: true,
    photoUrl: true,
    uploadPostUsername: true,
    socialAccounts: true,
  })
  .extend({
    podcastName: z.string().min(1, "Podcast or show name is required"),
    hostName: z.string().min(1, "Your name is required"),
    numPeople: z.number().int().min(1).max(2),
    rssUrl: optionalUrl("RSS feed"),
    youtubeUrl: optionalUrl("YouTube"),
    needsInterviewer: z.boolean(),
    showFormat: z.enum(["live", "prerecorded"]),
    introStyle: z.enum(["virtual", "straight"]),
    recordingUrl: optionalUrl("episode"),
    branch: optionalChoice(SERVICE_BRANCHES, "branch"),
    serviceStatus: optionalChoice(SERVICE_STATUSES, "status"),
    recordingMode: optionalChoice(RECORDING_MODES, "recording style"),
    postEdits: optionalChoice(POST_EDIT_ANSWERS, "yes or no"),
    streamPlatform: optionalChoice(STREAM_PLATFORMS, "platform"),
    streamPlatformOther: z.string().trim().max(80, "Keep it under 80 characters"),
    guests: z.string().trim().max(2000, "Keep it under 2000 characters"),
    interviewQuestions: z.string().trim().max(4000, "Keep it under 4000 characters"),
    promoNotes: z.string().trim().max(2000, "Keep it under 2000 characters"),
  });

// Refined version used for validation. Kept separate because a schema with a
// refinement can no longer be `.extend()`ed.
export const insertProfileSchema = profileFieldsSchema
  .superRefine((v, ctx) => {
    // A pre-recorded slot is only bookable once we can actually get the file.
    if (v.showFormat === "prerecorded" && !v.recordingUrl) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["recordingUrl"],
        message: "Add a link to your recorded episode so we can pull it before the event.",
      });
    }
  });

export type ShowFormat = "live" | "prerecorded";
export type IntroStyle = "virtual" | "straight";

export type InsertProfile = z.infer<typeof insertProfileSchema>;
export type ProfileRow = typeof podcasterProfiles.$inferSelect;

// Public-safe podcaster shape (no contact info) for the homepage roster —
// podcasters who've finished a profile, whether or not they've claimed a slot.
export type PublicPodcaster = Pick<
  ProfileRow,
  "id" | "podcastName" | "hostName" | "photoUrl" | "numPeople" | "socialLinks" | "rssUrl" | "youtubeUrl" | "socialAccounts"
> & { email?: never };

// ---------------------------------------------------------------------------
// Connected social account (stored as JSON in `socialAccounts` columns).
// ---------------------------------------------------------------------------
export type SocialPlatform = "instagram" | "tiktok" | "youtube" | "x" | "linkedin" | "facebook" | "threads";
export interface SocialAccount {
  platform: SocialPlatform;
  username: string;
  displayName: string;
  url: string;
  image: string;
  /** Follower / subscriber count from the platform's analytics, when available. */
  followers?: number;
}

// ---------------------------------------------------------------------------
// Sponsors — "Friends of the Podcastathon" logo strip, managed from admin.
// ---------------------------------------------------------------------------
export const sponsors = pgTable("sponsors", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  url: text("url").notNull().default(""),
  logoUrl: text("logo_url").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  active: boolean("active").notNull().default(true),
  createdAt: text("created_at").notNull(),
});

export const updateSponsorSchema = z.object({
  name: z.string().trim().min(1, "Name is required").optional(),
  url: z
    .string()
    .trim()
    .transform((v) => (v && !/^https?:\/\//i.test(v) ? `https://${v}` : v))
    .optional(),
  sortOrder: z.number().int().optional(),
  active: z.boolean().optional(),
});
export type UpdateSponsor = z.infer<typeof updateSponsorSchema>;
export type SponsorRow = typeof sponsors.$inferSelect;
export type PublicSponsor = Pick<SponsorRow, "id" | "name" | "url" | "logoUrl" | "sortOrder">;

// ---------------------------------------------------------------------------
// Admin users — who can open /admin. Sign-in is the same one-time email code
// podcasters use; there is no shared password to pass around.
// ---------------------------------------------------------------------------
export const adminUsers = pgTable("admin_users", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().unique(),
  name: text("name").notNull().default(""),
  isOwner: boolean("is_owner").notNull().default(false),
  createdAt: text("created_at").notNull(),
});

export type AdminUserRow = typeof adminUsers.$inferSelect;

// ---------------------------------------------------------------------------
// Sponsor inquiries — the "Sponsors" nav popup on the public site.
// ---------------------------------------------------------------------------
export const sponsorInquiries = pgTable("sponsor_inquiries", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  company: text("company").notNull().default(""),
  email: text("email").notNull(),
  phone: text("phone").notNull().default(""),
  message: text("message").notNull().default(""),
  handled: boolean("handled").notNull().default(false),
  createdAt: text("created_at").notNull(),
});

export const insertSponsorInquirySchema = createInsertSchema(sponsorInquiries)
  .omit({ id: true, createdAt: true, handled: true })
  .extend({
    name: z.string().trim().min(1, "Tell us your name"),
    company: z.string().trim().default(""),
    email: z.string().trim().email("Enter a valid email"),
    phone: z.string().trim().default(""),
    message: z.string().trim().max(2000).default(""),
  });
export type InsertSponsorInquiry = z.infer<typeof insertSponsorInquirySchema>;
export type SponsorInquiryRow = typeof sponsorInquiries.$inferSelect;

// ---------------------------------------------------------------------------
// Site settings — small key/value switches the admin flips (e.g. whether the
// sponsor strip shows on the homepage at all).
// ---------------------------------------------------------------------------
export const siteSettings = pgTable("site_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

export type SiteSettingRow = typeof siteSettings.$inferSelect;
export interface PublicSettings {
  sponsorsVisible: boolean;
}

// ---------------------------------------------------------------------------
// Files a podcaster sends ahead of their slot — intro/outro clips, images, or
// a link to something too big to upload.
// ---------------------------------------------------------------------------
export const ASSET_KINDS = ["Intro", "Outro", "Mid-roll", "Image", "Other"] as const;
export type AssetKind = (typeof ASSET_KINDS)[number];

export const showAssets = pgTable("show_assets", {
  id: serial("id").primaryKey(),
  email: text("email").notNull(),
  kind: text("kind").notNull().default("Other"),
  label: text("label").notNull().default(""),
  fileUrl: text("file_url").notNull().default(""),
  linkUrl: text("link_url").notNull().default(""),
  fileName: text("file_name").notNull().default(""),
  sizeBytes: integer("size_bytes").notNull().default(0),
  createdAt: text("created_at").notNull(),
});
export type ShowAssetRow = typeof showAssets.$inferSelect;

// ---------------------------------------------------------------------------
// Run of show — the minute-by-minute plan the studio follows. Generated from
// the schedule, then edited by hand.
// ---------------------------------------------------------------------------
export const RUN_ITEM_KINDS = ["Pre-show", "Sponsor", "Intro", "Segment", "Handoff", "Break", "Custom"] as const;
export type RunItemKind = (typeof RUN_ITEM_KINDS)[number];

export const runOfShow = pgTable("run_of_show", {
  id: serial("id").primaryKey(),
  eventId: integer("event_id").notNull(),
  sortIndex: integer("sort_index").notNull().default(0),
  kind: text("kind").notNull().default("Custom"),
  title: text("title").notNull().default(""),
  notes: text("notes").notNull().default(""),
  startAtUtc: text("start_at_utc").notNull().default(""),
  durationMinutes: integer("duration_minutes").notNull().default(0),
  signupId: integer("signup_id"),
  createdAt: text("created_at").notNull(),
});
export type RunItemRow = typeof runOfShow.$inferSelect;

export const runItemInputSchema = z.object({
  kind: z.enum(RUN_ITEM_KINDS),
  title: z.string().trim().max(200),
  notes: z.string().trim().max(2000),
  startAtUtc: z.string().trim(),
  durationMinutes: z.number().int().min(0).max(1440),
  signupId: z.number().int().positive().nullable().optional(),
});
export type RunItemInput = z.infer<typeof runItemInputSchema>;
