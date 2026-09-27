import { useEffect, useState } from "react";

/**
 * The installable app. Chrome and Edge (Android, desktop) offer a one-tap
 * install through `beforeinstallprompt`, which fires once, early: we keep it
 * here from the moment the page loads so a "Get the app" button can use it
 * later. Safari (iPhone, iPad, Mac) has no such event; there it's Share →
 * Add to Home Screen, and we say so.
 */
type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };

let deferred: InstallEvent | null = null;
const listeners = new Set<() => void>();
const changed = () => listeners.forEach((f) => f());

export function startPwa() {
  if (typeof window === "undefined") return;
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault(); // our own button, not the browser's mini-bar
    deferred = e as InstallEvent;
    changed();
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    try { localStorage.setItem("mv_app_installed", "1"); } catch { /* fine */ }
    changed();
  });
  // Only on the real site: a service worker in development would cache the dev server.
  if ("serviceWorker" in navigator && import.meta.env.PROD) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("/sw.js").catch(() => { /* the site works without it */ });
    });
  }
}

/** Opened from the home screen (or as an installed desktop app). */
export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia?.("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

export type Platform = "ios" | "android" | "desktop";
export function platform(): Platform {
  const ua = typeof navigator === "undefined" ? "" : navigator.userAgent;
  // iPadOS reports itself as a Mac; touch gives it away.
  if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && typeof document !== "undefined" && "ontouchend" in document)) return "ios";
  if (/Android/.test(ua)) return "android";
  return "desktop";
}

/** One-tap install where the browser allows it; `canPrompt` false means show the steps instead. */
export function useInstall() {
  const [, tick] = useState(0);
  useEffect(() => {
    const f = () => tick((n) => n + 1);
    listeners.add(f);
    return () => { listeners.delete(f); };
  }, []);
  return {
    installed: isStandalone(),
    canPrompt: !!deferred,
    platform: platform(),
    async prompt(): Promise<boolean> {
      if (!deferred) return false;
      const e = deferred;
      deferred = null;
      await e.prompt();
      const { outcome } = await e.userChoice;
      changed();
      return outcome === "accepted";
    },
  };
}
