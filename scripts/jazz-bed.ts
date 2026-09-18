// A soft jazz bed for the standby card, written as audio rather than stacked
// sine waves.
//
// The first version of this was three sine partials with a tremolo on them,
// which is a hum. Music needs notes that change, so this is a small synth: a
// ii–V–I–vi turnaround in F, a walking bass, chord voicings with a Rhodes-ish
// decay, and brushes on two and four. It is generated, not licensed, so it
// costs nothing and carries no attribution — and it is still a stand-in for a
// real cue, which build-standby.ts will use instead via --music.
//
//   npx tsx scripts/jazz-bed.ts out.wav 15
//
// Output is 48 kHz 16-bit stereo WAV, which ffmpeg then encodes.

import fs from "node:fs/promises";

const SR = 48_000;
const BPM = 92;
const BEAT = 60 / BPM;
const BAR = BEAT * 4;

/** Equal temperament from A4 = 440. "A4", "Bb3", "F#5". */
function hz(note: string): number {
  const m = note.match(/^([A-G])([b#]?)(-?\d)$/);
  if (!m) throw new Error(`bad note ${note}`);
  const [, letter, accidental, octave] = m;
  const base: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  const semi = base[letter] + (accidental === "#" ? 1 : accidental === "b" ? -1 : 0);
  const midi = (Number(octave) + 1) * 12 + semi;
  return 440 * Math.pow(2, (midi - 69) / 12);
}

interface Voice {
  at: number;      // seconds
  dur: number;
  freq: number;
  gain: number;
  kind: "keys" | "bass" | "brush";
}

/**
 * The turnaround. Four bars, then it starts again — long enough not to feel
 * like a two-chord loop, short enough that a viewer waiting through it does
 * not learn to hear the seam.
 */
const CHORDS: { name: string; voicing: string[]; bass: string[] }[] = [
  { name: "Gm7",   voicing: ["Bb3", "D4", "F4", "A4"],  bass: ["G2", "Bb2", "D3", "F3"] },
  { name: "C7",    voicing: ["E3", "Bb3", "D4", "G4"],  bass: ["C3", "E3", "G3", "Bb3"] },
  { name: "Fmaj7", voicing: ["A3", "C4", "E4", "G4"],   bass: ["F2", "A2", "C3", "E3"] },
  { name: "Dm7",   voicing: ["F3", "A3", "C4", "E4"],   bass: ["D3", "F3", "A3", "C4"] },
];

function score(totalSeconds: number): Voice[] {
  const out: Voice[] = [];
  const bars = Math.ceil(totalSeconds / BAR) + 1;
  for (let bar = 0; bar < bars; bar++) {
    const chord = CHORDS[bar % CHORDS.length];
    const t0 = bar * BAR;

    // Keys: a soft stab on beat 1 and a syncopated one on the "and" of 2 —
    // the comping pattern that makes this read as jazz rather than as a pad.
    for (const [offset, len, gain] of [[0, BEAT * 1.6, 0.30], [BEAT * 1.5, BEAT * 1.1, 0.20]] as const) {
      chord.voicing.forEach((n, i) => {
        out.push({ at: t0 + offset, dur: len, freq: hz(n), gain: gain * (1 - i * 0.12), kind: "keys" });
      });
    }

    // Walking bass: one note a beat, the line that carries the movement.
    chord.bass.forEach((n, i) => {
      out.push({ at: t0 + i * BEAT, dur: BEAT * 0.92, freq: hz(n), gain: 0.42, kind: "bass" });
    });

    // Brushes on 2 and 4.
    out.push({ at: t0 + BEAT, dur: 0.16, freq: 0, gain: 0.13, kind: "brush" });
    out.push({ at: t0 + BEAT * 3, dur: 0.16, freq: 0, gain: 0.13, kind: "brush" });
  }
  return out;
}

/** Attack/decay shape per instrument. Everything here decays; nothing sustains. */
function envelope(kind: Voice["kind"], t: number, dur: number): number {
  if (t < 0 || t > dur) return 0;
  const attack = kind === "brush" ? 0.002 : kind === "bass" ? 0.006 : 0.012;
  if (t < attack) return t / attack;
  const rest = (t - attack) / Math.max(1e-6, dur - attack);
  // A Rhodes-ish curve: quick initial fall, long tail.
  return Math.exp(-rest * (kind === "keys" ? 3.2 : kind === "bass" ? 4.0 : 18));
}

function timbre(kind: Voice["kind"], freq: number, t: number, rnd: () => number): number {
  if (kind === "brush") return (rnd() * 2 - 1) * 0.6;
  const w = 2 * Math.PI * freq * t;
  if (kind === "bass") {
    // Fundamental plus a touch of second harmonic: round, not buzzy.
    return Math.sin(w) * 0.85 + Math.sin(w * 2) * 0.12;
  }
  // Keys: fundamental, octave, and a quiet twelfth for the bell in the attack.
  return Math.sin(w) * 0.7 + Math.sin(w * 2) * 0.18 + Math.sin(w * 3) * 0.06;
}

/** Deterministic noise, so two runs of this produce byte-identical audio. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export function renderJazz(totalSeconds: number): Buffer {
  const n = Math.ceil(totalSeconds * SR);
  const left = new Float64Array(n);
  const right = new Float64Array(n);
  const rnd = rng(20261005);
  const voices = score(totalSeconds);

  for (const v of voices) {
    const start = Math.floor(v.at * SR);
    const len = Math.ceil(v.dur * SR);
    // Keys sit slightly wide, bass dead centre — the usual placement, and it
    // stops the mid-range crowding.
    const pan = v.kind === "keys" ? (v.freq > 330 ? 0.62 : 0.38) : 0.5;
    for (let i = 0; i < len; i++) {
      const idx = start + i;
      if (idx < 0 || idx >= n) continue;
      const t = i / SR;
      const s = timbre(v.kind, v.freq, t, rnd) * envelope(v.kind, t, v.dur) * v.gain;
      left[idx] += s * (1 - pan);
      right[idx] += s * pan;
    }
  }

  // Gentle soft-clip rather than hard limiting, then a fade at both ends.
  const fade = Math.min(Math.floor(1.2 * SR), Math.floor(n / 4));
  const pcm = Buffer.alloc(n * 4);
  for (let i = 0; i < n; i++) {
    let g = 1;
    if (i < fade) g = i / fade;
    else if (i > n - fade) g = (n - i) / fade;
    for (const [ch, buf] of [[0, left], [1, right]] as const) {
      const x = Math.tanh(buf[i] * 1.15) * 0.82 * g;
      pcm.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(x * 32767))), i * 4 + ch * 2);
    }
  }

  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);      // PCM
  header.writeUInt16LE(2, 22);      // stereo
  header.writeUInt32LE(SR, 24);
  header.writeUInt32LE(SR * 4, 28); // byte rate
  header.writeUInt16LE(4, 32);      // block align
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

if (process.argv[1]?.endsWith("jazz-bed.ts")) {
  const out = process.argv[2] ?? "jazz.wav";
  const seconds = Number(process.argv[3] ?? 15);
  await fs.writeFile(out, renderJazz(seconds));
  console.log(`${out}  ${seconds}s  ${BPM} BPM  ii–V–I–vi in F`);
}
