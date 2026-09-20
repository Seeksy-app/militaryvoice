// What time it really is, against what time it was supposed to be.
//
// One rule decides everything in here: **the schedule holds.** When a segment
// overruns, the next one still starts when the agenda says it does, and the
// time is clawed back out of what sits between them — which is Alex.
//
// The alternative, letting the running order slip, compounds. Ten minutes lost
// at Mile 4 is an hour by the finish across thirty-two slots, and the Flag
// Carry and the Closing Ceremonies have times that were published to an
// audience. So a podcaster who runs long costs Alex her intro, not Theresa her
// flag.
//
// What she must never do is take it out of the next podcaster's show. Her
// window is the gap between now and the next scheduled start, and when that
// gap is gone she says nothing at all rather than eating into somebody's
// twenty-five minutes.

export interface ClockScene {
  id: number;
  name: string;
  /** When the agenda says this goes on air. Empty for a scene with no time. */
  startAtUtc: string;
}

export type CueLength = "skip" | "short" | "standard" | "stretch";

export interface ShowClock {
  /** Positive: we are behind the agenda. Negative: ahead of it. */
  driftSeconds: number;
  /** Seconds until the next scene is due on air. Negative once it is overdue. */
  windowSeconds: number;
  /** How much Alex has room to say, derived from that window. */
  cue: CueLength;
  /** True inside the five minutes before the next segment starts. */
  fiveMinuteWarning: boolean;
  currentSceneId: number;
  nextSceneId: number;
  nextSceneName: string;
  nextStartAtUtc: string;
}

/**
 * How long she has, in the only terms that matter to her.
 *
 * The boundaries are where they are because of what she is doing in each band,
 * not because they are round numbers. Under twenty seconds there is no line
 * worth starting — a name read over a cut is worse than a clean cut. Past
 * ninety seconds she is not filling any more, she is hosting, and that is when
 * the sponsor read and the banter with Riccoh belong.
 */
export function cueFor(windowSeconds: number): CueLength {
  if (windowSeconds < 20) return "skip";
  if (windowSeconds < 45) return "short";
  if (windowSeconds <= 90) return "standard";
  return "stretch";
}

/** Roughly how many seconds each cue should be spoken in. */
export const CUE_SECONDS: Record<CueLength, number> = {
  skip: 0,
  short: 12,
  standard: 30,
  stretch: 75,
};

export function describeCue(cue: CueLength): string {
  switch (cue) {
    case "skip":
      return "No time — hand straight over";
    case "short":
      return "Name and time only";
    case "standard":
      return "The written intro";
    case "stretch":
      return "Intro, sponsor read, then banter";
  }
}

/**
 * The clock, from the running order and when the current scene actually went.
 *
 * `takenAtUtc` is when the producer pressed it, not when the agenda wanted it
 * — that difference is the whole point. With nothing taken yet there is no
 * drift to report, because a show that has not started cannot be late.
 */
export function showClock(
  scenes: ClockScene[],
  currentSceneId: number,
  takenAtUtc: string,
  now: number = Date.now(),
): ShowClock | null {
  if (!scenes.length) return null;
  const at = scenes.findIndex((s) => s.id === currentSceneId);
  if (at < 0) return null;

  const current = scenes[at];
  const next = scenes[at + 1];

  const scheduled = current.startAtUtc ? Date.parse(current.startAtUtc) : NaN;
  const taken = takenAtUtc ? Date.parse(takenAtUtc) : NaN;
  const driftSeconds =
    Number.isFinite(scheduled) && Number.isFinite(taken) ? Math.round((taken - scheduled) / 1000) : 0;

  const nextStart = next?.startAtUtc ? Date.parse(next.startAtUtc) : NaN;
  // No next scene, or no time on it, means nothing is pressing — she is not
  // being asked to fill a gap that does not exist.
  const windowSeconds = Number.isFinite(nextStart) ? Math.round((nextStart - now) / 1000) : Infinity;

  return {
    driftSeconds,
    windowSeconds,
    cue: cueFor(windowSeconds),
    // Announced once the gap is inside five minutes, and only while there is
    // still a gap — past zero the person is on, and telling somebody they are
    // up in "minus one minute" is noise at the worst moment.
    fiveMinuteWarning: windowSeconds > 0 && windowSeconds <= 300,
    currentSceneId,
    nextSceneId: next?.id ?? 0,
    nextSceneName: next?.name ?? "",
    nextStartAtUtc: next?.startAtUtc ?? "",
  };
}

/** "4 min behind" / "2 min ahead" / "on time", for anybody reading a screen. */
export function describeDrift(driftSeconds: number): string {
  const mins = Math.round(Math.abs(driftSeconds) / 60);
  if (Math.abs(driftSeconds) < 60) return "on time";
  return `${mins} min ${driftSeconds > 0 ? "behind" : "ahead"}`;
}

// ---------------------------------------------------------------------------
// Alex as the producer
// ---------------------------------------------------------------------------
//
// In a day that ran perfectly the scenes would change themselves, on the
// minute, and nobody would touch anything. Days do not run perfectly, and the
// three ways they go wrong each want a different answer:
//
//   late   — somebody is mid-sentence when their slot ends. Hold. Cutting a
//            veteran off in the middle of a story to protect a timetable is
//            the worst thing this system could do on air.
//   early  — they finished with room to spare. Go, but only if the next
//            podcaster is actually there and their camera and mic are proved.
//            Taking a scene to an empty chair is worse than a short wait.
//   on time— take it.
//
// Holding cannot be unlimited. One runaway show would eat the afternoon, so
// past the limit this stops being Alex's call and becomes a person's.

export interface AdvanceInput {
  /** Seconds until the next scene is due. Negative once it is overdue. */
  windowSeconds: number;
  /** Is anybody on stage still talking? From LiveKit's active speakers. */
  stageSpeaking: boolean;
  /** Is the next podcaster in the green room with camera and mic proved? */
  nextHostReady: boolean;
  /** How long we have already been holding past the due time. */
  heldSeconds: number;
}

export type AdvanceAction = "wait" | "take" | "take-early" | "hold" | "escalate";

export interface AdvanceDecision {
  action: AdvanceAction;
  why: string;
}

/** Past this much overrun it is a person's decision, not Alex's. */
export const HOLD_LIMIT_SECONDS = 180;

/** How early she will go when the room is ready and the stage has gone quiet. */
export const EARLY_WINDOW_SECONDS = 120;

export function decideAdvance(i: AdvanceInput): AdvanceDecision {
  // Overdue.
  if (i.windowSeconds <= 0) {
    if (!i.stageSpeaking) return { action: "take", why: "due, and the stage has gone quiet" };
    if (i.heldSeconds >= HOLD_LIMIT_SECONDS) {
      return {
        action: "escalate",
        why: `held ${Math.round(i.heldSeconds / 60)} min and they are still going — a person decides this`,
      };
    }
    return { action: "hold", why: "due, but somebody is still talking" };
  }

  // Not due yet.
  if (i.stageSpeaking) return { action: "wait", why: "still on air, and not due yet" };
  if (i.windowSeconds <= EARLY_WINDOW_SECONDS && i.nextHostReady) {
    return { action: "take-early", why: `finished early and the next host is ready` };
  }
  if (i.windowSeconds <= EARLY_WINDOW_SECONDS) {
    return { action: "wait", why: "finished early, but the next host is not ready" };
  }
  return { action: "wait", why: "nothing due" };
}
