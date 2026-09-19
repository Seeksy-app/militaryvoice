import { pgTable, text, integer, boolean, serial, uniqueIndex, index } from "drizzle-orm/pg-core";
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
  // Whether the public can see it at all. Off hides it from every public
  // listing *and* from a direct link — a hidden event is not a secret URL, it
  // is not reachable. Defaults on, so nothing that exists today changes.
  visible: boolean("visible").notNull().default(true),
  name: text("name").notNull(),
  tagline: text("tagline").notNull().default(""),
  description: text("description").notNull().default(""),
  // Card artwork. A path under /public or an absolute URL; empty falls back to
  // a plain tile, so a new event without one still renders.
  imageUrl: text("image_url").notNull().default(""),
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
  // The day the event celebrates ("National Military Podcast Day"). Cards,
  // captions and the About page read it, so a second tenant changes one field.
  occasion: text("occasion").notNull().default("National Military Podcast Day"),
  // Public About page body. Blank paragraphs separate sections; a line
  // starting with "## " is a heading. Edited in Admin.
  about: text("about").notNull().default(""),
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
  // When the "starting soon" email went out. Empty until it has; the claim
  // that sets it is what stops a double send.
  remindedAt: text("reminded_at").notNull().default(""),
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
  // Whether their audience figures may be counted in what we show sponsors.
  //
  // On by default. What this gates is a total with no names in it — sponsors
  // fund the production every host here uses, and a bigger honest combined
  // number is what gets the event paid for. Anything that would name a
  // podcaster's own figures is a separate question and is not covered by this.
  // The toggle is in their dashboard and turning it off takes one click.
  shareAudienceStats: boolean("share_audience_stats").notNull().default(true),
  // They've answered the "anything for us to play?" question — either way.
  // Without this, "no, nothing to send" left the checklist item open forever,
  // which is the one honest answer the list couldn't hear.
  mediaAnswered: boolean("media_answered").notNull().default(false),
  /** Same for "anything you want the host to mention?" — asked once, not every visit. */
  detailsAnswered: boolean("details_answered").notNull().default(false),
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

export const INTERVIEW_NEEDS = [
  { value: "none", label: "We've got this ourselves", hint: "You run the whole segment." },
  { value: "interview_me", label: "Please interview me", hint: "We'll line up a host to ask the questions." },
  { value: "find_guest", label: "Find me someone to interview", hint: "We'll bring you a guest from the community." },
] as const;
export type InterviewNeed = (typeof INTERVIEW_NEEDS)[number]["value"];

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

/**
 * Empty, or several of the listed options as a comma-separated string.
 * People use more than one tool — Riverside to record and StreamYard to go
 * live is an ordinary answer — so the question takes checkboxes. Stored in
 * the same text column rather than a new table; the set is small and fixed.
 */
const optionalChoices = (options: readonly string[], label: string) =>
  z.string().trim().refine(
    (v) => v === "" || v.split(",").map((p) => p.trim()).filter(Boolean).every((p) => options.includes(p)),
    { message: `Pick your ${label} from the list` },
  );

/** The stored comma-separated string as a list, and back. */
export function parseChoices(v: string | null | undefined): string[] {
  return (v ?? "").split(",").map((p) => p.trim()).filter(Boolean);
}
export function joinChoices(v: string[]): string {
  return v.join(", ");
}

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
    shareAudienceStats: z.boolean(),
    mediaAnswered: z.boolean(),
    detailsAnswered: z.boolean(),
    showFormat: z.enum(["live", "prerecorded"]),
    introStyle: z.enum(["virtual", "straight"]),
    recordingUrl: optionalUrl("episode"),
    branch: optionalChoice(SERVICE_BRANCHES, "branch"),
    serviceStatus: optionalChoice(SERVICE_STATUSES, "status"),
    recordingMode: optionalChoice(RECORDING_MODES, "recording style"),
    postEdits: optionalChoice(POST_EDIT_ANSWERS, "yes or no"),
    streamPlatform: optionalChoices(STREAM_PLATFORMS, "platforms"),
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
// Sponsors — three tiers on the public site. "presenting" gets a band of its
// own, "official" a static grid, "friend" the scrolling strip. A package is
// what they bought; the tier is only where the logo lands.
// ---------------------------------------------------------------------------
export const SPONSOR_TIERS = ["presenting", "official", "friend"] as const;
export type SponsorTier = (typeof SPONSOR_TIERS)[number];

export const sponsorPackages = pgTable("sponsor_packages", {
  id: serial("id").primaryKey(),
  eventId: integer("event_id").notNull().default(0),
  name: text("name").notNull(),
  /** Whole dollars — these are five-figure round numbers, not cart items. */
  price: integer("price").notNull().default(0),
  totalSlots: integer("total_slots").notNull().default(1),
  /** Which tier a sponsor lands in when this package is assigned to them. */
  tier: text("tier").notNull().default("official"),
  description: text("description").notNull().default(""),
  /** Where they pay. Handed over once an enquiry is in, not published in the
   *  packages list — the point of the form is to know who is buying. */
  checkoutUrl: text("checkout_url").notNull().default(""),
  sortOrder: integer("sort_order").notNull().default(0),
  active: boolean("active").notNull().default(true),
  createdAt: text("created_at").notNull(),
});

export const upsertSponsorPackageSchema = z.object({
  name: z.string().trim().min(1, "Name is required"),
  price: z.number().int().min(0).default(0),
  totalSlots: z.number().int().min(1).default(1),
  tier: z.enum(SPONSOR_TIERS).default("official"),
  description: z.string().trim().default(""),
  checkoutUrl: z.string().trim().max(600).default(""),
  sortOrder: z.number().int().default(0),
  active: z.boolean().default(true),
});
export type UpsertSponsorPackage = z.infer<typeof upsertSponsorPackageSchema>;
export type SponsorPackageRow = typeof sponsorPackages.$inferSelect;
/** A package plus how many of its slots are taken — derived, never stored. */
export type SponsorPackageWithSold = SponsorPackageRow & { sold: number };

export const sponsors = pgTable("sponsors", {
  id: serial("id").primaryKey(),
  // 0 = created before sponsors were per-event; treated as the featured event's.
  eventId: integer("event_id").notNull().default(0),
  name: text("name").notNull(),
  url: text("url").notNull().default(""),
  logoUrl: text("logo_url").notNull(),
  /** Where the logo shows. Existing rows predate tiers and stay "friend". */
  tier: text("tier").notNull().default("friend"),
  /** 0 = no package (a courtesy logo, or one tracked outside the site). */
  packageId: integer("package_id").notNull().default(0),
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
  tier: z.enum(SPONSOR_TIERS).optional(),
  packageId: z.number().int().min(0).optional(),
  sortOrder: z.number().int().optional(),
  active: z.boolean().optional(),
});
export type UpdateSponsor = z.infer<typeof updateSponsorSchema>;
export type SponsorRow = typeof sponsors.$inferSelect;
export type PublicSponsor = Pick<SponsorRow, "id" | "name" | "url" | "logoUrl" | "sortOrder" | "tier">;

// ---------------------------------------------------------------------------
// Broadcast cadence — the fixed sequence of emails every podcaster receives.
// A broadcast belongs to a step by carrying source = "cadence:<key>"; the step
// list is shared so the admin UI and the server never disagree about the keys.
// ---------------------------------------------------------------------------
/**
 * The emails a podcaster receives, in the order they arrive.
 *
 * Named for when they fire rather than numbered. "Email 4" tells whoever is
 * editing it nothing about who is reading it or what they already know;
 * "One hour before" tells them everything, and stops the day-before email
 * being written as though its reader has not heard from us yet.
 *
 * The keys are stored on every broadcast, so they never change — only the
 * labels do.
 */
export const CADENCE_STEPS = [
  { key: "welcome", label: "Welcome", blurb: "When they take a slot — what to do first", auto: false },
  { key: "materials", label: "Two weeks out", blurb: "Artwork, clips and guest names", auto: false },
  { key: "email-1", label: "Ten days out", blurb: "Pre-show checklist", auto: false },
  { key: "email-2", label: "Five days out", blurb: "Test your camera, mic and lighting", auto: false },
  { key: "email-3", label: "The day before", blurb: "You're on tomorrow — everything in one place", auto: false },
  { key: "email-4", label: "One hour before", blurb: "Final call, and how to join", auto: false },
  { key: "email-5", label: "After the show", blurb: "Thank you, and the replay", auto: false },
  { key: "email-6", label: "Clips ready", blurb: "Their segment, cut and ready to post", auto: false },
] as const;

/**
 * Transactional emails that report into the Cadence tab but are not edited
 * there.
 *
 * Their wording lives in server/email.ts because they carry per-person detail
 * a template cannot — the slot time, the calendar links, the sign-in code. The
 * rows under these keys exist only to count sends, which is why their bodies
 * are empty, and showing them beside the templates with an Edit button is how
 * somebody ends up sending a blank duplicate of a confirmation.
 */
export const CADENCE_AUTOMATIC = [
  { key: "confirmation", label: "Booking confirmation", blurb: "Sent the instant a slot is claimed, with their time and calendar links" },
  { key: "prep", label: "Prep nudge", blurb: "Two weeks before their slot" },
  { key: "final", label: "Final nudge", blurb: "Two days before their slot" },
  { key: "onair", label: "On-air nudge", blurb: "One hour before their slot" },
] as const;
export type CadenceKey = (typeof CADENCE_STEPS)[number]["key"];
export const cadenceSource = (key: string) => `cadence:${key}`;

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
  /** Their job title — who we are actually talking to at the organisation. */
  title: text("title").notNull().default(""),
  email: text("email").notNull(),
  phone: text("phone").notNull().default(""),
  message: text("message").notNull().default(""),
  /** Which package they asked about. 0 = they didn't say, which is a real
   *  answer and the one Phil Randazzo gave, because the form never asked. */
  packageId: integer("package_id").notNull().default(0),
  /** The package's name as it stood at the time. Kept flat on purpose: a
   *  package can be renamed or retired, and an enquiry has to keep saying
   *  what was actually on the page when they read it. */
  packageName: text("package_name").notNull().default(""),
  handled: boolean("handled").notNull().default(false),
  createdAt: text("created_at").notNull(),
});

export const insertSponsorInquirySchema = createInsertSchema(sponsorInquiries)
  .omit({ id: true, createdAt: true, handled: true })
  .extend({
    name: z.string().trim().min(1, "Tell us your name"),
    company: z.string().trim().default(""),
    title: z.string().trim().max(120).default(""),
    email: z.string().trim().email("Enter a valid email"),
    phone: z.string().trim().default(""),
    message: z.string().trim().max(2000).default(""),
    packageId: z.number().int().min(0).default(0),
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
  /** Where the browser sends people. For anything in R2 this is our own
   *  /api/assets/:id/file, which redirects to a freshly signed link — the
   *  signature expires, a stored URL must not. */
  fileUrl: text("file_url").notNull().default(""),
  /** The R2 object key, when the file lives there rather than in Supabase.
   *  Supabase caps objects at 48MB project-wide, which is smaller than the
   *  episodes podcasters are being asked to send. */
  storageKey: text("storage_key").notNull().default(""),
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
  // Stable identity for a generated row ("segment-14"), so a rebuild can find
  // and refresh it. Empty for rows an admin added by hand.
  sourceKey: text("source_key").notNull().default(""),
  // A row can carry something for the stage — a sponsor reel, an intro, a
  // slide. That makes the run of show the scene list: the producer follows it
  // down and each row is one press.
  mediaUrl: text("media_url").notNull().default(""),
  mediaKind: text("media_kind").notNull().default("video"),
  mediaLabel: text("media_label").notNull().default(""),
  // Set once an admin changes the wording; rebuild then leaves those fields be.
  edited: boolean("edited").notNull().default(false),
  createdAt: text("created_at").notNull(),
});
export type RunItemRow = typeof runOfShow.$inferSelect;

export const runItemInputSchema = z.object({
  mediaUrl: z.string().trim().max(600).optional(),
  mediaKind: z.enum(["video", "image"]).optional(),
  mediaLabel: z.string().trim().max(120).optional(),
  kind: z.enum(RUN_ITEM_KINDS),
  title: z.string().trim().max(200),
  notes: z.string().trim().max(2000),
  startAtUtc: z.string().trim(),
  durationMinutes: z.number().int().min(0).max(1440),
  signupId: z.number().int().positive().nullable().optional(),
});
export type RunItemInput = z.infer<typeof runItemInputSchema>;
export type GeneratedRunItem = RunItemInput & { sourceKey: string };

// ---------------------------------------------------------------------------
// Interest in the platform itself — "register my event" and beta sign-ups.
// ---------------------------------------------------------------------------
export const platformInterest = pgTable("platform_interest", {
  id: serial("id").primaryKey(),
  intent: text("intent").notNull().default("beta"), // register | beta
  name: text("name").notNull(),
  email: text("email").notNull(),
  organization: text("organization").notNull().default(""),
  eventTiming: text("event_timing").notNull().default(""),
  notes: text("notes").notNull().default(""),
  handled: boolean("handled").notNull().default(false),
  createdAt: text("created_at").notNull(),
});
export type PlatformInterestRow = typeof platformInterest.$inferSelect;

export const platformInterestSchema = z.object({
  intent: z.enum(["register", "beta"]),
  name: z.string().trim().min(1, "Your name is required").max(120),
  email: z.string().trim().email("Enter a valid email"),
  organization: z.string().trim().max(160),
  eventTiming: z.string().trim().max(60),
  notes: z.string().trim().max(2000),
});

// ---------------------------------------------------------------------------
// Studio — the live control room for an event. The media layer (WebRTC) plugs
// in behind this; everything here is show control: who's waiting, who's on
// stage, and the emergency video.
// ---------------------------------------------------------------------------
export const STUDIO_STATUSES = ["Offline", "Rehearsal", "Live"] as const;
export type StudioStatus = (typeof STUDIO_STATUSES)[number];

export const PARTICIPANT_ROLES = ["Host", "Speaker", "Producer"] as const;
export const PARTICIPANT_STATES = ["Green room", "On stage", "Off stage"] as const;
export type ParticipantRole = (typeof PARTICIPANT_ROLES)[number];
export type ParticipantState = (typeof PARTICIPANT_STATES)[number];

export const studios = pgTable("studios", {
  id: serial("id").primaryKey(),
  eventId: integer("event_id").notNull(),
  name: text("name").notNull().default("Main studio"),
  status: text("status").notNull().default("Offline"),
  maxOnStage: integer("max_on_stage").notNull().default(5),
  // Queued clip that covers a malfunction — one button and it rolls.
  fallbackVideoUrl: text("fallback_video_url").notNull().default(""),
  fallbackLabel: text("fallback_label").notNull().default(""),
  // A second standby for before the event opens — "tune in on the 5th" rather
  // than "we'll be right back", which implies a show already running. The
  // viewer's own clock decides which one plays, so nobody has to remember to
  // swap them on the morning.
  preVideoUrl: text("pre_video_url").notNull().default(""),
  preLabel: text("pre_label").notNull().default(""),
  fallbackPlaying: boolean("fallback_playing").notNull().default(false),
  // Anything the producer puts on the stage itself: a podcaster's intro reel,
  // a sponsor card, a slide. Same mechanism as the standby clip, but chosen
  // deliberately rather than in an emergency — so standby always wins.
  stageMediaUrl: text("stage_media_url").notNull().default(""),
  stageMediaKind: text("stage_media_kind").notNull().default("video"),
  stageMediaLabel: text("stage_media_label").notNull().default(""),
  stageMediaPlaying: boolean("stage_media_playing").notNull().default(false),
  // Graphics: a logo burned into the corner of the stage for the whole show,
  // independent of whatever scene is up.
  logoUrl: text("logo_url").notNull().default(""),
  logoCorner: text("logo_corner").notNull().default("top-right"),
  logoSize: integer("logo_size").notNull().default(96),
  logoVisible: boolean("logo_visible").notNull().default(false),
  // A background that sits behind the camera tiles — the room the show
  // appears to be in. It only shows where the cameras don't: full-frame media
  // and the break clock cover it entirely, which is correct.
  backgroundUrl: text("background_url").notNull().default(""),
  backgroundVisible: boolean("background_visible").notNull().default(false),
  // The lower third that is on air *right now*. Usually put there by taking a
  // scene, which carries its own; the ad-lib box in the rail writes here too,
  // for the thing nobody planned for.
  bannerTitle: text("banner_title").notNull().default(""),
  bannerSubtitle: text("banner_subtitle").notNull().default(""),
  bannerVisible: boolean("banner_visible").notNull().default(false),
  // The ticker belongs to the show, not to a scene: it runs across the
  // handoffs, which is the whole reason to have one.
  tickerText: text("ticker_text").notNull().default(""),
  tickerVisible: boolean("ticker_visible").notNull().default(false),
  // Two separate egresses run off the same room: one long broadcast that goes
  // out to every destination for the whole event, and one short recording per
  // slot so each podcaster gets their own file.
  broadcastEgressId: text("broadcast_egress_id").notNull().default(""),
  recordingEgressId: text("recording_egress_id").notNull().default(""),
  // Whose slot the current recording belongs to.
  recordingSignupId: integer("recording_signup_id"),
  // The agenda row the producer last took. 0 = nothing taken yet (fall back to the clock).
  currentRunItemId: integer("current_run_item_id").notNull().default(0),
  // The scene that is up. Recorded rather than inferred from what's on the
  // stage: two scenes can put the same thing there, and the rail has to mark
  // the one that was actually pressed.
  currentSceneId: integer("current_scene_id").notNull().default(0),
  // A running countdown, as the instant it reaches zero. The clock is drawn by
  // every viewer against their own time, so it stays in step without a tick
  // being pushed to anyone.
  countdownEndsAtUtc: text("countdown_ends_at_utc").notNull().default(""),
  countdownLabel: text("countdown_label").notNull().default(""),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});
export type StudioRow = typeof studios.$inferSelect;

// A saved state of the stage. Set it up how you want it, name it, and it
// becomes one button during the show — a countdown, a welcome card, an outro.
// Cameras is just the scene with no media on top.
export const scenes = pgTable("scenes", {
  id: serial("id").primaryKey(),
  studioId: integer("studio_id").notNull(),
  name: text("name").notNull().default("Scene"),
  sortIndex: integer("sort_index").notNull().default(0),
  mediaUrl: text("media_url").notNull().default(""),
  mediaKind: text("media_kind").notNull().default("video"),
  mediaLabel: text("media_label").notNull().default(""),
  /** What the scene puts on the stage: the cameras, a file, or a clock. */
  kind: text("kind").notNull().default("camera"),
  /** Countdown scenes only — how long the clock runs for. */
  countdownSeconds: integer("countdown_seconds").notNull().default(300),
  /** Shown on the card. Carried over when a scene is made from the agenda so
   *  the rail can replace the rundown without losing the times. */
  startAtUtc: text("start_at_utc").notNull().default(""),
  /** The run-of-show row this came from, so taking a scene can still take the row. */
  runItemId: integer("run_item_id").notNull().default(0),
  /** The lower third this scene puts up. Taking the scene puts it on air;
   *  taking a scene with none takes the banner off. A name bar that belongs to
   *  the moment it names is the thing every switcher gets wrong by keeping the
   *  two in separate panels. */
  bannerTitle: text("banner_title").notNull().default(""),
  bannerSubtitle: text("banner_subtitle").notNull().default(""),
  createdAt: text("created_at").notNull(),
});
export type SceneRow = typeof scenes.$inferSelect;
/**
 * Saved lower thirds, kept per studio.
 *
 * Scenes carry their own name bar, which covers everything on the run of
 * show. This is the other half: the handful of cards a producer re-uses all
 * day and does not want to retype — the sponsor read, the "back in five", the
 * donate line. Typing one into the ad-lib box and losing it the moment the
 * next scene is taken is fine for a genuine ad-lib and useless for a card you
 * put up nine times.
 */
export const lowerThirds = pgTable("lower_thirds", {
  id: serial("id").primaryKey(),
  studioId: integer("studio_id").notNull(),
  title: text("title").notNull().default(""),
  subtitle: text("subtitle").notNull().default(""),
  sortIndex: integer("sort_index").notNull().default(0),
  createdAt: text("created_at").notNull(),
});
export type LowerThirdRow = typeof lowerThirds.$inferSelect;
export const lowerThirdInputSchema = z.object({
  title: z.string().trim().min(1, "Give it a name").max(80),
  subtitle: z.string().trim().max(120).default(""),
});

export const SCENE_KINDS = ["camera", "media", "countdown"] as const;
export type SceneKind = (typeof SCENE_KINDS)[number];

// One finished file per podcaster slot. Written when LiveKit tells us the
// egress ended, so the row always points at something that actually exists.
export const recordings = pgTable("recordings", {
  id: serial("id").primaryKey(),
  eventId: integer("event_id").notNull(),
  studioId: integer("studio_id").notNull(),
  signupId: integer("signup_id"),
  // Who it belongs to, kept flat so a podcaster's dashboard can find it even
  // if the signup is later moved or cancelled.
  email: text("email").notNull().default(""),
  title: text("title").notNull().default(""),
  egressId: text("egress_id").notNull(),
  status: text("status").notNull().default("Recording"),
  url: text("url").notNull().default(""),
  durationSec: integer("duration_sec").notNull().default(0),
  sizeBytes: text("size_bytes").notNull().default("0"),
  // Why it failed, straight from LiveKit, so a producer can see it without
  // anyone digging through logs.
  error: text("error").notNull().default(""),
  startedAt: text("started_at").notNull(),
  endedAt: text("ended_at"),
  // Clipping runs after the recorder finishes, on a worker that isn't this
  // one. The status is the whole queue: no second table, and a job that dies
  // mid-flight is visible rather than silently lost.
  clipStatus: text("clip_status").notNull().default("none"),
  clipError: text("clip_error").notNull().default(""),
  clipClaimedAt: text("clip_claimed_at").notNull().default(""),
});
export type RecordingRow = typeof recordings.$inferSelect;

export const CLIP_STATUSES = ["none", "queued", "running", "done", "failed"] as const;
export type ClipStatus = (typeof CLIP_STATUSES)[number];

/**
 * What the room heard, line by line, written as it happens.
 *
 * The captioning agent is already running speech-to-text on everyone on stage
 * so the audience gets captions. Keeping those lines means the transcript of
 * every segment exists the moment the segment ends — no second pass, no second
 * bill, and clips can be cut while the next show is still going out.
 */
export const transcriptLines = pgTable(
  "transcript_lines",
  {
    id: serial("id").primaryKey(),
    studioId: integer("studio_id").notNull(),
    eventId: integer("event_id").notNull().default(0),
    speaker: text("speaker").notNull().default(""),
    text: text("text").notNull().default(""),
    // Epoch milliseconds, as text: a segment is cut against wall-clock time,
    // and an integer column would overflow.
    startMs: text("start_ms").notNull().default("0"),
    endMs: text("end_ms").notNull().default("0"),
    createdAt: text("created_at").notNull(),
  },
  (t) => ({
    studioIdx: index("transcript_lines_studio_idx").on(t.studioId),
  }),
);
export type TranscriptLineRow = typeof transcriptLines.$inferSelect;

/**
 * One cut from one recording: a moment worth posting, chosen by the agent and
 * rendered in the shapes the networks actually want.
 */
export const clips = pgTable(
  "clips",
  {
    id: serial("id").primaryKey(),
    recordingId: integer("recording_id").notNull(),
    eventId: integer("event_id").notNull().default(0),
    signupId: integer("signup_id"),
    // Flat, like recordings: a podcaster keeps their clips even if the booking
    // is later moved or cancelled.
    email: text("email").notNull().default(""),
    title: text("title").notNull().default(""),
    /** The line to post with it. */
    caption: text("caption").notNull().default(""),
    /** Why the agent thought this was the moment — shown, not hidden, so a
     *  podcaster can tell a good pick from a bad one at a glance. */
    reason: text("reason").notNull().default(""),
    startSec: integer("start_sec").notNull().default(0),
    endSec: integer("end_sec").notNull().default(0),
    /** What is said in it, for the description and for search. */
    transcript: text("transcript").notNull().default(""),
    /** 16:9, 9:16 and 1:1 renders, plus the subtitles as a sidecar file. */
    url: text("url").notNull().default(""),
    verticalUrl: text("vertical_url").notNull().default(""),
    squareUrl: text("square_url").notNull().default(""),
    subtitlesUrl: text("subtitles_url").notNull().default(""),
    createdAt: text("created_at").notNull(),
  },
  (t) => ({
    recordingIdx: index("clips_recording_idx").on(t.recordingId),
    emailIdx: index("clips_email_idx").on(t.email),
  }),
);
export type ClipRow = typeof clips.$inferSelect;

/**
 * What one connected account reaches, as a third party measures it.
 *
 * Kept per account with the moment it was read, because a follower count on a
 * sponsorship page is a claim with a date on it. `raw` holds the untouched
 * response: the provider's schema isn't published, so the normalised columns
 * are a best reading of it and the original has to survive the first correction.
 */
export const socialMetrics = pgTable(
  "social_metrics",
  {
    id: serial("id").primaryKey(),
    email: text("email").notNull(),
    platform: text("platform").notNull(),
    handle: text("handle").notNull().default(""),
    followers: integer("followers").notNull().default(0),
    /** Percent, as the provider reports it — 2.4 means 2.4%. */
    engagementRate: text("engagement_rate").notNull().default(""),
    avgViews: integer("avg_views").notNull().default(0),
    avgLikes: integer("avg_likes").notNull().default(0),
    /** Share of followers judged real, 0–100. Blank when not supplied. */
    credibility: text("credibility").notNull().default(""),
    /** JSON: country, gender and age breakdowns when the provider gives them. */
    audience: text("audience").notNull().default(""),
    raw: text("raw").notNull().default(""),
    error: text("error").notNull().default(""),
    fetchedAt: text("fetched_at").notNull(),
  },
  (t) => ({
    accountIdx: uniqueIndex("social_metrics_account_idx").on(t.email, t.platform, t.handle),
  }),
);
export type SocialMetricRow = typeof socialMetrics.$inferSelect;

/** One clip as the worker hands it back, before it has urls. */
export const clipResultSchema = z.object({
  title: z.string().trim().min(1).max(120),
  caption: z.string().trim().max(400).default(""),
  reason: z.string().trim().max(400).default(""),
  startSec: z.number().int().min(0),
  endSec: z.number().int().min(1),
  transcript: z.string().trim().max(8000).default(""),
  url: z.string().trim().max(600).default(""),
  verticalUrl: z.string().trim().max(600).default(""),
  squareUrl: z.string().trim().max(600).default(""),
  subtitlesUrl: z.string().trim().max(600).default(""),
});
export type ClipResult = z.infer<typeof clipResultSchema>;

export const transcriptBatchSchema = z.object({
  studioId: z.number().int().positive(),
  lines: z
    .array(
      z.object({
        speaker: z.string().trim().max(120).default(""),
        text: z.string().trim().min(1).max(2000),
        startMs: z.number().min(0),
        endMs: z.number().min(0),
      }),
    )
    .min(1)
    .max(200),
});

// Where a broadcast goes. A destination with no signupId is the house's own —
// it carries the whole event. One with a signupId belongs to that podcaster and
// is added to the running broadcast for their slot only, then dropped, which is
// how the event borrows each speaker's own audience.
export const destinations = pgTable("destinations", {
  id: serial("id").primaryKey(),
  eventId: integer("event_id").notNull(),
  signupId: integer("signup_id"),
  // Set when a podcaster added it themselves, so we can show it back to them.
  ownerEmail: text("owner_email").notNull().default(""),
  platform: text("platform").notNull().default("custom"),
  label: text("label").notNull().default(""),
  // Ingest URL and key are kept apart so we can show the URL and mask the key.
  rtmpUrl: text("rtmp_url").notNull().default(""),
  streamKey: text("stream_key").notNull().default(""),
  enabled: boolean("enabled").notNull().default(true),
  // Set while this destination is attached to a running egress.
  live: boolean("live").notNull().default(false),
  createdAt: text("created_at").notNull(),
});
export type DestinationRow = typeof destinations.$inferSelect;

// A podcaster who'd rather push from their own encoder than use our studio
// page. We issue them an RTMP URL and key; whatever they send arrives in the
// room as a normal participant.
export const ingresses = pgTable("ingresses", {
  id: serial("id").primaryKey(),
  eventId: integer("event_id").notNull(),
  studioId: integer("studio_id").notNull(),
  signupId: integer("signup_id"),
  ownerEmail: text("owner_email").notNull().default(""),
  ingressId: text("ingress_id").notNull(),
  participantIdentity: text("participant_identity").notNull().default(""),
  displayName: text("display_name").notNull().default(""),
  url: text("url").notNull().default(""),
  streamKey: text("stream_key").notNull().default(""),
  createdAt: text("created_at").notNull(),
});
export type IngressRow = typeof ingresses.$inferSelect;

// A podcaster's own YouTube channel, connected once so we can open a broadcast
// on it at their slot time instead of asking them to dig out a stream key.
/**
 * One podcaster's show, for one event.
 *
 * The profile is about the person and never changes between events; this is
 * what they are bringing to a particular one. Somebody can join the marathon
 * with one show and a later event with another, and neither overwrites the
 * other — which the single set of columns on the profile could not do.
 *
 * The profile still carries a show name and format: those are the defaults
 * a new event's setup starts from, not the record of what was booked.
 */
export const eventShows = pgTable("event_shows", {
  id: serial("id").primaryKey(),
  email: text("email").notNull(),
  eventId: integer("event_id").notNull(),
  showName: text("show_name").notNull().default(""),
  showFormat: text("show_format").notNull().default("live"),
  recordingUrl: text("recording_url").notNull().default(""),
  introStyle: text("intro_style").notNull().default("virtual"),
  // Artwork for this show. Separate from the person's own photo, and what
  // the public lineup prefers when it is set.
  imageUrl: text("image_url").notNull().default(""),
  // Whether they want an interviewer, or a guest found for them. Only asked of
  // a live slot — a pre-recorded episode is already made.
  interviewNeed: text("interview_need").notNull().default("none"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull().default(""),
});
export type EventShowRow = typeof eventShows.$inferSelect;

export const eventShowFieldsSchema = z.object({
  showName: z.string().trim().min(1, "Give your show a name").max(120, "Keep it under 120 characters"),
  showFormat: z.enum(["live", "prerecorded"]),
  recordingUrl: optionalUrl("episode"),
  introStyle: z.enum(["virtual", "straight"]),
  interviewNeed: z.enum(["none", "interview_me", "find_guest"]).default("none"),
});
export const insertEventShowSchema = eventShowFieldsSchema.superRefine((v, ctx) => {
  // Same rule the profile had: we cannot air a pre-recorded slot without the file.
  if (v.showFormat === "prerecorded" && !v.recordingUrl) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["recordingUrl"],
      message: "Add a link to the episode you want us to play",
    });
  }
});

/**
 * One row per nudge actually sent. The whole safety of a scheduled sender
 * rests on this: the sender is idempotent because it checks here first, so a
 * cron that fires twice, or a redeploy mid-run, cannot email anyone twice.
 */
/**
 * "Remind me later" on a broadcast.
 *
 * Distinct from `reminders`, which is a *fan* asking to be told before a show
 * starts. This is a podcaster saying "not now" to something we asked them for
 * — so it re-sends the same email three days on rather than nagging them the
 * next morning or, worse, never following up at all.
 *
 * Keyed one per (email, broadcast): clicking twice queues one follow-up, and
 * the unique index is what enforces it rather than a check that two concurrent
 * clicks could both pass.
 */
export const followUps = pgTable("follow_ups", {
  id: serial("id").primaryKey(),
  email: text("email").notNull(),
  broadcastId: integer("broadcast_id").notNull(),
  dueAtUtc: text("due_at_utc").notNull(),
  createdAt: text("created_at").notNull(),
  /** Empty until it goes out; the claim that sets it is what stops a double send. */
  sentAt: text("sent_at").notNull().default(""),
}, (t) => ({
  once: uniqueIndex("follow_ups_email_broadcast_idx").on(t.email, t.broadcastId),
}));
export type FollowUpRow = typeof followUps.$inferSelect;

export const nudges = pgTable("nudges", {
  id: serial("id").primaryKey(),
  signupId: integer("signup_id").notNull(),
  kind: text("kind").notNull(),
  // False when the stage was passed over rather than emailed — a late booking
  // shouldn't get "two weeks to go" after it has already had "you're on soon".
  emailed: boolean("emailed").notNull().default(true),
  sentAt: text("sent_at").notNull(),
}, (t) => ({
  // Declared here, not only in the migration, so drizzle-kit push produces it
  // too. This constraint is the thing that actually prevents a double send —
  // it must exist however the schema was created.
  signupKind: uniqueIndex("nudges_signup_kind_idx").on(t.signupId, t.kind),
}));
export type NudgeRow = typeof nudges.$inferSelect;

// ---------------------------------------------------------------------------
// Campaign posts — the pre-designed social posts a podcaster ticks, which we
// then publish from their own accounts on schedule.
// ---------------------------------------------------------------------------
export const CAMPAIGN_KINDS = ["join", "share", "about", "twoweeks", "thisweek", "today"] as const;
export type CampaignKind = (typeof CAMPAIGN_KINDS)[number];
export const CAMPAIGN_STATUSES = ["planned", "posting", "posted", "failed"] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];

export const campaignPosts = pgTable("campaign_posts", {
  id: serial("id").primaryKey(),
  signupId: integer("signup_id").notNull(),
  kind: text("kind").notNull(),
  platforms: text("platforms").notNull().default(""), // comma-joined
  scheduledFor: text("scheduled_for").notNull(), // ISO
  status: text("status").notNull().default("planned"),
  postedAt: text("posted_at").notNull().default(""),
  error: text("error").notNull().default(""),
  createdAt: text("created_at").notNull().default(""),
  updatedAt: text("updated_at").notNull().default(""),
}, (t) => ({
  signupKind: uniqueIndex("campaign_posts_signup_kind_idx").on(t.signupId, t.kind),
}));
export type CampaignPostRow = typeof campaignPosts.$inferSelect;

// A visitor who asked the help chat to talk to a person.
export const helpRequests = pgTable("help_requests", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().default(""),
  email: text("email").notNull(),
  question: text("question").notNull().default(""),
  transcript: text("transcript").notNull().default(""),
  page: text("page").notNull().default(""),
  status: text("status").notNull().default("open"), // open | answered
  createdAt: text("created_at").notNull().default(""),
});
export type HelpRequestRow = typeof helpRequests.$inferSelect;

/** In order. A later stage suppresses every earlier one. */
export const NUDGE_KINDS = ["prep", "final", "onair"] as const;
export type NudgeKind = (typeof NUDGE_KINDS)[number];

export const youtubeAccounts = pgTable("youtube_accounts", {
  id: serial("id").primaryKey(),
  email: text("email").notNull(),
  channelId: text("channel_id").notNull().default(""),
  channelTitle: text("channel_title").notNull().default(""),
  // The refresh token is the durable credential; the access token is a cache.
  refreshToken: text("refresh_token").notNull(),
  accessToken: text("access_token").notNull().default(""),
  expiresAt: text("expires_at").notNull().default(""),
  createdAt: text("created_at").notNull(),
});
export type YoutubeAccountRow = typeof youtubeAccounts.$inferSelect;

export const DESTINATION_PLATFORMS = ["youtube", "x", "twitch", "linkedin", "instagram", "custom"] as const;

export const destinationInputSchema = z.object({
  platform: z.enum(DESTINATION_PLATFORMS).default("custom"),
  label: z.string().trim().max(80).default(""),
  rtmpUrl: z
    .string()
    .trim()
    .min(1, "Paste the RTMP server URL")
    .refine((v) => /^rtmps?:\/\/[^\s]+$/i.test(v), "That should start with rtmp:// or rtmps://"),
  streamKey: z.string().trim().min(1, "Paste the stream key").max(500),
  enabled: z.boolean().default(true),
  signupId: z.number().int().positive().optional(),
});
export type DestinationInput = z.infer<typeof destinationInputSchema>;

/** What a browser is allowed to see: never the key itself. */
export interface PublicDestination {
  id: number;
  signupId: number | null;
  platform: string;
  label: string;
  rtmpUrl: string;
  keyHint: string;
  enabled: boolean;
  live: boolean;
  ownerEmail: string;
}
export const RECORDING_STATUSES = ["Recording", "Ready", "Failed"] as const;

export const studioParticipants = pgTable("studio_participants", {
  id: serial("id").primaryKey(),
  studioId: integer("studio_id").notNull(),
  // Browser-generated, stored client side, so a refresh rejoins as the same person.
  clientKey: text("client_key").notNull(),
  displayName: text("display_name").notNull().default(""),
  displayTitle: text("display_title").notNull().default(""),
  email: text("email").notNull().default(""),
  role: text("role").notNull().default("Speaker"),
  // Set when they arrive through their own link (/studio?s=<signup>), so a
  // scene can find its podcaster without guessing from the name.
  signupId: integer("signup_id"),
  state: text("state").notNull().default("Green room"),
  camReady: boolean("cam_ready").notNull().default(false),
  micReady: boolean("mic_ready").notNull().default(false),
  lastSeenAt: text("last_seen_at").notNull(),
  createdAt: text("created_at").notNull(),
});
export type StudioParticipantRow = typeof studioParticipants.$inferSelect;

export const studioJoinSchema = z.object({
  clientKey: z.string().trim().min(8).max(64),
  displayName: z.string().trim().min(1, "Tell us your name").max(80),
  email: z.string().trim().max(200),
  signupId: z.number().int().positive().optional(),
});

export const studioHeartbeatSchema = z.object({
  clientKey: z.string().trim().min(8).max(64),
  camReady: z.boolean(),
  micReady: z.boolean(),
});

export const LOGO_CORNERS = ["top-left", "top-right", "bottom-left", "bottom-right"] as const;
export type LogoCorner = (typeof LOGO_CORNERS)[number];

export const studioUpdateSchema = z.object({
  name: z.string().trim().max(80).optional(),
  status: z.enum(STUDIO_STATUSES).optional(),
  maxOnStage: z.number().int().min(1).max(12).optional(),
  fallbackVideoUrl: z.string().trim().max(500).optional(),
  fallbackLabel: z.string().trim().max(120).optional(),
  fallbackPlaying: z.boolean().optional(),
  stageMediaUrl: z.string().trim().max(600).optional(),
  stageMediaKind: z.enum(["video", "image"]).optional(),
  stageMediaLabel: z.string().trim().max(120).optional(),
  stageMediaPlaying: z.boolean().optional(),
  logoUrl: z.string().trim().max(600).optional(),
  logoCorner: z.enum(LOGO_CORNERS).optional(),
  logoSize: z.number().int().min(40).max(320).optional(),
  logoVisible: z.boolean().optional(),
  backgroundUrl: z.string().trim().max(600).optional(),
  backgroundVisible: z.boolean().optional(),
  bannerTitle: z.string().trim().max(80).optional(),
  bannerSubtitle: z.string().trim().max(120).optional(),
  bannerVisible: z.boolean().optional(),
  tickerText: z.string().trim().max(600).optional(),
  tickerVisible: z.boolean().optional(),
});


/** Everything a scene card carries. Kind decides which of the rest matter. */
export const sceneInputSchema = z.object({
  name: z.string().trim().min(1).max(60),
  kind: z.enum(SCENE_KINDS).default("camera"),
  mediaUrl: z.string().trim().max(600).default(""),
  mediaKind: z.enum(["video", "image"]).default("video"),
  mediaLabel: z.string().trim().max(120).default(""),
  countdownSeconds: z.number().int().min(5).max(7200).default(300),
  startAtUtc: z.string().trim().max(40).default(""),
  runItemId: z.number().int().min(0).default(0),
  bannerTitle: z.string().trim().max(80).default(""),
  bannerSubtitle: z.string().trim().max(120).default(""),
});
export const scenePatchSchema = sceneInputSchema.partial();

/** A participant counts as present if we heard from them recently. */
export const PRESENCE_WINDOW_MS = 25_000;

// ---------------------------------------------------------------------------
// CRM — contacts and broadcast emails
// ---------------------------------------------------------------------------

export const contacts = pgTable("contacts", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().unique(),
  firstName: text("first_name").notNull().default(""),
  lastName: text("last_name").notNull().default(""),
  source: text("source").notNull().default("csv"),
  status: text("status").notNull().default("active"),
  // Funnel stage: lead → engaged → signed_up → no_show → alumni
  lifecycleStage: text("lifecycle_stage").notNull().default("lead"),
  importedAt: text("imported_at").notNull(),
  lastEngagedAt: text("last_engaged_at").notNull().default(""),
});
export type ContactRow = typeof contacts.$inferSelect;

// Saved segment — a named filter that can be used as a broadcast target
export const segments = pgTable("segments", {
  id: serial("id").primaryKey(),
  eventId: integer("event_id"),
  name: text("name").notNull(),
  // JSON-encoded filter definition
  filterJson: text("filter_json").notNull().default("{}"),
  createdAt: text("created_at").notNull(),
});
export type SegmentRow = typeof segments.$inferSelect;

export const broadcasts = pgTable("broadcasts", {
  id: serial("id").primaryKey(),
  // null = global (sent from the standalone CRM tab); number = event-scoped
  eventId: integer("event_id"),
  subject: text("subject").notNull(),
  bodyText: text("body_text").notNull(),
  status: text("status").notNull().default("draft"),
  // Which contacts to send to: "signups"|"contacts"|"all"|"segment:<id>"
  segment: text("segment").notNull().default("contacts"),
  // "team" = MilitaryVoice.ai Team, "rico" = Riccoh Player with signature
  sender: text("sender").notNull().default("team"),
  // header banner image key: "welcome" | "podcasters" | "marathon" | "schedule"
  banner: text("banner").notNull().default("welcome"),
  recipientCount: integer("recipient_count"),
  sentAt: text("sent_at"),
  scheduledFor: text("scheduled_for"),
  source: text("source").notNull().default("manual"),
  createdAt: text("created_at").notNull(),
});
export type BroadcastRow = typeof broadcasts.$inferSelect;

export const eventTeam = pgTable("event_team", {
  id: serial("id").primaryKey(),
  eventId: integer("event_id").notNull(),
  name: text("name").notNull(),
  title: text("title").notNull(),
  email: text("email").notNull().default(""),
  photoUrl: text("photo_url").notNull().default(""),
  createdAt: text("created_at").notNull(),
});
export type EventTeamMember = typeof eventTeam.$inferSelect;

// One row per recipient per broadcast — links resend message ID to contact
export const broadcastSends = pgTable("broadcast_sends", {
  id: serial("id").primaryKey(),
  broadcastId: integer("broadcast_id").notNull(),
  email: text("email").notNull(),
  resendId: text("resend_id").notNull().default(""),
  sentAt: text("sent_at").notNull(),
});
export type BroadcastSend = typeof broadcastSends.$inferSelect;

// Resend webhook events per message
export const broadcastEvents = pgTable("broadcast_events", {
  id: serial("id").primaryKey(),
  resendId: text("resend_id").notNull(),
  eventType: text("event_type").notNull(), // delivered | opened | clicked | bounced | complained
  occurredAt: text("occurred_at").notNull(),
  url: text("url").notNull().default(""), // for click events
});
export type BroadcastEvent = typeof broadcastEvents.$inferSelect;

// Log of CSV import batches — one row per import action
export const contactImports = pgTable("contact_imports", {
  id: serial("id").primaryKey(),
  importedByEmail: text("imported_by_email").notNull().default(""),
  inserted: integer("inserted").notNull().default(0),
  updated: integer("updated").notNull().default(0),
  total: integer("total").notNull().default(0),
  importedAt: text("imported_at").notNull(),
});
export type ContactImport = typeof contactImports.$inferSelect;

// Slide decks uploaded by a producer or podcaster for a show
export const presentations = pgTable("presentations", {
  id: serial("id").primaryKey(),
  studioId: integer("studio_id").notNull(),
  name: text("name").notNull().default("Presentation"),
  createdAt: text("created_at").notNull(),
});
export type PresentationRow = typeof presentations.$inferSelect;

export const presentationSlides = pgTable("presentation_slides", {
  id: serial("id").primaryKey(),
  presentationId: integer("presentation_id").notNull(),
  slideIndex: integer("slide_index").notNull().default(0),
  url: text("url").notNull(),
  createdAt: text("created_at").notNull(),
});
export type PresentationSlideRow = typeof presentationSlides.$inferSelect;
