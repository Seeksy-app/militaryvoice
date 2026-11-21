// The AI guides a podcaster can pick (Andrew, 21 Nov 2026: "let them choose their assistance during
// onboarding. Give them some faces to choose from, a voice." On the six: "on guides they are fine", then "looks
// good", "can we ask the user the age they want, some may want younger", and "remember, these need to be able
// to become interacting image/talking like alex").
//
// Each guide comes Younger (late 20s) and Older (50s): the same invented person, the same clothing family.
// Portraits are AI-generated (fal flux-pro ultra, then flux-pro kontext to close the mouth and set the age); the
// veteran look is clothing only, never insignia, and no card calls a guide a veteran. Every portrait is ready to
// become a talking avatar: front-facing, shoulders up, mouth closed and relaxed, eyes to camera, plain background,
// nothing near the mouth or chin. Masters (1024×1024) are in R2 at guides/master/<id>-<age>.jpg; how they become
// talking faces is in the notes at the end of this file.
//
// Voices are ElevenLabs; Madison stays Alex's and is never a guide. Every guide is an AI guide, never a person.
// Faces: client/public/guides/<id>-<age>.webp. Samples: client/public/guides/<id>-<age>.mp3, made once by
// scripts/make-guide-samples.ts saying sampleLine(name), so "Hear me" never spends text-to-speech live.

export type GuideId = "lori" | "marcus" | "rosa" | "dan" | "mei" | "jay";
export type GuideAge = "younger" | "older";
export type GuideVersion = { avatarUrl: string; voiceId: string; voiceName: string };
export type Guide = {
  id: GuideId;
  name: string;
  /** How the voice sounds, under the name on the card. */
  voice: string;
  /** The version a card shows first. */
  defaultAge: GuideAge;
  /** The default version's voice (same as ages[defaultAge].voiceId). */
  voiceId: string;
  voiceName: string;
  /** What the portrait shows, for the team and alt text. */
  look: string;
  ages: Record<GuideAge, GuideVersion>;
};

const v = (id: string, age: GuideAge, voiceId: string, voiceName: string): GuideVersion => ({ avatarUrl: `/guides/${id}-${age}.webp`, voiceId, voiceName });
const guide = (id: GuideId, name: string, voice: string, defaultAge: GuideAge, look: string, younger: [string, string], older: [string, string]): Guide => {
  const ages = { younger: v(id, "younger", ...younger), older: v(id, "older", ...older) };
  return { id, name, voice, defaultAge, voiceId: ages[defaultAge].voiceId, voiceName: ages[defaultAge].voiceName, look, ages };
};

export const GUIDES: Guide[] = [
  guide("lori", "Lori", "Warm, steady", "older", "Woman with shoulder-length light brown hair, navy blazer", ["zHGX9VSXpW8cGSDRCqy0", "Emily"], ["DXFkLCBUTmvXpp2QwZjA", "Eryn"]),
  guide("marcus", "Marcus", "Deep, calm", "older", "Black man with a close-cut beard, field jacket", ["sR8sxaLJeFSh308Gi6HS", "Bill (calm, friendly)"], ["nPczCjzI2devNBz1zQrb", "Brian"]),
  guide("rosa", "Rosa", "Bright, quick", "younger", "Latina woman with a dark ponytail, navy quarter-zip", ["cgSgspJ2msm6clMCkdW9", "Jessica"], ["hpp4J3VqNfWAUOO0d1Us", "Bella"]),
  guide("dan", "Dan", "Gravelly, easy", "older", "White man with a crew cut, olive work shirt", ["bIHbv24MWmeRgasZH58o", "Will"], ["pqHfZKP75CvOlQylNhV4", "Bill (wise, mature)"]),
  guide("mei", "Mei", "Clear, crisp", "older", "East Asian woman with a short bob, flight-style jacket", ["EXAVITQu4vr4xnSDxMaL", "Sarah"], ["56AoDkrOh6qfVPDXZ7Pt", "Cassidy"]),
  guide("jay", "Jay", "Upbeat, friendly", "younger", "South Asian man with short dark hair, grey sweatshirt", ["TX3LPaxmHKxFdv7VOQHJ", "Liam"], ["iP95p4xoKVk53GoZ742B", "Chris"]),
];

export const DEFAULT_GUIDE: GuideId = "lori";
export const guideById = (id: string): Guide | undefined => GUIDES.find((g) => g.id === id);
export const isAge = (a: unknown): a is GuideAge => a === "younger" || a === "older";
const ageOf = (id: string, age?: string): GuideAge => (isAge(age) ? age : guideById(id)?.defaultAge ?? "older");
/** The portrait, as the site serves it. */
export const guideFace = (id: string, age?: string): string => `/guides/${id}-${ageOf(id, age)}.webp`;
/** The pre-made "Hear me" clip. */
export const guideSample = (id: string, age?: string): string => `/guides/${id}-${ageOf(id, age)}.mp3`;
/** Full-resolution master in R2, for a talking avatar. */
export const guideMaster = (id: string, age?: string): string => `guides/master/${id}-${ageOf(id, age)}.jpg`;
export const sampleLine = (name: string): string => `Hi, I'm ${name}. Ask me how to do anything here and I'll point you to it.`;
/** Which guide and age saved settings belong to (Lori's first two accounts predate guideId: matched on voice). */
export function guideOfSettings(s: { guideId?: string; guideAge?: string; voiceId: string }): { id: GuideId; age: GuideAge } | null {
  const g = guideById(s.guideId ?? "");
  if (g) return { id: g.id, age: ageOf(g.id, s.guideAge) };
  for (const x of GUIDES) for (const a of ["younger", "older"] as const) if (x.ages[a].voiceId === s.voiceId) return { id: x.id, age: a };
  return null;
}

/*
 * Making a guide a talking face (when Andrew asks), the way Alex works today:
 *
 * - Alex today: LiveAvatar (HeyGen's real-time avatar API, api.liveavatar.com), LITE mode, key LIVEAVATAR_API_KEY.
 *   Her avatar id is 8532b602-89e8-44fa-a9e2-5a4259a058cc (still "Marianne" on their side). The session's
 *   livekit_config puts her straight into our LiveKit room as a participant; we push her speech (ElevenLabs
 *   Madison) to her media socket, and LiveAvatar lip-syncs it. See scripts/alex-converse.ts and scripts/alex-join.ts.
 * - A guide the same way: create a photo avatar in LiveAvatar from guideMaster(id, age) (a still photo is enough
 *   for a photo avatar; no consent video, since these are invented people), store its avatar id beside the voice,
 *   and start LITE sessions with the guide's own ElevenLabs voice pushed in, as for Alex.
 * - Cost: LITE is 1 LiveAvatar credit a minute, about $0.10–0.13 a minute depending on the plan (FULL mode,
 *   where they supply the voice and brain, is 2 credits). Custom avatars need a paid plan; Enterprise includes 3,
 *   then $500 each a year. Check the current plan's price before switching it on for everyone.
 * - Cheaper, not live: a recorded answer as a short video with fal's kling-video/ai-avatar (already used for
 *   SmartLink talking intros in server/bioPage.ts), per clip rather than per minute.
 */
