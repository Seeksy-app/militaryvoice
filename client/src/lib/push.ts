import { useEffect, useState } from "react";
import { apiRequest } from "@/lib/queryClient";
import { isStandalone, platform } from "@/lib/pwa";

/**
 * Notifications on this device: "your clips are ready" while they're
 * elsewhere. Web Push through the app's service worker. On iPhone and iPad it
 * works only in the app added to the Home Screen (Apple's rule), so there the
 * answer is "add the app first".
 */
export type PushState = "loading" | "unavailable" | "needs-app" | "off" | "on" | "blocked";

let keyPromise: Promise<string> | null = null;
const publicKey = () => (keyPromise ??= fetch("/api/push/key").then((r) => r.json()).then((j: { key?: string }) => j.key ?? "").catch(() => ""));

const supported = () => typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

function toKey(b64: string): Uint8Array {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

async function registration(): Promise<ServiceWorkerRegistration | null> {
  if (!supported()) return null;
  // Registered on load in production; make sure of it here too.
  const reg = (await navigator.serviceWorker.getRegistration()) ?? (await navigator.serviceWorker.register("/sw.js").catch(() => undefined));
  return reg ? navigator.serviceWorker.ready : null;
}

async function currentState(): Promise<PushState> {
  if (!(await publicKey())) return "unavailable";
  if (!supported()) return platform() === "ios" && !isStandalone() ? "needs-app" : "unavailable";
  if (Notification.permission === "denied") return "blocked";
  const reg = await registration();
  const sub = reg ? await reg.pushManager.getSubscription() : null;
  return sub && Notification.permission === "granted" ? "on" : "off";
}

export function usePush() {
  const [state, setState] = useState<PushState>("loading");
  const [busy, setBusy] = useState(false);
  useEffect(() => { void currentState().then(setState); }, []);

  const enable = async (): Promise<boolean> => {
    setBusy(true);
    try {
      const key = await publicKey();
      if (!key || !supported()) return false;
      const perm = await Notification.requestPermission();
      if (perm !== "granted") { setState(perm === "denied" ? "blocked" : "off"); return false; }
      const reg = await registration();
      if (!reg) return false;
      const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: toKey(key) }));
      await apiRequest("POST", "/api/host/push/subscribe", { subscription: sub.toJSON() });
      await apiRequest("POST", "/api/host/push/test", {}).catch(() => undefined);
      setState("on");
      return true;
    } finally {
      setBusy(false);
    }
  };

  const disable = async () => {
    setBusy(true);
    try {
      const reg = await registration();
      const sub = reg ? await reg.pushManager.getSubscription() : null;
      if (sub) {
        await apiRequest("POST", "/api/host/push/unsubscribe", { endpoint: sub.endpoint }).catch(() => undefined);
        await sub.unsubscribe().catch(() => false);
      }
      setState("off");
    } finally {
      setBusy(false);
    }
  };

  return { state, busy, enable, disable };
}
