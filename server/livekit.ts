import { AccessToken, RoomServiceClient, EgressClient, EncodedFileType, WebhookReceiver } from "livekit-server-sdk";
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
const S3_BUCKET = process.env.RECORDINGS_BUCKET || "recordings";
const S3_ACCESS_KEY = process.env.SUPABASE_S3_ACCESS_KEY_ID ?? "";
const S3_SECRET = process.env.SUPABASE_S3_SECRET_ACCESS_KEY ?? "";
const S3_REGION = process.env.SUPABASE_S3_REGION ?? "";
const SUPABASE_URL = process.env.SUPABASE_URL ?? "";

export function isRecordingConfigured(): boolean {
  return Boolean(isLiveKitConfigured() && S3_ACCESS_KEY && S3_SECRET && S3_REGION && SUPABASE_URL);
}

export function recordingsBucket(): string {
  return S3_BUCKET;
}

function s3Upload() {
  return {
    accessKey: S3_ACCESS_KEY,
    secret: S3_SECRET,
    region: S3_REGION,
    bucket: S3_BUCKET,
    endpoint: `${SUPABASE_URL.replace(/\/$/, "")}/storage/v1/s3`,
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
export async function startBroadcast(room: string, targets: BroadcastTarget[]): Promise<string> {
  const stream: StreamOutput | undefined = targets.length
    ? ({ protocol: 1 /* RTMP */, urls: targets.map((t) => t.url) } as StreamOutput)
    : undefined;
  const info = await egress().startRoomCompositeEgress(room, { stream }, { layout: "grid" });
  return info.egressId;
}

/**
 * The short one: a separate composite recorded to a single MP4 for one
 * podcaster's slot. Runs alongside the broadcast, so stopping it never touches
 * what's going out.
 */
export async function startSegmentRecording(room: string, filepath: string): Promise<string> {
  const info = await egress().startRoomCompositeEgress(room, { file: mp4Output(filepath) }, { layout: "grid" });
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
