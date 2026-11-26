// Admin access without a browser, for our own scripts (Military Voices LIVE plan, decision 5; Andrew, 26 Nov:
// "All five as recommended" — retire the shared admin password before any client or crew login).
//
// The old way: any request carrying the featured event's shared password (x-admin-password, or ?password=)
// was full admin. That password sits in the events table with a guessable default, so anyone who learns it
// owns the admin. The new way: ADMIN_SCRIPT_KEY, a long random secret kept in Vercel and in the Mac's .env,
// sent as x-admin-script-key. The shared password keeps working only until ADMIN_SCRIPT_KEY is set, so the
// switch-over is one env change and nothing breaks before it.
import crypto from "node:crypto";
import type { Request } from "express";
import { storage } from "./storage.js";

export const SCRIPT_ADMIN_EMAIL = "claude-script@militaryvoices.ai";

function scriptKey(): string {
  const k = process.env.ADMIN_SCRIPT_KEY ?? "";
  return k.length >= 32 ? k : "";
}

/** True when the request carries the script key. */
export function scriptKeyOk(req: Request): boolean {
  const key = scriptKey();
  const given = String(req.get("x-admin-script-key") ?? "");
  if (!key || !given || given.length !== key.length) return false;
  return crypto.timingSafeEqual(Buffer.from(given), Buffer.from(key));
}

/** The shared password is retired as soon as the script key exists. */
export function sharedPasswordRetired(): boolean {
  return !!scriptKey();
}

/** The legacy shared password, header only (never a query string), and only until the script key is set. */
export async function sharedPasswordOk(given: string | undefined | null): Promise<boolean> {
  if (sharedPasswordRetired()) return false;
  const pw = String(given ?? "").trim();
  if (!pw) return false;
  const event = await storage.getFeaturedEvent();
  const real = String(event?.adminPassword ?? "");
  if (!real || pw.length !== real.length) return false;
  return crypto.timingSafeEqual(Buffer.from(pw), Buffer.from(real));
}

/** Script key, else the legacy header while it still counts. For routes that check admin by hand. */
export async function adminKeyOk(req: Request): Promise<boolean> {
  return scriptKeyOk(req) || (await sharedPasswordOk(req.get("x-admin-password")));
}
