// The AI guides a podcaster can pick (Andrew, 21 Nov 2026: "let them choose their assistance during
// onboarding. Give them some faces to choose from, a voice." Then, on the six: "on guides they are fine").
// Each face is an AI-generated portrait of an invented person (fal flux-pro ultra, Lori's studio style);
// the veteran look comes from clothing only, never insignia. Each voice is an ElevenLabs voice; Madison
// stays Alex's and is never a guide. Every guide is an AI guide, never presented as a person.
//
// Faces: client/public/guides/<id>.webp (Lori: /lori.webp). Samples: client/public/guides/<id>.mp3, made once
// by scripts/make-guide-samples.ts saying sampleLine(name), so "Hear me" never spends text-to-speech live.

export type GuideId = "lori" | "marcus" | "rosa" | "dan" | "mei" | "jay";
export type Guide = {
  id: GuideId;
  name: string;
  /** How the voice sounds, under the name on the card. */
  voice: string;
  /** ElevenLabs voice. */
  voiceId: string;
  /** The ElevenLabs voice's own name, for the team. */
  voiceName: string;
  /** What the portrait shows (the prompt's gist), for the team and alt text. */
  look: string;
};

export const GUIDES: Guide[] = [
  { id: "lori", name: "Lori", voice: "Warm, steady", voiceId: "DXFkLCBUTmvXpp2QwZjA", voiceName: "Eryn", look: "Woman in her 40s, shoulder-length light brown hair, navy blazer" },
  { id: "marcus", name: "Marcus", voice: "Deep, calm", voiceId: "nPczCjzI2devNBz1zQrb", voiceName: "Brian", look: "Black man in his 50s, close-cut grey beard, olive field jacket" },
  { id: "rosa", name: "Rosa", voice: "Bright, quick", voiceId: "cgSgspJ2msm6clMCkdW9", voiceName: "Jessica", look: "Latina woman in her 30s, dark ponytail, navy quarter-zip" },
  { id: "dan", name: "Dan", voice: "Gravelly, easy", voiceId: "pqHfZKP75CvOlQylNhV4", voiceName: "Bill", look: "White man in his 60s, silver crew cut, olive work shirt" },
  { id: "mei", name: "Mei", voice: "Clear, crisp", voiceId: "56AoDkrOh6qfVPDXZ7Pt", voiceName: "Cassidy", look: "East Asian woman in her 40s, short bob, flight-style jacket" },
  { id: "jay", name: "Jay", voice: "Upbeat, friendly", voiceId: "TX3LPaxmHKxFdv7VOQHJ", voiceName: "Liam", look: "South Asian man in his 20s, headphones round his neck, grey sweatshirt" },
];

export const DEFAULT_GUIDE: GuideId = "lori";
export const guideById = (id: string): Guide | undefined => GUIDES.find((g) => g.id === id);
/** The portrait, as the site serves it. */
export const guideFace = (id: string): string => (id === "lori" ? "/lori.webp" : `/guides/${id}.webp`);
/** The pre-made "Hear me" clip. */
export const guideSample = (id: string): string => `/guides/${id}.mp3`;
export const sampleLine = (name: string): string => `Hi, I'm ${name}. Ask me how to do anything here and I'll point you to it.`;
/** Which guide saved settings belong to, for accounts set up before guideId was stored (Lori's first two). */
export const guideOfSettings = (s: { guideId?: string; voiceId: string }): GuideId | null =>
  (guideById(s.guideId ?? "")?.id) ?? GUIDES.find((g) => g.voiceId === s.voiceId)?.id ?? null;
