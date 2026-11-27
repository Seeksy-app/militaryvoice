/**
 * A Radio rehearsal day ("Radio test (3-minute segment)", Sun 15 Nov 2026), by its name: no Radio day, so it stays out
 * of day lists, ranges and counts (PM, 26 Nov). Matched by name only, so a real short day never vanishes.
 */
export const isRadioTest = (name: string | null | undefined): boolean => /^\s*radio test\b/i.test(name ?? "");
