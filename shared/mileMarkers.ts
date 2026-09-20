// Turning a running order into a race course.
//
// Twenty-six shows, twenty-six miles. That is not a coincidence worth wasting:
// a podcaster booked at 2:30pm is not "in slot 15", they are at Mile 14 — and
// one of those is a thing somebody screenshots and posts.
//
// The bookends and the bonus sessions have their own places on a course. A
// marathon is 26.2 miles, and the point-two is 385 yards — the odd distance
// tacked on in 1908 so the finish would sit in front of the royal box. The
// bonus sessions are that: the bit after the miles that is still the race.

export type MarkerKind = "start" | "mile" | "point-two" | "finish" | "open";

export interface Marker {
  kind: MarkerKind;
  /** Mile number, only on a "mile". */
  n?: number;
  /** What the sign reads. */
  label: string;
  /** The line underneath, where there is room for one. */
  sub?: string;
}

interface Booking {
  podcastName?: string | null;
  email?: string | null;
}

const isCeremony = (b?: Booking | null) => !!b && /ceremon/i.test(b.podcastName ?? "");
// The .2 sessions. They have real names now — "The Flag Carry" — and a name is
// what a reader sees, so the test has to know them by name rather than by the
// word "bonus", which was only ever a placeholder. "bonus" stays in the pattern
// so a slot still marked TBD keeps its place on the course.
const POINT_TWO = /\bbonus\b|flag carry|roll call/i;
const isBonus = (b?: Booking | null) => !!b && POINT_TWO.test(b.podcastName ?? "");

/**
 * A marker for every slot, in running order.
 *
 * Miles are counted over the shows only, so an empty slot or a bonus session
 * does not burn a number — Mile 14 stays Mile 14 whatever gets booked around
 * it. That matters because these go in emails and on social: a number that
 * shifts when somebody else books is worse than no number.
 */
export function mileMarkers<T extends { signup?: Booking | null }>(slots: T[]): Marker[] {
  const ceremonies = slots
    .map((s, i) => (isCeremony(s.signup) ? i : -1))
    .filter((i) => i >= 0);
  const first = ceremonies[0];
  const last = ceremonies.length > 1 ? ceremonies[ceremonies.length - 1] : -1;

  // The .2 is the fraction *after* the twenty-six miles, so only the bonuses
  // past the last mile are part of it, and those are the ones worth numbering
  // — B1 then B2. A bonus earlier in the day is a held slot, not a leg of the
  // finish, and it stays a plain B so it never takes B1 off the closing run.
  let lastMile = -1;
  slots.forEach((s, i) => {
    if (i !== first && i !== last && s.signup && !isBonus(s.signup)) lastMile = i;
  });

  let mile = 0;
  let leg = 0;
  return slots.map((s, i) => {
    if (i === first) return { kind: "start", label: "START", sub: "the line" };
    if (i === last) return { kind: "finish", label: "FINISH", sub: "26.2" };
    // "B", not ".2". The fraction is the distance the bonuses add up to, not a
    // name for any one of them — a slot reading ".2" was labelling a session
    // with an arithmetic fact about the course.
    if (isBonus(s.signup)) {
      if (i < lastMile) return { kind: "point-two", label: "B", sub: "bonus" };
      leg += 1;
      return { kind: "point-two", label: `B${leg}`, sub: "bonus" };
    }
    if (!s.signup) return { kind: "open", label: "—", sub: "open" };
    mile += 1;
    return { kind: "mile", n: mile, label: String(mile), sub: "mile" };
  });
}
