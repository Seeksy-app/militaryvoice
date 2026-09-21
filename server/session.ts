// Minimal signed-cookie sessions for the host (podcaster) dashboard. No extra
// dependency needed — Node's built-in `crypto` does the HMAC signing, and
// `req.headers.cookie` is parsed by hand since this app doesn't use
// cookie-parser/express-session for the public/admin routes.
import crypto from "node:crypto";
import type { Request, Response, NextFunction } from "express";

const COOKIE_NAME = "mv_host_session";
const ADMIN_COOKIE_NAME = "mv_admin_session";
const SESSION_DAYS = 30;
/** How long a session lasts when they didn't ask to be remembered. Long enough
 *  to finish what they came to do, short enough to be no use to the next
 *  person on a shared machine. */
const SESSION_HOURS = 12;

// A real secret must be set in production (Vercel env var). The fallback keeps
// local dev working but is intentionally obvious so it's never mistaken for a
// real deployment secret.
const SESSION_SECRET = process.env.SESSION_SECRET || "dev-only-insecure-secret-change-me";

if (!process.env.SESSION_SECRET && process.env.VERCEL) {
  console.error(
    "SESSION_SECRET is not set — host login sessions are using an insecure default. " +
      "Set SESSION_SECRET in your Vercel project's environment variables.",
  );
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

function sign(payload: object): string {
  const body = base64url(JSON.stringify(payload));
  const mac = crypto.createHmac("sha256", SESSION_SECRET).update(body).digest("base64url");
  return `${body}.${mac}`;
}

function verify(token: string): any | null {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [body, mac] = parts;
  const expectedMac = crypto.createHmac("sha256", SESSION_SECRET).update(body).digest("base64url");
  const macBuf = Buffer.from(mac);
  const expectedBuf = Buffer.from(expectedMac);
  if (macBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(macBuf, expectedBuf)) {
    return null;
  }
  try {
    return JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (key) out[key] = decodeURIComponent(value);
  }
  return out;
}

/**
 * Start a host session.
 *
 * `remember` is the podcaster's own answer to "keep me signed in", and it has
 * to be asked rather than assumed: this used to give everyone thirty days,
 * including whoever signed in from a library computer to check their slot.
 * Without it the cookie has no Max-Age at all, so the browser drops it when it
 * closes — and the signature carries its own shorter expiry, so a copied
 * cookie is no use the next day either.
 */
export function setSessionCookie(res: Response, email: string, remember = false): void {
  const hours = remember ? SESSION_DAYS * 24 : SESSION_HOURS;
  const exp = Date.now() + hours * 60 * 60 * 1000;
  const token = sign({ email, exp, remember, iat: Date.now() });
  const isProd = process.env.VERCEL === "1" || process.env.NODE_ENV === "production";
  const attrs = [
    `${COOKIE_NAME}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
  ];
  if (remember) attrs.push(`Max-Age=${hours * 60 * 60}`);
  if (isProd) attrs.push("Secure");
  res.setHeader("Set-Cookie", attrs.join("; "));
}

export function clearSessionCookie(res: Response): void {
  res.setHeader("Set-Cookie", `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

export function getSessionEmail(req: Request): string | null {
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies[COOKIE_NAME];
  if (!token) return null;
  const payload = verify(token);
  if (!payload || typeof payload.email !== "string" || typeof payload.exp !== "number") return null;
  if (Date.now() > payload.exp) return null;
  return payload.email;
}

/** The session as the cookie carries it, for the dashboard to say how long
 *  it lasts — and for finding out why someone was asked to sign in again. */
export function getSession(req: Request): { email: string; exp: number; remember: boolean; iat: number | null } | null {
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies[COOKIE_NAME];
  if (!token) return null;
  const payload = verify(token);
  if (!payload || typeof payload.email !== "string" || typeof payload.exp !== "number") return null;
  if (Date.now() > payload.exp) return null;
  // Cookies set before the flag existed carry only the expiry; a session with
  // more than a day left on it was a thirty-day one.
  const remember = payload.remember === true || payload.exp - Date.now() > 24 * 60 * 60 * 1000;
  return { email: payload.email, exp: payload.exp, remember, iat: typeof payload.iat === "number" ? payload.iat : null };
}

export function requireHostSession(req: Request, res: Response, next: NextFunction): void {
  const email = getSessionEmail(req);
  if (!email) {
    res.status(401).json({ message: "Please sign in again." });
    return;
  }
  (req as any).hostEmail = email;
  next();
}

// ---------------------------------------------------------------------------
// Admin sessions. Same signing, separate cookie, so signing in as a podcaster
// never grants admin and vice versa.
// ---------------------------------------------------------------------------
const ADMIN_SESSION_DAYS = 14;

export function setAdminCookie(res: Response, email: string): void {
  const exp = Date.now() + ADMIN_SESSION_DAYS * 24 * 60 * 60 * 1000;
  const token = sign({ email, exp, role: "admin" });
  const isProd = process.env.VERCEL === "1" || process.env.NODE_ENV === "production";
  const attrs = [
    `${ADMIN_COOKIE_NAME}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${ADMIN_SESSION_DAYS * 24 * 60 * 60}`,
  ];
  if (isProd) attrs.push("Secure");
  res.append("Set-Cookie", attrs.join("; "));
}

export function clearAdminCookie(res: Response): void {
  res.append("Set-Cookie", `${ADMIN_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

export function getAdminEmail(req: Request): string | null {
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies[ADMIN_COOKIE_NAME];
  if (!token) return null;
  const payload = verify(token);
  if (!payload || payload.role !== "admin" || typeof payload.email !== "string" || typeof payload.exp !== "number") return null;
  if (Date.now() > payload.exp) return null;
  return payload.email;
}
