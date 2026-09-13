import {
  AccessToken,
  RoomServiceClient,
  EgressClient,
  IngressClient,
  IngressInput,
  EncodedFileType,
  WebhookReceiver,
} from "livekit-server-sdk";
import type { EncodedFileOutput, StreamOutput } from "livekit-server-sdk";

// The media layer. Everything in here is optional: without LIVEKIT_* set the
// studio still runs as show control — green room, stage, run of show — it just
// has no audio or video. That keeps local dev and preview deploys working for
// anyone who doesn't have the keys.

const LIVEKIT_URL = process.env.LIVEKIT_URL ?? "";
const LIVEKIT_API_KEY = process.env.LIVEKIT_API_KEY ?? "";
const LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET ?? "";

export function isLiveKitConfigured(): boolean {
  return Boolean(LIVEKIT_URL && LIVEKIT_API_KEY && LIVEKIT_API_SECRET);
}

/** LiveKit's wss:// URL has an https:// twin for the server-side REST API. */
function httpUrl(): string {
  return LIVEKIT_URL.replace(/^wss:/i, "https:").replace(/^ws:/i, "http:");
}

export function publicLiveKitUrl(): string {
  return LIVEKIT_URL;
}

/** One LiveKit room per studio, stable across restarts. */
export function roomName(studioId: number): string {
  return `mv-studio-${studioId}`;
}

let _rooms: RoomServiceClient | null = null;
export function rooms(): RoomServiceClient {
  if (!_rooms) _rooms = new RoomServiceClient(httpUrl(), LIVEKIT_API_KEY, LIVEKIT_API_SECRET);
  return _rooms;
}

let _ingress: IngressClient | null = null;
export function ingress(): IngressClient {
  if (!_ingress) _ingress = new IngressClient(httpUrl(), LIVEKIT_API_KEY, LIVEKIT_API_SECRET);
  return _ingress;
}

let _egress: EgressClient | null = null;
export function egress(): EgressClient {
  if (!_egress) _egress = new EgressClient(httpUrl(), LIVEKIT_API_KEY, LIVEKIT_API_SECRET);
  return _egress;
}

interface TokenArgs {
  room: string;
  identity: string;
  name: string;
  /** Speakers publish from the moment they arrive so the producer can see and
   *  hear them in the green room; what reaches the broadcast is decided by the
   *  composite, not by taking their camera away. */
  canPublish: boolean;
  /** Producers get roomAdmin so they can move people and stop the room. */
  admin?: boolean;
  attributes?: Record<string, string>;
}

export async function studioToken({ room, identity, name, canPublish, admin, attributes }: TokenArgs): Promise<string> {
  const at = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
    identity,
    name,
    ttl: "6h", // longer than any single slot, short enough to expire after the event
    attributes,
  });
  at.addGrant({
    room,
    roomJoin: true,
    canPublish,
    canSubscribe: true,
    canPublishData: true,
    canUpdateOwnMetadata: true,
    roomAdmin: admin === true,
  });
  return at.toJwt();
}

/**
 * Mirrors "green room" / "on stage" onto the LiveKit participant so the
 * composite layout and every other client can see it without polling us.
 * Never throws: the participant may not have connected yet.
 */
/**
 * Puts the studio's own state on the room itself, so the broadcast template
 * (and every client) learns about it without asking us. This is what turns
 * "Start video now" into a real hard cut on air rather than a flag in our UI.
 */
export async function syncRoomMetadata(room: string, data: Record<string, unknown>): Promise<void> {
  if (!isLiveKitConfigured()) return;
  try {
    await rooms().updateRoomMetadata(room, JSON.stringify(data));
  } catch {
    /* the room may not exist until someone joins; the template reads it on join */
  }
}

export async function syncParticipantState(room: string, identity: string, state: string): Promise<void> {
  if (!isLiveKitConfigured()) return;
  try {
    await rooms().updateParticipant(room, identity, { attributes: { state } });
  } catch {
    /* not connected yet — they'll carry the state in their own token instead */
  }
}

export interface BroadcastTarget {
  /** rtmp:// or rtmps:// ingest URL with the stream key already appended. */
  url: string;
  label: string;
}

// Recordings are written straight from LiveKit's egress into Supabase Storage
// over its S3-compatible endpoint, so the file never passes through us. The S3
// access keys are separate from the service-role key: Supabase dashboard →
// Storage → S3 Access Keys.
// Where recordings land. Two options, because Supabase's project-wide upload
// ceiling (50MB on the free plan) is far below a 25-minute slot: point
// R2_* at a Cloudflare R2 bucket and it wins, otherwise we fall back to
// Supabase's S3 endpoint. Same protocol either way — only the credentials
// differ, so nothing above this line has to know.
const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID ?? "";
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID ?? "";
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY ?? "";
const R2_BUCKET = process.env.R2_BUCKET || "militaryvoice-recordings";

const SB_BUCKET = process.env.RECORDINGS_BUCKET || "recordings";
const SB_ACCESS_KEY = process.env.SUPABASE_S3_ACCESS_KEY_ID ?? "";
const SB_SECRET = process.env.SUPABASE_S3_SECRET_ACCESS_KEY ?? "";
const SB_REGION = process.env.SUPABASE_S3_REGION ?? "";
const SUPABASE_URL = process.env.SUPABASE_URL ?? "";
const SB_ENDPOINT =
  process.env.SUPABASE_S3_ENDPOINT || `${SUPABASE_URL.replace(/\/$/, "")}/storage/v1/s3`;

export function usingR2(): boolean {
  return Boolean(R2_ACCOUNT_ID && R2_ACCESS_KEY_ID && R2_SECRET_ACCESS_KEY);
}

export interface StorageTarget {
  provider: "r2" | "supabase";
  bucket: string;
  endpoint: string;
  region: string;
  accessKey: string;
  secret: string;
}

export function storageTarget(): StorageTarget | null {
  if (usingR2()) {
    return {
      provider: "r2",
      bucket: R2_BUCKET,
      endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      region: "auto",
      accessKey: R2_ACCESS_KEY_ID,
      secret: R2_SECRET_ACCESS_KEY,
    };
  }
  if (SB_ACCESS_KEY && SB_SECRET && SB_REGION && SUPABASE_URL) {
    return {
      provider: "supabase",
      bucket: SB_BUCKET,
      endpoint: SB_ENDPOINT,
      region: SB_REGION,
      accessKey: SB_ACCESS_KEY,
      secret: SB_SECRET,
    };
  }
  return null;
}

export function isRecordingConfigured(): boolean {
  return Boolean(isLiveKitConfigured() && storageTarget());
}

export function recordingsBucket(): string {
  return storageTarget()?.bucket ?? SB_BUCKET;
}

function s3Upload() {
  const t = storageTarget();
  if (!t) throw new Error("No recording storage configured.");
  return {
    accessKey: t.accessKey,
    secret: t.secret,
    region: t.region,
    bucket: t.bucket,
    endpoint: t.endpoint,
    forcePathStyle: true,
  };
}

function mp4Output(filepath: string): EncodedFileOutput {
  return {
    fileType: EncodedFileType.MP4,
    filepath,
    output: { case: "s3", value: s3Upload() },
  } as unknown as EncodedFileOutput;
}

/**
 * The long broadcast: one composite of the stage pushed to every destination
 * at once, running for the whole event. Returns the egress id, which is what
 * later add/remove calls need.
 */
export async function startBroadcast(
  room: string,
  targets: BroadcastTarget[],
  templateBaseUrl?: string,
): Promise<string> {
  const stream: StreamOutput | undefined = targets.length
    ? ({ protocol: 1 /* RTMP */, urls: targets.map((t) => t.url) } as StreamOutput)
    : undefined;
  const info = await egress().startRoomCompositeEgress(room, { stream }, compositeOptions(templateBaseUrl));
  return info.egressId;
}

/**
 * Our own page renders the broadcast when we can reach it publicly; otherwise
 * LiveKit's stock grid. Egress runs on LiveKit's servers, so a localhost
 * template would just be a blank screen — hence the fallback rather than a
 * hard requirement.
 */
function compositeOptions(templateBaseUrl?: string) {
  return templateBaseUrl
    ? { layout: "stage", customBaseUrl: templateBaseUrl }
    : { layout: "grid" };
}

/**
 * The short one: a separate composite recorded to a single MP4 for one
 * podcaster's slot. Runs alongside the broadcast, so stopping it never touches
 * what's going out.
 */
export async function startSegmentRecording(
  room: string,
  filepath: string,
  templateBaseUrl?: string,
): Promise<string> {
  const info = await egress().startRoomCompositeEgress(
    room,
    { file: mp4Output(filepath) },
    compositeOptions(templateBaseUrl),
  );
  return info.egressId;
}

/** Add or drop a destination without interrupting what's already going out. */
export async function updateBroadcastTargets(
  egressId: string,
  add: string[] = [],
  remove: string[] = [],
): Promise<void> {
  await egress().updateStream(egressId, add, remove);
}

export async function stopEgressById(egressId: string): Promise<void> {
  await egress().stopEgress(egressId);
}

let _hooks: WebhookReceiver | null = null;
/** Verifies the Authorization header LiveKit signs its webhooks with. */
export function webhooks(): WebhookReceiver {
  if (!_hooks) _hooks = new WebhookReceiver(LIVEKIT_API_KEY, LIVEKIT_API_SECRET);
  return _hooks;
}

// ---- Ingress -----------------------------------------------------------------
// The other direction: instead of a podcaster coming to our studio page, we
// hand them an RTMP URL and key and they push their own produced feed in from
// OBS, StreamYard, Riverside — whatever they already run. It arrives in the
// room as an ordinary participant, so the producer promotes them to the stage
// exactly like anyone else. This is also the pipe Zoom will use.

export interface IngressCredentials {
  ingressId: string;
  url: string;
  streamKey: string;
}

export async function createRtmpIngress(args: {
  room: string;
  identity: string;
  name: string;
}): Promise<IngressCredentials> {
  const info = await ingress().createIngress(IngressInput.RTMP_INPUT, {
    name: args.name || args.identity,
    roomName: args.room,
    participantIdentity: args.identity,
    participantName: args.name || args.identity,
    // RTMP always needs transcoding — the encoder's output won't match what
    // the room's other participants are negotiating.
    enableTranscoding: true,
  });
  return { ingressId: info.ingressId, url: info.url, streamKey: info.streamKey };
}

export async function deleteIngress(ingressId: string): Promise<void> {
  await ingress().deleteIngress(ingressId);
}

/** Which encoder feeds exist, and whether anything is arriving on them. */
export async function listIngressForRoom(room: string) {
  return ingress().listIngress({ roomName: room });
}
