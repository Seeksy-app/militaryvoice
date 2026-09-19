import crypto from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { recordingsBucket, storageTarget, usingR2 } from "./livekit.js";

// Reading recordings back. LiveKit writes them over S3; we only ever hand out
// short-lived links, because an unedited session shouldn't sit on a guessable
// public URL. Supabase has its own signing call; R2 needs real SigV4, which is
// forty lines of well-specified hashing and saves pulling in the AWS SDK.

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

let client: SupabaseClient | null = null;
let bucketReady: Promise<void> | null = null;

function getClient(): SupabaseClient {
  if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) throw new Error("Supabase is not configured.");
  if (!client) client = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
  return client;
}

/** R2 buckets are made through the Cloudflare API, so this only has to run for Supabase. */
export async function ensureRecordingsBucket(): Promise<void> {
  if (usingR2()) return;
  if (!bucketReady) {
    bucketReady = (async () => {
      const supabase = getClient();
      const { data: buckets } = await supabase.storage.listBuckets();
      if (buckets?.some((b) => b.name === recordingsBucket())) return;
      const { error } = await supabase.storage.createBucket(recordingsBucket(), { public: false });
      if (error && !/already exists/i.test(error.message)) throw error;
    })().catch((err) => {
      bucketReady = null;
      throw err;
    });
  }
  return bucketReady;
}

const sha256 = (v: string | Buffer) => crypto.createHash("sha256").update(v).digest("hex");
const hmac = (key: crypto.BinaryLike, v: string) => crypto.createHmac("sha256", key).update(v).digest();

/** Percent-encoding per AWS's rules, which differ from encodeURIComponent. */
function uriEncode(v: string, encodeSlash: boolean): string {
  return v
    .split("")
    .map((c) => {
      if (/[A-Za-z0-9._~-]/.test(c)) return c;
      if (c === "/") return encodeSlash ? "%2F" : "/";
      return "%" + c.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0");
    })
    .join("");
}

/**
 * A presigned S3 URL, signed by hand so we don't carry the AWS SDK for it.
 *
 * GET for reading a recording back, PUT for putting one there — the signature
 * is identical bar the verb, which is why this takes it as an argument rather
 * than existing twice.
 */
function presignS3(method: "GET" | "PUT" | "DELETE", path: string, expiresInSeconds: number): string {
  const t = storageTarget();
  if (!t) throw new Error("No recording storage configured.");

  const url = new URL(t.endpoint);
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);
  const scope = `${dateStamp}/${t.region}/s3/aws4_request`;
  // The endpoint can carry a path of its own — Supabase serves S3 under
  // /storage/v1/s3, R2 serves it at the root — and it has to be signed too.
  const prefix = url.pathname.replace(/\/+$/, "");
  const canonicalUri = `${prefix}/${uriEncode(t.bucket, true)}/${uriEncode(path, false)}`;

  const params: Record<string, string> = {
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": `${t.accessKey}/${scope}`,
    "X-Amz-Date": amzDate,
    "X-Amz-Expires": String(expiresInSeconds),
    "X-Amz-SignedHeaders": "host",
  };
  const canonicalQuery = Object.keys(params)
    .sort()
    .map((k) => `${uriEncode(k, true)}=${uriEncode(params[k], true)}`)
    .join("&");

  const canonicalRequest = [
    method,
    canonicalUri,
    canonicalQuery,
    `host:${url.host}\n`,
    "host",
    "UNSIGNED-PAYLOAD",
  ].join("\n");

  const toSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256(canonicalRequest)].join("\n");
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${t.secret}`, dateStamp), t.region), "s3"), "aws4_request");
  const signature = crypto.createHmac("sha256", signingKey).update(toSign).digest("hex");

  return `${url.origin}${canonicalUri}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}

/**
 * A URL to PUT a recording to.
 *
 * Nothing in the product uploads here — LiveKit's egress writes recordings
 * directly. This exists so a file that was never an egress can be put where
 * recordings live: an old episode, or one staged to exercise the clipper.
 * R2 only; Supabase storage has a project-wide per-file cap that an episode
 * goes straight past.
 */
export function signedRecordingUpload(path: string, expiresInSeconds = 7_200): string {
  if (!usingR2()) throw new Error("Recording uploads need R2 — Supabase caps file size project-wide.");
  return presignS3("PUT", path, expiresInSeconds);
}

/**
 * Remove an object.
 *
 * Without this there is no way to delete from R2 at all, which was survivable
 * while only egress wrote there — recordings are meant to be kept. Show
 * material is not: a podcaster who uploads the wrong episode and removes it
 * would otherwise leave the file sitting in the bucket for good, paid for and
 * unreachable.
 */
export async function deleteRecordingObject(path: string): Promise<void> {
  if (!usingR2()) {
    const supabase = getClient();
    await supabase.storage.from(recordingsBucket()).remove([path]);
    return;
  }
  const res = await fetch(presignS3("DELETE", path, 300), { method: "DELETE" });
  // 404 is success for our purposes: the object is not there, which is the
  // state we were asking for.
  if (!res.ok && res.status !== 404) {
    throw new Error(`R2 delete ${res.status}: ${(await res.text()).slice(0, 160)}`);
  }
}

/** A time-limited download link. Default two hours, plenty for a big MP4. */
export async function signedRecordingUrl(path: string, expiresInSeconds = 7_200): Promise<string> {
  if (usingR2()) return presignS3("GET", path, expiresInSeconds);

  const supabase = getClient();
  const { data, error } = await supabase.storage
    .from(recordingsBucket())
    .createSignedUrl(path, expiresInSeconds, { download: true });
  if (error || !data?.signedUrl) throw error ?? new Error("Couldn't sign that recording.");
  return data.signedUrl;
}
