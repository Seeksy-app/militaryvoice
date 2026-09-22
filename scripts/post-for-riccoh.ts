// Post the Genius Network thank-you card from Riccoh's connected accounts,
// now or at a set time, through Upload-Post's scheduler.
//
//   npx tsx scripts/post-for-riccoh.ts                                   # preview
//   npx tsx scripts/post-for-riccoh.ts --at "2026-09-23 09:00" --apply   # schedule, Eastern
//   npx tsx scripts/post-for-riccoh.ts --now --apply                     # post right away
//   npx tsx scripts/post-for-riccoh.ts --list                            # what's waiting
//   npx tsx scripts/post-for-riccoh.ts --cancel <job_id>
//   --platforms linkedin,instagram,facebook   (default: all three)
import "dotenv/config";
import { publishPhoto, listScheduledPosts, cancelScheduledPost } from "../server/uploadPost";

const args = process.argv.slice(2);
const flag = (n: string) => { const i = args.indexOf(n); return i > -1 ? args[i + 1] : ""; };
const USER = "mv-3"; // Riccoh's Upload-Post profile
const TZ = "America/New_York";
const IMAGE = "https://www.militaryvoice.ai/creative/thank-you-genius-network-square.jpg";
const platforms = (flag("--platforms") || "linkedin,instagram,facebook").split(",").map((p) => p.trim()).filter(Boolean);

const title = "Thank you, Genius Network";
const caption = `Grateful to Genius Network for stepping up as the first sponsor of The Podcast Marathon. They're presenting the START at 7:00 AM and the FINISH at 10:00 PM on Monday, October 5, the first and last of 26.2 miles of military and veteran stories, live and back to back for National Military Podcast Day.

Watch the whole day at militaryvoice.ai

If you'd like to be a sponsor of this amazing event, click here: https://www.militaryvoice.ai/sponsor

#NationalMilitaryPodcastDay #ThePodcastMarathon #GeniusNetwork`;

if (args.includes("--list")) {
  const jobs = await listScheduledPosts(USER);
  if (!jobs.length) console.log("Nothing scheduled for Riccoh.");
  for (const j of jobs) console.log(`${j.job_id}  ${j.scheduled_date}  ${j.post_type}  ${j.title}`);
  process.exit(0);
}
if (flag("--cancel")) { await cancelScheduledPost(flag("--cancel")); console.log("cancelled"); process.exit(0); }

const at = flag("--at");
const now = args.includes("--now");
const scheduledDate = at ? new Date(at.replace(" ", "T")).toISOString().replace(/\.\d{3}Z$/, "") : "";
console.log(`As: ${USER}\nTo: ${platforms.join(", ")}\nWhen: ${now ? "now" : at ? `${at} Eastern` : "(no time given)"}\nImage: ${IMAGE}\n\n${caption}\n`);
if (!args.includes("--apply")) { console.log("Nothing posted. --apply with --now or --at to go."); process.exit(0); }
if (!now && !at) { console.log("Give --now or --at."); process.exit(1); }
const result = await publishPhoto({ username: USER, platforms, photoUrl: IMAGE, title, description: caption, ...(now ? {} : { scheduledDate: at.replace(" ", "T"), timezone: TZ }) });
console.log(JSON.stringify(result, null, 2));
