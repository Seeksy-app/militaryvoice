import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { recordingsBucket } from "./livekit.js";

// The recordings bucket. LiveKit's egress writes straight into it over the
// S3-compatible endpoint; we only ever read from it, and we keep it private so
// a podcaster's unedited session isn't sitting on a guessable public URL.

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SECRET_KEY =
  process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

let client: SupabaseClient | null = null;
let bucketReady: Promise<void> | null = null;

function getClient(): SupabaseClient {
  if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) throw new Error("Supabase is not configured.");
  if (!client) client = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
  return client;
}

export async function ensureRecordingsBucket(): Promise<void> {
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

/** A time-limited download link. Default two hours, plenty for a big MP4. */
export async function signedRecordingUrl(path: string, expiresInSeconds = 7_200): Promise<string> {
  const supabase = getClient();
  const { data, error } = await supabase.storage
    .from(recordingsBucket())
    .createSignedUrl(path, expiresInSeconds, { download: true });
  if (error || !data?.signedUrl) throw error ?? new Error("Couldn't sign that recording.");
  return data.signedUrl;
}
