import { useCallback, useMemo, useRef } from "react";
import { RoomPicture } from "@/components/RoomStage";

// The Room, as the recorder films it.
//
// LiveKit's egress loads this page in a headless browser and captures what it sees, so this is
// literally what the Library recording and every stream destination receives. It is the same
// picture the room shows (RoomPicture): the look from Podcasting, the scene, banner and clip from
// the room's metadata, and only people with stage = "on". Anyone backstage is never rendered, so
// their audio is never played here and never reaches the recording.
//
// The address is /room/composite/<key>: the key lets this page read the room's look without a
// login (it is in the path, because LiveKit adds url and token to the query itself).
//
// Contract with the recorder: log START_RECORDING once we're ready to be filmed, and
// END_RECORDING when it's over.

export default function RoomComposite({ k }: { k: string }) {
  (window as unknown as { __mvBroadcast?: boolean }).__mvBroadcast = true;
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const url = params.get("url");
  const token = params.get("token");

  const started = useRef(false);
  const onState = useCallback(({ connected, failed }: { connected: boolean; failed: boolean }) => {
    if (started.current || !(connected || failed)) return;
    started.current = true;
    console.log("START_RECORDING");
    if (failed) console.log("END_RECORDING");
  }, []);

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-[#04102b]">
      {/* Headless Chrome has no speakers to protect, so this is the one place audio must flow. */}
      <RoomPicture url={url} token={token} lookKey={k} muted={false} forRecording onState={onState} />
    </div>
  );
}
