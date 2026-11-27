// Where the Ask Alex (or AI guide) bubble may sit (PM, 27 Nov). A screen can ask, while it's showing, for the bubble to be
// hidden at phone width (the My Studio camera check, where it sat on Enter studio) or shown as just the face (the studio
// room, where the full pill sat on Invite a guest's Copy button).
import { useEffect, useSyncExternalStore } from "react";

type Ask = "phoneOff" | "compact";
const askers: Record<Ask, number> = { phoneOff: 0, compact: 0 };
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());
const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };

function useAsk(kind: Ask, on: boolean) {
  useEffect(() => {
    if (!on) return;
    askers[kind]++; emit();
    return () => { askers[kind]--; emit(); };
  }, [kind, on]);
}

/** Hide the help bubble on a phone while this screen is up (and `on`). */
export const useHideHelpOnPhone = (on = true) => useAsk("phoneOff", on);
/** Show the help bubble as just the face while this screen is up (and `on`). */
export const useCompactHelp = (on = true) => useAsk("compact", on);

/** True while some screen has asked for the bubble to stay off on a phone. */
export function useHelpHiddenOnPhone(): boolean {
  return useSyncExternalStore(subscribe, () => askers.phoneOff > 0, () => false);
}
/** True while some screen has asked for the face-only bubble. */
export function useHelpCompact(): boolean {
  return useSyncExternalStore(subscribe, () => askers.compact > 0, () => false);
}
