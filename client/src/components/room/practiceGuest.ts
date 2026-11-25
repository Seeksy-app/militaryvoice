// The practice guest (Andrew, 24 Nov, approved with the mockup): the creator's own guide (shared/guides.ts) sits in a
// people box with the name tag "Practice guest", so a host can try their scenes before a real guest joins. It lives
// only on the host's own page: it isn't a room participant, so the recording, the live show and guests never see it.
// Record and Go live ask to remove it first, so what the host sees matches what goes out.
import { useSyncExternalStore } from "react";
import type { StageTile } from "@/components/StageView";
import { DEFAULT_AGE, DEFAULT_GUIDE, guideFace } from "@shared/guides";

export const PRACTICE_ID = "guest-practice";
export const PRACTICE_NAME = "Practice guest";

let on = false;
let face = guideFace(DEFAULT_GUIDE, DEFAULT_AGE);
let guideName = "Lori";
const subs = new Set<() => void>();
const tell = () => subs.forEach((f) => f());
const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };

let asked = false;
/** Their own guide's face and name, once (the default guide when they haven't picked one). */
function loadGuide() {
  if (asked) return;
  asked = true;
  void fetch("/api/guide/me", { credentials: "include" })
    .then((r) => (r.ok ? r.json() : null))
    .then((g: { enabled?: boolean; avatarUrl?: string; name?: string } | null) => {
      if (g?.enabled && g.avatarUrl) { face = g.avatarUrl; guideName = g.name || guideName; tell(); }
    })
    .catch(() => {});
}

export const practice = {
  isOn: () => on,
  set(v: boolean) { if (v) loadGuide(); if (on !== v) { on = v; tell(); } },
  face: () => face,
  guideName: () => guideName,
};

export function usePractice(): { on: boolean; face: string; name: string } {
  const isOn = useSyncExternalStore(subscribe, () => on);
  const f = useSyncExternalStore(subscribe, () => face);
  const n = useSyncExternalStore(subscribe, () => guideName);
  return { on: isOn, face: f, name: n };
}

/** The tile the host's own stage view draws for it: a guest with a photo and no camera or mic. */
export function practiceTile(photoUrl: string): StageTile {
  return { identity: PRACTICE_ID, name: PRACTICE_NAME, video: null, audio: null, speaking: false, photoUrl };
}
