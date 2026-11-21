// The AI guides a podcaster can pick (Andrew, 21 Nov 2026: "let them choose their assistance during
// onboarding. Give them some faces to choose from, a voice."). Each face is an AI-generated portrait of an
// invented person (fal flux-pro ultra, the same studio style as Lori's); each voice is an ElevenLabs voice.
// Madison stays Alex's and is never a guide. Every guide is an AI guide, never presented as a person.
//
// The sample line is pre-made: guides/samples/<key>.mp3 in R2 (scripts/make-guide-samples.ts), served by
// GET /api/guides/<key>/sample, so "Hear me" never spends text-to-speech live. Change a line here, re-run the script.

export type GuideOption = {
  key: string;
  name: string;
  /** Under the name on the card. */
  blurb: string;
  /** Absolute, as guide:<email>.avatarUrl stores it. */
  avatarUrl: string;
  voiceId: string;
  /** The ElevenLabs voice's own name, for the team (not shown to podcasters). */
  voiceName: string;
  sample: string;
};

const ORIGIN = "https://www.militaryvoices.ai";

export const GUIDES: GuideOption[] = [
  {
    key: "lori", name: "Lori", blurb: "Warm and clear", avatarUrl: `${ORIGIN}/lori.jpg`,
    voiceId: "DXFkLCBUTmvXpp2QwZjA", voiceName: "Eryn",
    sample: "Hi, I'm Lori, your AI guide. Tell me what you want to do, and I'll show you exactly where to click.",
  },
  {
    key: "marcus", name: "Marcus", blurb: "Calm and steady", avatarUrl: `${ORIGIN}/guides/marcus.jpg`,
    voiceId: "nPczCjzI2devNBz1zQrb", voiceName: "Brian",
    sample: "Hey, I'm Marcus, your AI guide. We'll take this one step at a time: your show, your page, your clips. Just ask.",
  },
  {
    key: "elena", name: "Elena", blurb: "Upbeat and quick", avatarUrl: `${ORIGIN}/guides/elena.jpg`,
    voiceId: "zHGX9VSXpW8cGSDRCqy0", voiceName: "Emily",
    sample: "Hi, I'm Elena, your AI guide. Stuck on something? Ask me, and I'll point you right to it.",
  },
  {
    key: "jake", name: "Jake", blurb: "Easygoing and direct", avatarUrl: `${ORIGIN}/guides/jake.jpg`,
    voiceId: "iP95p4xoKVk53GoZ742B", voiceName: "Chris",
    sample: "Hey, I'm Jake, your AI guide. Tell me what you're after, and I'll get you there fast.",
  },
  {
    key: "grace", name: "Grace", blurb: "Patient and thorough", avatarUrl: `${ORIGIN}/guides/grace.jpg`,
    voiceId: "XrExE9yKIg1WjnnlVkGX", voiceName: "Matilda",
    sample: "Hello, I'm Grace, your AI guide. There's no rush. Ask me anything, and we'll work through it together.",
  },
  {
    key: "sam", name: "Sam", blurb: "Seasoned and friendly", avatarUrl: `${ORIGIN}/guides/sam.jpg`,
    voiceId: "pqHfZKP75CvOlQylNhV4", voiceName: "Bill",
    sample: "Hi there, I'm Sam, your AI guide. Ask me how anything works, and I'll walk you through it.",
  },
];

export const guideByKey = (k: string) => GUIDES.find((g) => g.key === k);
/** Which guide an account has now: matched on its voice and face (a rename keeps the match). */
export const guideOf = (s: { voiceId: string; avatarUrl: string }) =>
  GUIDES.find((g) => g.voiceId === s.voiceId && g.avatarUrl === s.avatarUrl) ?? GUIDES.find((g) => g.voiceId === s.voiceId);
export const sampleKey = (k: string) => `guides/samples/${k}.mp3`;
