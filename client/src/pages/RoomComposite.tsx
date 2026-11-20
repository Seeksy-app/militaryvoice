import { useEffect, useMemo, useRef } from "react";
import { StageGrid, useStageRoom } from "@/components/StageView";

// The Room, as the recorder films it.
//
// LiveKit's egress loads this page in a headless browser and captures what it sees, so this is
// literally what the Library recording and every stream destination receives. It is the same
// stage the room shows (StageGrid, through RoomStage), so what the host sees is what goes out:
// the room's logo, background, layout and any intro or outro clip all come from the room's own
// metadata. Only people the host has brought on stage are shown or heard; anyone Backstage is
// never rendered, so their audio is never played here and never reaches the recording.
//
// Contract with the recorder: log START_RECORDING once we're ready to be filmed, and
// END_RECORDING when it's over.

export default function RoomComposite() {
  (window as unknown as { __mvBroadcast?: boolean }).__mvBroadcast = true;
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const url = params.get("url");
  const token = params.get("token");

  // Headless Chrome has no speakers to protect, so the composite is unmuted: this is the one
  // place audio must actually flow (the people on stage, and an intro or outro).
  const { tiles, meta, connected, failed, caption } = useStageRoom(url, token, false, undefined, true);

  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    if (connected || failed) {
      started.current = true;
      console.log("START_RECORDING");
      if (failed) console.log("END_RECORDING");
    }
  }, [connected, failed]);

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-[#04102b]">
      <StageGrid tiles={tiles} meta={meta} caption={caption} idleTitle={meta.studioName || "Starting soon"} />
    </div>
  );
}
