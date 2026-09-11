import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Resolve Supabase project URL + a server-side secret key. Supabase's Vercel
// Marketplace integration has used a couple of different naming conventions
// over time, so check all of them.
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;

const SUPABASE_SECRET_KEY =
  process.env.SUPABASE_SECRET_KEY ||
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_PUBLISHABLE_KEY; // last resort; a secret key should always be preferred

const BUCKET = "signup-photos";

let client: SupabaseClient | null = null;
let bucketReady: Promise<void> | null = null;

function getClient(): SupabaseClient {
  if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) {
    throw new Error(
      "Supabase is not configured. Set SUPABASE_URL and SUPABASE_SECRET_KEY " +
        "(or SUPABASE_SERVICE_ROLE_KEY) in your environment — these are provided " +
        "automatically by the Supabase Vercel integration.",
    );
  }
  if (!client) {
    client = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, {
      auth: { persistSession: false },
    });
  }
  return client;
}

async function ensureBucket(): Promise<void> {
  if (!bucketReady) {
    bucketReady = (async () => {
      const supabase = getClient();
      const { data: buckets } = await supabase.storage.listBuckets();
      const exists = buckets?.some((b) => b.name === BUCKET);
      if (!exists) {
        const { error } = await supabase.storage.createBucket(BUCKET, {
          public: true,
          fileSizeLimit: "10MB",
        });
        // Ignore "already exists" races from concurrent cold starts.
        if (error && !/already exists/i.test(error.message)) {
          throw error;
        }
      }
    })();
  }
  return bucketReady;
}

/** Upload a processed JPEG buffer to Supabase Storage and return its public URL. */
export async function uploadPhoto(filename: string, buffer: Buffer): Promise<string> {
  await ensureBucket();
  const supabase = getClient();
  const { error } = await supabase.storage.from(BUCKET).upload(filename, buffer, {
    contentType: "image/jpeg",
    cacheControl: "31536000",
    upsert: false,
  });
  if (error) {
    throw error;
  }
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(filename);
  return data.publicUrl;
}
