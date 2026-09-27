import webpush from "web-push";
import { storage } from "./storage.js";

/**
 * Notifications to a podcaster's own devices (Web Push): "your clips are
 * ready" while they're doing something else. VAPID_PUBLIC_KEY /
 * VAPID_PRIVATE_KEY / VAPID_SUBJECT sign them; without the keys nothing is
 * sent and the app simply doesn't offer notifications.
 */
const pub = () => (process.env.VAPID_PUBLIC_KEY || "").trim();
const priv = () => (process.env.VAPID_PRIVATE_KEY || "").trim();
let ready = false;

export function pushConfigured(): boolean {
  if (!pub() || !priv()) return false;
  if (!ready) {
    webpush.setVapidDetails((process.env.VAPID_SUBJECT || "mailto:hello@militaryvoices.ai").trim(), pub(), priv());
    ready = true;
  }
  return true;
}

export function pushPublicKey(): string {
  return pushConfigured() ? pub() : "";
}

export interface PushMessage {
  title: string;
  body: string;
  /** Where a tap on it opens. */
  url: string;
  /** Same tag replaces an earlier notification rather than stacking. */
  tag?: string;
}

/** To every device they've turned notifications on for. A device that's gone (410/404) is forgotten. Never throws. */
export async function notify(email: string, msg: PushMessage): Promise<number> {
  if (!email || !pushConfigured()) return 0;
  const subs = await storage.listPushSubscriptions(email).catch(() => []);
  let sent = 0;
  await Promise.all(subs.map(async (s) => {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(msg), { TTL: 24 * 3600, urgency: "normal" });
      sent++;
    } catch (err: any) {
      if (err?.statusCode === 404 || err?.statusCode === 410) await storage.deletePushSubscription(s.endpoint).catch(() => {});
      else console.warn(`Push to ${email} failed:`, err?.statusCode ?? "", err?.body ?? err?.message);
    }
  }));
  return sent;
}
