import { useEffect, useMemo, useState } from "react";
import { StageGrid, useStageRoom, type RoomMeta } from "@/components/StageView";
import { apiRequest } from "@/lib/queryClient";
import { roomStageMeta, studioIdFromRoom, type RoomLive, type RoomLook } from "@shared/roomLook";

/** The room name inside a LiveKit token ("my-12"), without verifying anything: the page only needs to know which look to read. */
function roomOfToken(token: string | null): string {
  try {
    const part = (token ?? "").split(".")[1] ?? "";
    const json = JSON.parse(atob(part.replace(/-/g, "+").replace(/_/g, "/"))) as { video?: { room?: string } };
    return json.video?.room ?? "";
  } catch {
    return "";
  }
}

/**
 * The Room's picture: the same thing the recorder films, drawn from the same two sources.
 * People come from the LiveKit room (only those not sent backstage (stage = "off") are shown or heard);
 * the look (scenes, background, logo, banners, intro, outro) comes from Podcasting's look
 * endpoint; which scene is on, which banner is showing and which clip is playing come from the
 * room's metadata, which is ours. Nothing here decides any of it.
 */
export function RoomPicture({
  url,
  token,
  studioId,
  lookKey,
  name,
  muted = false,
  forRecording = false,
  onMediaEnded,
  onState,
}: {
  url: string | null;
  token: string | null;
  /** From the token when not given (the recorder's page has only the token). */
  studioId?: number | null;
  lookKey: string | null;
  name?: string;
  muted?: boolean;
  forRecording?: boolean;
  onMediaEnded?: () => void;
  onState?: (s: { connected: boolean; failed: boolean }) => void;
}) {
  const id = studioId ?? studioIdFromRoom(roomOfToken(token));
  const { tiles, meta: raw, connected, failed, caption } = useStageRoom(url, token, muted, undefined, forRecording, (a) => a.stage !== "off");
  const live = raw as unknown as RoomLive;

  useEffect(() => { onState?.({ connected, failed }); }, [connected, failed, onState]);

  // The look, again whenever Podcasting saves (lookRev changes on the room).
  const [look, setLook] = useState<RoomLook | null>(null);
  useEffect(() => {
    if (!id || !lookKey) return;
    let alive = true;
    void fetch(`/api/room/${id}/look?k=${encodeURIComponent(lookKey)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { look?: RoomLook } | null) => { if (alive && j?.look) setLook(j.look); })
      .catch(() => {});
    return () => { alive = false; };
  }, [id, lookKey, live.lookRev]);

  // A banner shows for its own seconds, so re-read the clock when it is due to go.
  const [now, setNow] = useState(() => Date.now());
  const until = live.showing?.until ?? 0;
  useEffect(() => {
    setNow(Date.now());
    if (until <= Date.now()) return;
    const t = window.setTimeout(() => setNow(Date.now()), until - Date.now() + 50);
    return () => window.clearTimeout(t);
  }, [until]);

  const { meta, banner } = useMemo(
    () => roomStageMeta(look, live, name || (raw as RoomMeta).studioName || "", window.location.origin, now),
    [look, live.activeScene, live.showing, live.playing, name, now], // eslint-disable-line react-hooks/exhaustive-deps
  );

  return (
    <div className="relative h-full w-full" style={{ containerType: "inline-size" }}>
      <StageGrid tiles={tiles} meta={meta as unknown as RoomMeta} muted={muted} caption={caption} idleTitle={name || "Starting soon"} onMediaEnded={onMediaEnded} />
      {banner && (
        <div className="pointer-events-none absolute z-30" style={{ left: "4%", right: "4%", bottom: "9%" }} data-testid="room-banner">
          <div className="text-white shadow-lg" style={{ background: "rgba(5,56,119,0.96)", borderLeft: "0.7cqw solid #F0A71F", borderRadius: "1cqw", padding: "1.1cqw 2cqw", fontSize: "2.6cqw", fontWeight: 600, lineHeight: 1.25 }}>
            {banner}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * The room UI's own view of the stage: exactly what the recording and the stream draw.
 * Standalone: put it where the stage goes. It listens through its own hidden connection (never
 * the host's), so it can't knock anyone out of the room.
 *
 * `onMediaEnded` fires when the intro or outro finishes; answer it with
 * POST /api/host/my-studio/media {action: "stop"} so the stage returns to the people.
 */
export function RoomStage({ muted = true, onMediaEnded, className = "" }: { muted?: boolean; onMediaEnded?: () => void; className?: string }) {
  const [conn, setConn] = useState<{ url: string; token: string; studioId: number; name: string; lookKey: string } | null>(null);
  useEffect(() => {
    let alive = true;
    void apiRequest("POST", "/api/host/my-studio/preview-token")
      .then((r) => r.json())
      .then((c) => { if (alive) setConn(c); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  return (
    <div className={`relative aspect-video w-full overflow-hidden rounded-2xl bg-[#04102b] ${className}`} data-testid="room-stage">
      <RoomPicture url={conn?.url ?? null} token={conn?.token ?? null} studioId={conn?.studioId} lookKey={conn?.lookKey ?? null} name={conn?.name} muted={muted} onMediaEnded={onMediaEnded} />
    </div>
  );
}
