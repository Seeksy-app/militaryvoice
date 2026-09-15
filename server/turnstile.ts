import type { Request, Response } from "express";

// Cloudflare Turnstile on the public forms that create rows and send email.
// Sign-in codes were going out to any address a bot cared to type, and every
// one of those became a profile. Turnstile is invisible for almost everyone
// and costs nothing; the check runs server-side, so a bot skipping the widget
// gets a 400, not an email.
//
// Both keys come from the environment. When either is missing we let traffic
// through (local dev, previews) and say so once in the log, so a half-set
// deployment degrades to "no captcha" rather than "nobody can sign in".

const SITE_KEY = process.env.TURNSTILE_SITE_KEY ?? "";
const SECRET_KEY = process.env.TURNSTILE_SECRET_KEY ?? "";
const VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export function isTurnstileConfigured(): boolean {
  return Boolean(SITE_KEY && SECRET_KEY);
}

/** What the browser needs to draw the widget; null means "don't". */
export function turnstileSiteKey(): string | null {
  return isTurnstileConfigured() ? SITE_KEY : null;
}

let warned = false;
function warnOnce() {
  if (warned) return;
  warned = true;
  if (process.env.NODE_ENV === "production" && (SITE_KEY || SECRET_KEY)) {
    console.warn("[turnstile] only one of TURNSTILE_SITE_KEY / TURNSTILE_SECRET_KEY is set — captcha is OFF.");
  }
}

function clientIp(req: Request): string | undefined {
  const fwd = req.headers["x-forwarded-for"];
  const first = (Array.isArray(fwd) ? fwd[0] : fwd)?.split(",")[0]?.trim();
  return first || req.ip || undefined;
}

async function verify(token: string, ip?: string): Promise<{ ok: boolean; codes: string[] }> {
  const body = new URLSearchParams({ secret: SECRET_KEY, response: token });
  if (ip) body.set("remoteip", ip);
  try {
    const res = await fetch(VERIFY_URL, { method: "POST", body });
    const json = (await res.json()) as { success?: boolean; "error-codes"?: string[] };
    return { ok: json.success === true, codes: json["error-codes"] ?? [] };
  } catch (err) {
    // Cloudflare unreachable is not the visitor's fault; don't lock the door.
    console.error("[turnstile] verify failed:", (err as Error).message);
    return { ok: true, codes: ["verify-unreachable"] };
  }
}

/**
 * Gate for a public POST. Resolves true when the request may proceed; when it
 * resolves false the 400 has already been sent.
 */
export async function requireHuman(req: Request, res: Response): Promise<boolean> {
  if (!isTurnstileConfigured()) {
    warnOnce();
    return true;
  }
  const token = typeof req.body?.turnstileToken === "string" ? req.body.turnstileToken : "";
  if (!token) {
    res.status(400).json({ message: "We couldn't confirm you're a person. Reload the page and try again." });
    return false;
  }
  const { ok, codes } = await verify(token, clientIp(req));
  if (!ok) {
    console.warn("[turnstile] rejected:", codes.join(","), "ip", clientIp(req));
    res.status(400).json({ message: "That security check didn't pass. Reload the page and try once more." });
    return false;
  }
  return true;
}
