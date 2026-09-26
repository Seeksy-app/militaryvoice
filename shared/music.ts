/**
 * Pōstify's music: our own library, generated once with ElevenLabs Music
 * (cleared for commercial use on a paid plan) so every podcaster can use it
 * and none of it trips a copyright claim. Instrumental, so it sits under a
 * voice; each loops if a clip runs longer.
 */
export interface MusicSeed { key: string; name: string; mood: string; prompt: string; seconds: number }

export const MUSIC_SEEDS: MusicSeed[] = [
  { key: "honor-march", name: "Honor March", mood: "Proud", seconds: 90, prompt: "Instrumental modern military march, snare drum cadence, warm brass and strings, proud and uplifting, steady 110 bpm, no vocals, suitable as background under speech" },
  { key: "rise-up", name: "Rise Up", mood: "Inspiring", seconds: 90, prompt: "Instrumental inspiring cinematic build, piano ostinato into full strings and big drums, hopeful and triumphant, 100 bpm, no vocals, background music for a motivational video" },
  { key: "mission-ready", name: "Mission Ready", mood: "Energetic", seconds: 90, prompt: "Instrumental high-energy electronic rock, driving drums, palm-muted guitars and synth pulse, confident and bold, 128 bpm, no vocals, for a sports or action promo" },
  { key: "steady-course", name: "Steady Course", mood: "Corporate", seconds: 90, prompt: "Instrumental upbeat modern corporate, clean electric guitar plucks, light claps, soft synth pads, positive and professional, 115 bpm, no vocals, for a podcast or business video" },
  { key: "night-watch", name: "Night Watch", mood: "Chill", seconds: 90, prompt: "Instrumental lo-fi hip hop, dusty drums, mellow Rhodes chords, vinyl crackle, relaxed late-night mood, 80 bpm, no vocals, study-beat background" },
  { key: "open-road", name: "Open Road", mood: "Warm", seconds: 90, prompt: "Instrumental warm acoustic folk, strummed acoustic guitar, light percussion and whistling-free, optimistic Americana, 105 bpm, no vocals, feel-good background" },
  { key: "the-briefing", name: "The Briefing", mood: "Serious", seconds: 90, prompt: "Instrumental tense documentary underscore, low pulsing synths, ticking percussion, subtle strings, serious and focused, 90 bpm, no vocals, news or investigation background" },
  { key: "homecoming", name: "Homecoming", mood: "Emotional", seconds: 90, prompt: "Instrumental emotional piano and cello, gentle and heartfelt, slowly building, reflective and grateful, 70 bpm, no vocals, tribute or storytelling background" },
  { key: "boots-on", name: "Boots On", mood: "Hype", seconds: 90, prompt: "Instrumental hard-hitting trap beat, heavy 808 bass, crisp hi-hats, dark cinematic brass stabs, confident swagger, 140 bpm half-time, no vocals, for social media shorts" },
  { key: "sunrise-pt", name: "Sunrise PT", mood: "Upbeat", seconds: 90, prompt: "Instrumental upbeat funky pop, slap bass, bright horns, handclaps, fun and energetic morning vibe, 118 bpm, no vocals, feel-good social video" },
  { key: "field-notes", name: "Field Notes", mood: "Ambient", seconds: 90, prompt: "Instrumental ambient soundscape, soft evolving pads, gentle piano notes, airy and calm, no drums, no vocals, unobtrusive background under talking" },
  { key: "last-light", name: "Last Light", mood: "Cinematic", seconds: 90, prompt: "Instrumental epic cinematic trailer music, deep taiko drums, soaring strings and choir-like pads without words, heroic and grand, 95 bpm, no vocals" },
];
