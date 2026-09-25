import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

/**
 * Secrets we hold for people (Zoom's OAuth tokens) are sealed with
 * AES-256-GCM before they reach the database, on top of the database's own
 * disk encryption. The key is TOKEN_ENCRYPTION_KEY if set, otherwise derived
 * from SESSION_SECRET — so changing that secret means reconnecting Zoom.
 */
const PREFIX = "enc:v1:";

let cached: Buffer | null = null;
function key(): Buffer {
  if (cached) return cached;
  const base = process.env.TOKEN_ENCRYPTION_KEY || process.env.SESSION_SECRET || "dev-only-insecure-secret-change-me";
  cached = Buffer.from(hkdfSync("sha256", base, "militaryvoices", "token-encryption-v1", 32));
  return cached;
}

export function seal(plain: string): string {
  if (!plain || plain.startsWith(PREFIX)) return plain;
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const body = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return PREFIX + Buffer.concat([iv, c.getAuthTag(), body]).toString("base64");
}

/** Plain text written before sealing started comes back as it is. One that won't open comes back empty. */
export function unseal(stored: string): string {
  if (!stored?.startsWith(PREFIX)) return stored;
  try {
    const raw = Buffer.from(stored.slice(PREFIX.length), "base64");
    const d = createDecipheriv("aes-256-gcm", key(), raw.subarray(0, 12));
    d.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString("utf8");
  } catch {
    return "";
  }
}
