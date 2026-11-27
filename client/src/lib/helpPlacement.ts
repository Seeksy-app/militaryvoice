// Where the Ask Alex (or AI guide) bubble may sit. A screen whose main button would be under the bubble on a phone asks for
// it to be hidden at phone width while it's showing (PM, 27 Nov: the My Studio camera check). Computers keep it.
import { useEffect, useSyncExternalStore } from "react";

let askers = 0;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());

/** Hide the help bubble on a phone while this screen is up (and `on`). */
export function useHideHelpOnPhone(on = true) {
  useEffect(() => {
    if (!on) return;
    askers++; emit();
    return () => { askers--; emit(); };
  }, [on]);
}

/** True while some screen has asked for the bubble to stay off on a phone. */
export function useHelpHiddenOnPhone(): boolean {
  return useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, () => askers > 0, () => false);
}
