// A podcaster's own YouTube channel.
//
// They connect once; at their slot we open a broadcast on their channel and
// add its ingest to the running egress, so their audience watches on their own
// channel while everyone else watches ours. That's the whole point of the
// event: 48 slots, 48 audiences, one show.
//
// The alternative is emailing forty-eight people asking them to dig a stream
// key out of YouTube Studio, which is both painful and a credential nobody
// should be sending around.

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID ?? "";
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET ?? "";

/** Manage-account scope: liveBroadcasts.insert needs it, readonly won't do. */
const SCOPE = "https://www.googleapis.com/auth/youtube.force-ssl";

export function isYoutubeConfigured(): boolean {
  return Boolean(CLIENT_ID && CLIENT_SECRET);
}

export function consentUrl(redirectUri: string, state: string): string {
  const q = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: SCOPE,
    // Offline plus a forced prompt is the only combination that reliably
    // returns a refresh token; without it a reconnect gives us nothing durable.
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
}

async function tokenRequest(body: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, ...body }),
  });
  const json = (await res.json()) as TokenResponse & { error_description?: string; error?: string };
  if (!res.ok) throw new Error(json.error_description || json.error || "Google refused that token request.");
  return json;
}

export async function exchangeCode(code: string, redirectUri: string): Promise<TokenResponse> {
  return tokenRequest({ code, redirect_uri: redirectUri, grant_type: "authorization_code" });
}

export async function refreshAccessToken(refreshToken: string): Promise<TokenResponse> {
  return tokenRequest({ refresh_token: refreshToken, grant_type: "refresh_token" });
}

async function api<T>(accessToken: string, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`https://www.googleapis.com/youtube/v3/${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const json = await res.json();
  if (!res.ok) {
    const msg = (json as any)?.error?.message ?? res.statusText;
    throw new Error(`YouTube: ${msg}`);
  }
  return json as T;
}

export async function myChannel(accessToken: string): Promise<{ id: string; title: string }> {
  const data = await api<{ items?: { id: string; snippet: { title: string } }[] }>(
    accessToken,
    "channels?part=snippet&mine=true",
  );
  const first = data.items?.[0];
  return { id: first?.id ?? "", title: first?.snippet?.title ?? "" };
}

export interface YoutubeBroadcast {
  broadcastId: string;
  streamId: string;
  ingestAddress: string;
  streamName: string;
  watchUrl: string;
}

/**
 * Credit for the music in the standby card, appended to every description.
 *
 * The clip carrying this track goes out on the simulcast, so it lands on each
 * host's own channel as well as ours — and an uncredited licensed track is
 * exactly what a Content ID claim is made of. Putting it here rather than
 * asking people to remember means a claim can only happen if the licence
 * itself changes. See media/README.md.
 */
export const MUSIC_CREDIT = [
  "Music from #Uppbeat",
  "https://uppbeat.io/t/sonda/rocket",
  "License code: 32BTNUWKMGDRSCHG",
].join("\n");

/** Append the credit once, leaving room inside YouTube's 5000-char limit. */
export function withMusicCredit(description: string): string {
  if (description.includes("uppbeat.io")) return description;
  const body = description.trim();
  const tail = `\n\n${MUSIC_CREDIT}`;
  return `${body.slice(0, 5000 - tail.length)}${tail}`;
}

/**
 * Opens a broadcast on their channel and returns somewhere to push to.
 * Three calls, because YouTube models the event and the pipe separately and
 * makes you bind them: create the broadcast, create the stream, bind.
 */
export async function createBroadcast(
  accessToken: string,
  opts: { title: string; description?: string; startAtIso: string; privacy?: "public" | "unlisted" | "private" },
): Promise<YoutubeBroadcast> {
  const broadcast = await api<{ id: string }>(accessToken, "liveBroadcasts?part=snippet,status,contentDetails", {
    method: "POST",
    body: JSON.stringify({
      snippet: {
        title: opts.title.slice(0, 100),
        description: withMusicCredit(opts.description ?? ""),
        scheduledStartTime: opts.startAtIso,
      },
      status: { privacyStatus: opts.privacy ?? "public", selfDeclaredMadeForKids: false },
      // Let YouTube start and stop with the stream; nobody is watching a
      // dashboard to press buttons at 3am.
      contentDetails: { enableAutoStart: true, enableAutoStop: true, enableDvr: true },
    }),
  });

  const stream = await api<{
    id: string;
    cdn: { ingestionInfo: { ingestionAddress: string; streamName: string } };
  }>(accessToken, "liveStreams?part=snippet,cdn,status", {
    method: "POST",
    body: JSON.stringify({
      snippet: { title: `${opts.title.slice(0, 80)} — MilitaryVoice` },
      cdn: { frameRate: "30fps", ingestionType: "rtmp", resolution: "1080p" },
    }),
  });

  await api(accessToken, `liveBroadcasts/bind?part=id,contentDetails&id=${broadcast.id}&streamId=${stream.id}`, {
    method: "POST",
  });

  return {
    broadcastId: broadcast.id,
    streamId: stream.id,
    ingestAddress: stream.cdn.ingestionInfo.ingestionAddress,
    streamName: stream.cdn.ingestionInfo.streamName,
    watchUrl: `https://www.youtube.com/watch?v=${broadcast.id}`,
  };
}
