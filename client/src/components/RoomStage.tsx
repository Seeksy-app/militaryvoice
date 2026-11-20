import { useEffect, useState } from "react";
import { StageGrid, useStageRoom } from "@/components/StageView";
import { apiRequest } from "@/lib/queryClient";

/**
 * The Room's stage, exactly as the recording and the stream draw it (the same StageGrid the
 * recorder films). Standalone: the room UI puts it where its stage goes and passes nothing but
 * whether to play sound. It listens through its own hidden connection (never the host's), so it
 * can't knock anyone out of the room, and it follows the room's metadata: scene, layout, logo,
 * background, intro and outro all arrive through the room, so nothing here decides them.
 *
 * `onMediaEnded` fires when the intro or outro finishes. The room UI should answer it with
 * POST /api/host/my-studio/media {action: "stop"} so the stage returns to the people.
 */
export function RoomStage({ muted = true, onMediaEnded, className = "" }: { muted?: boolean; onMediaEnded?: () => void; className?: string }) {
  const [conn, setConn] = useState<{ url: string; token: string } | null>(null);
  useEffect(() => {
    let alive = true;
    void apiRequest("POST", "/api/host/my-studio/preview-token")
      .then((r) => r.json())
      .then((c: { url: string; token: string }) => { if (alive) setConn(c); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  const { tiles, meta, caption } = useStageRoom(conn?.url ?? null, conn?.token ?? null, muted);
  return (
    <div className={`relative aspect-video w-full overflow-hidden rounded-2xl bg-[#04102b] ${className}`} data-testid="room-stage">
      <StageGrid tiles={tiles} meta={meta} muted={muted} caption={caption} idleTitle={meta.studioName || "Starting soon"} onMediaEnded={onMediaEnded} />
    </div>
  );
}
