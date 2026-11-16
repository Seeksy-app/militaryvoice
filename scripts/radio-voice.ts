// MilitaryVoices Radio's spoken clips: the welcome at go-time, the sign-off at ten, and an intro and an outro for
// every booking. Alex's voice (ElevenLabs) over a soft music bed from our own library, mixed here with ffmpeg
// (the web servers have none) and put in R2. Run it again whenever bookings change: only clips whose words
// changed are made again.
//
//   npx tsx --env-file=.env scripts/radio-voice.ts            (make what is missing or changed)
//   npx tsx --env-file=.env scripts/radio-voice.ts --force    (make everything again)
//
// Words (Andrew, 15 Nov 2026): never claim the station is "live" as a whole; recorded shows are "an encore of";
// Riccoh is spoken "Reeko"; "live" is spelled "lyve" so it has the long I; calm delivery.
import "dotenv/config";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { storage } from "../server/storage.js";
import { signedRecordingUrl, putRecordingObject } from "../server/recordingStorage.js";
import { dxEventIds } from "../server/digitalExperience.js";
import { bookingTimes } from "../server/booth.js";

const VOICE = "NUjosfEayZAdRcDmcHM8";
const FORCE = process.argv.includes("--force");
const dir = mkdtempSync(path.join(tmpdir(), "radio-voice-"));
const ET = "America/New_York";

const say = (v: string) =>
  v.replace(/riccoh/gi, "Reeko").replace(/p[oō]stify/gi, "Post-ify").replace(/&/g, "and").replace(/\bLt\.? ?Gen\.?/gi, "Lieutenant General")
    .replace(/\blive\b/gi, "lyve");
const hash = (t: string) => crypto.createHash("sha1").update(t).digest("hex").slice(0, 10);
const spokenTime = (iso: string) => {
  const d = new Date(iso);
  const h = Number(d.toLocaleString("en-US", { timeZone: ET, hour: "numeric", hour12: false })) % 24;
  const m = Number(d.toLocaleString("en-US", { timeZone: ET, minute: "numeric" }));
  const words = ["twelve", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven"];
  const hw = words[h % 12];
  const mw = m === 0 ? "" : m === 30 ? " thirty" : ` ${m}`;
  return `${hw}${mw} ${h < 12 ? "a.m." : "p.m."}`;
};

async function tts(text: string): Promise<Buffer> {
  const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOICE}?output_format=mp3_44100_128`, {
    method: "POST",
    headers: { "xi-api-key": (process.env.ELEVENLABS_API_KEY || "").trim(), "content-type": "application/json" },
    body: JSON.stringify({ text, model_id: "eleven_multilingual_v2", voice_settings: { stability: 0.5, similarity_boost: 0.8, style: 0.25, speed: 1.0 } }),
  });
  if (!r.ok) throw new Error(`ElevenLabs ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return Buffer.from(await r.arrayBuffer());
}

const beds: Record<string, string> = {};
async function bed(key: string): Promise<string> {
  if (beds[key]) return beds[key];
  const t = await storage.getMusic(key);
  if (!t?.url) throw new Error(`No music track ${key}`);
  const r = await fetch(await signedRecordingUrl(t.url, 600));
  const f = path.join(dir, `bed-${key}.mp3`);
  writeFileSync(f, Buffer.from(await r.arrayBuffer()));
  return (beds[key] = f);
}

/** The voice, two seconds in, over the bed (low under her, up before and after), faded out; returns the file and its length. */
async function make(text: string, bedKey: string, tailSec: number): Promise<{ buf: Buffer; sec: number }> {
  const v = path.join(dir, `v-${hash(text)}.mp3`);
  writeFileSync(v, await tts(text));
  const vsec = Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", v]).toString().trim());
  const total = vsec + 2 + tailSec, voiceEnd = vsec + 2;
  const out = path.join(dir, `m-${hash(text + bedKey)}.mp3`);
  execFileSync("ffmpeg", ["-y", "-v", "error", "-i", await bed(bedKey), "-i", v, "-filter_complex",
    `[1:a]adelay=2000|2000[v];[0:a]atrim=0:${total},asetpts=PTS-STARTPTS,volume='if(lt(t,2),0.5,if(lt(t,${voiceEnd}),0.14,0.5))':eval=frame,afade=t=out:st=${total - 3}:d=3[m];[v][m]amix=inputs=2:normalize=0:duration=longest,loudnorm=I=-16:TP=-1.5:LRA=11`,
    "-t", String(total), "-c:a", "libmp3lame", "-b:a", "160k", out]);
  return { buf: readFileSync(out), sec: Math.ceil(total) };
}

/** An intro that fills the whole three-minute window: music under it throughout, and the voice placed so it ends just before they go live. */
async function makeIntro(text: string, bedKey: string, totalSec = 180, voiceAt?: number): Promise<{ buf: Buffer; sec: number }> {
  const v = path.join(dir, `iv-${hash(text)}.mp3`);
  writeFileSync(v, await tts(text));
  const vsec = Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", v]).toString().trim());
  const at = voiceAt ?? Math.max(2, totalSec - vsec - 3), vend = at + vsec;
  const out = path.join(dir, `im-${hash(text + bedKey)}.mp3`);
  execFileSync("ffmpeg", ["-y", "-v", "error", "-stream_loop", "-1", "-i", await bed(bedKey), "-i", v, "-filter_complex",
    `[1:a]adelay=${Math.round(at * 1000)}|${Math.round(at * 1000)}[v];[0:a]atrim=0:${totalSec},asetpts=PTS-STARTPTS,volume='if(lt(t,${at}),0.45,if(lt(t,${vend}),0.14,0.45))':eval=frame,afade=t=in:st=0:d=1.5,afade=t=out:st=${totalSec - 3}:d=3[m];[v][m]amix=inputs=2:normalize=0:duration=longest,loudnorm=I=-16:TP=-1.5:LRA=11`,
    "-t", String(totalSec), "-c:a", "libmp3lame", "-b:a", "160k", out]);
  return { buf: readFileSync(out), sec: totalSec };
}

type Entry = { introKey?: string; introHash?: string; outroKey?: string; outroHash?: string };
async function main() {
  const saved = JSON.parse((await storage.getSetting("dx:voice")) ?? "{}") as { welcome?: { key: string; sec: number; hash: string }; signoff?: { key: string; sec: number; hash: string }; map?: Record<string, Entry> };
  const state = { welcome: saved.welcome, signoff: saved.signoff, map: saved.map ?? {} } as { welcome?: { key: string; sec: number; hash: string }; signoff?: { key: string; sec: number; hash: string }; map: Record<string, Entry> };

  // The two day-wide clips.
  const welcomeText = "Good morning, and welcome to MilitaryVoices Radio, around the world. Weekdays, seven a.m. to ten p.m. Eastern, you'll hear the voices of veterans, service members, military spouses, and families, telling their own stories. Some are lyve, and some are top encore episodes from our archive. I'm Alex, the station's AI producer. Our first show starts in just a moment.";
  const signoffText = "That's all for today on MilitaryVoices Radio, around the world. Thank you for listening. We're back tomorrow at seven a.m. Eastern.";
  for (const [name, text, bedKey, tail] of [["welcome", welcomeText, "easy-morning", 6], ["signoff", signoffText, "soft-landing", 6]] as const) {
    const h = hash(text + bedKey);
    if (!FORCE && state[name]?.hash === h) { console.log("have", name); continue; }
    const m = await make(text, bedKey, tail);
    const key = `radio-voice/${name}-${h}.mp3`;
    await putRecordingObject(key, m.buf, "audio/mpeg");
    state[name] = { key, sec: m.sec, hash: h };
    console.log("made", name, m.sec + "s");
  }

  // A pair for every booking.
  for (const id of (await dxEventIds()).sort((a, b) => a - b)) {
    const ev = await storage.getEventById(id);
    if (!ev) continue;
    const list = (await storage.listSignups(id)).filter((s) => s.status !== "cancelled" && s.id !== 60).sort((a, b) => a.slotIndex - b.slotIndex);
    for (let i = 0; i < list.length; i++) {
      const s = list[i];
      const show = say(s.podcastName), host = say(s.hostName);
      const who = host.trim().toLowerCase() === show.trim().toLowerCase() ? show : `${show}, with ${host}`;
      const recorded = s.showFormat === "prerecorded";
      const t = bookingTimes(ev, s);
      // Up next only when the very next thing on the clock is a booking.
      const nx = list[i + 1];
      const nt = nx ? bookingTimes(ev, nx) : null;
      let next = "Stay with us.";
      if (nx && nt && nt.start - t.end <= 5 * 60_000) {
        const nshow = say(nx.podcastName), nhost = say(nx.hostName);
        next = `Up next, at ${spokenTime(new Date(nt.start).toISOString())}: ${nhost.trim().toLowerCase() === nshow.trim().toLowerCase() ? nshow : `${nshow}, with ${nhost}`}.`;
      }
      const introText = `Now, on MilitaryVoices Radio${recorded ? ", an encore of " : ": "}${who}.`;
      const outroText = `That was ${who}. Thank you for listening to MilitaryVoices Radio. ${next}`;
      const e = state.map[String(s.id)] ?? {};
      for (const [kind, text, bedKey, tail] of [["intro", introText, "open-road", 25], ["outro", outroText, "soft-landing", 20]] as const) {
        const h = hash(text + bedKey + "|full3" + (kind === "outro" ? "|voice-first" : ""));
        if (!FORCE && e[`${kind}Hash`] === h && e[`${kind}Key`]) continue;
        const m = kind === "intro" ? await makeIntro(text, bedKey) : await makeIntro(text, bedKey, 180, 2); // intro: music all window, voice at the end; outro: voice first, music all window
        const key = `radio-voice/${s.id}-${kind}-${h}.mp3`;
        await putRecordingObject(key, m.buf, "audio/mpeg");
        e[`${kind}Key`] = key; e[`${kind}Hash`] = h;
        console.log("made", s.id, kind, "|", text.slice(0, 90));
      }
      state.map[String(s.id)] = e;
      await storage.setSetting("dx:voice", JSON.stringify(state)); // save as we go
    }
  }
  await storage.setSetting("dx:voice", JSON.stringify(state));
  console.log("DONE", Object.keys(state.map).length, "bookings");
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
