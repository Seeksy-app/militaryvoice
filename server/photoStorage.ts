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
export async function uploadPhoto(filename: string, buffer: Buffer, contentType = "image/jpeg"): Promise<string> {
  await ensureBucket();
  const supabase = getClient();
  const { error } = await supabase.storage.from(BUCKET).upload(filename, buffer, {
    contentType,
    cacheControl: "31536000",
    upsert: false,
  });
  if (error) {
    throw error;
  }
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(filename);
  return data.publicUrl;
}

// ---------------------------------------------------------------------------
// Show-day material (intro/outro clips, images). Separate bucket from the
// headshots so size limits and lifecycles stay independent.
// ---------------------------------------------------------------------------
const ASSET_BUCKET = "show-assets";
let assetBucketReady: Promise<void> | null = null;

/**
 * 2GB, because a pre-recorded episode is a pre-recorded episode.
 *
 * The bucket was made at 50MB back when this only held intro stings, and the
 * form covered the gap with a "paste a Drive link" box. Links are a worse
 * answer than they look: they expire, they get their sharing revoked, and on
 * show day nobody finds out until the clip does not roll. So the file comes
 * to us — which means the ceiling has to be big enough to hold a real one.
 */
const ASSET_SIZE_LIMIT = "2GB";

async function ensureAssetBucket(): Promise<void> {
  if (!assetBucketReady) {
    assetBucketReady = (async () => {
      const supabase = getClient();
      const { data: buckets } = await supabase.storage.listBuckets();
      if (!buckets?.some((b) => b.name === ASSET_BUCKET)) {
        const { error } = await supabase.storage.createBucket(ASSET_BUCKET, {
          public: true,
          fileSizeLimit: ASSET_SIZE_LIMIT,
        });
        if (error && !/already exists/i.test(error.message)) {
          assetBucketReady = null;
          throw error;
        }
      } else {
        // The bucket already exists at whatever limit it was created with, and
        // createBucket will not revisit that. Raising it is best-effort: the
        // project's own global limit still wins, and if this fails the upload
        // simply reports the real ceiling rather than the boot failing.
        const { error } = await supabase.storage.updateBucket(ASSET_BUCKET, {
          public: true,
          fileSizeLimit: ASSET_SIZE_LIMIT,
        });
        if (error) console.warn(`Could not raise ${ASSET_BUCKET} size limit:`, error.message);
      }
    })();
  }
  return assetBucketReady;
}

/**
 * A URL the browser can PUT a file straight to.
 *
 * Big files cannot come through the API: a serverless function has a request
 * body limit measured in tens of megabytes, and an episode is measured in
 * hundreds. This hands the browser a short-lived signed URL so the bytes go
 * to storage directly and never touch our function at all.
 */
export async function signedAssetUpload(filename: string): Promise<{ uploadUrl: string; publicUrl: string }> {
  await ensureAssetBucket();
  const supabase = getClient();
  const { data, error } = await supabase.storage.from(ASSET_BUCKET).createSignedUploadUrl(filename);
  if (error || !data) throw error ?? new Error("Could not create an upload URL.");
  const { data: pub } = supabase.storage.from(ASSET_BUCKET).getPublicUrl(filename);
  return { uploadUrl: data.signedUrl, publicUrl: pub.publicUrl };
}

export async function uploadShowAsset(filename: string, buffer: Buffer, contentType: string): Promise<string> {
  await ensureAssetBucket();
  const supabase = getClient();
  const { error } = await supabase.storage.from(ASSET_BUCKET).upload(filename, buffer, {
    contentType,
    cacheControl: "31536000",
    upsert: false,
  });
  if (error) throw error;
  const { data } = supabase.storage.from(ASSET_BUCKET).getPublicUrl(filename);
  return data.publicUrl;
}

export async function deleteShowAsset(fileUrl: string): Promise<void> {
  const marker = `/${ASSET_BUCKET}/`;
  const i = fileUrl.indexOf(marker);
  if (i === -1) return;
  const path = decodeURIComponent(fileUrl.slice(i + marker.length));
  const supabase = getClient();
  await supabase.storage.from(ASSET_BUCKET).remove([path]);
}
