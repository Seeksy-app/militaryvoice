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
function presignS3(method: "GET" | "PUT" | "DELETE" | "POST", path: string, expiresInSeconds: number, extra: Record<string, string> = {}): string {
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
    // Multipart's own parameters (uploads, partNumber, uploadId) are signed with the rest.
    ...extra,
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
/**
 * Put an object from here rather than from a browser.
 *
 * The bucket has no CORS policy, so a browser's PUT to a presigned URL dies
 * before it starts — which is why no podcaster upload has ever reached R2.
 * The server is not subject to CORS. Bounded by what a function body will
 * carry; the episodes still need the bucket's own door opened.
 */
export async function putRecordingObject(path: string, body: Buffer, contentType: string): Promise<void> {
  const r = await fetch(presignS3("PUT", path, 900), { method: "PUT", headers: { "content-type": contentType }, body: new Uint8Array(body) });
  if (!r.ok) throw new Error(`Storage refused the file (${r.status}).`);
}

/**
 * Multipart uploads, so an episode goes up in pieces: a dropped connection
 * costs one 16MB piece, not the whole file, and a closed tab can pick up
 * where it stopped. The browser PUTs each part to a presigned URL; starting
 * and finishing are small signed calls made from here.
 */
export async function startMultipart(path: string, contentType: string): Promise<string> {
  if (!usingR2()) throw new Error("Recording uploads need R2.");
  const r = await fetch(presignS3("POST", path, 900, { uploads: "" }), { method: "POST", headers: { "content-type": contentType } });
  const body = await r.text();
  const id = body.match(/<UploadId>([^<]+)<\/UploadId>/)?.[1];
  if (!r.ok || !id) throw new Error(`Storage wouldn't start the upload (${r.status}).`);
  return id;
}

export function signedPartUrl(path: string, uploadId: string, partNumber: number, expiresInSeconds = 6 * 3600): string {
  return presignS3("PUT", path, expiresInSeconds, { partNumber: String(partNumber), uploadId });
}

export async function completeMultipart(path: string, uploadId: string, parts: Array<{ partNumber: number; etag: string }>): Promise<void> {
  const xml = `<CompleteMultipartUpload>${parts
    .sort((a, b) => a.partNumber - b.partNumber)
    .map((p) => `<Part><PartNumber>${p.partNumber}</PartNumber><ETag>${p.etag.replace(/[<>&]/g, "")}</ETag></Part>`)
    .join("")}</CompleteMultipartUpload>`;
  const r = await fetch(presignS3("POST", path, 900, { uploadId }), { method: "POST", headers: { "content-type": "application/xml" }, body: xml });
  const body = await r.text();
  // S3 can answer 200 with an error inside, so the body is checked too.
  if (!r.ok || /<Error>/.test(body)) throw new Error(`Storage couldn't finish the upload (${r.status}${body.match(/<Code>([^<]+)/)?.[1] ? ` ${body.match(/<Code>([^<]+)/)![1]}` : ""}).`);
}

export async function abortMultipart(path: string, uploadId: string): Promise<void> {
  await fetch(presignS3("DELETE", path, 900, { uploadId }), { method: "DELETE" }).catch(() => undefined);
}

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

/** The same, saved as a file with this name rather than played in the browser (an editor's download). */
export async function signedRecordingDownload(path: string, filename: string, expiresInSeconds = 6 * 3600): Promise<string> {
  // Plain ASCII: a header can't carry "ō" safely.
  const name = filename.normalize("NFKD").replace(/[^\x20-\x7e]/g, "").replace(/["\\]/g, "").trim().slice(0, 120) || "recording.mp4";
  if (usingR2()) return presignS3("GET", path, expiresInSeconds, { "response-content-disposition": `attachment; filename="${name}"` });
  const { data, error } = await getClient().storage.from(recordingsBucket()).createSignedUrl(path, expiresInSeconds, { download: name });
  if (error || !data?.signedUrl) throw error ?? new Error("Couldn't sign that recording.");
  return data.signedUrl;
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
