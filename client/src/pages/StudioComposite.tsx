import { useEffect, useMemo, useRef } from "react";
import { StageGrid, useStageRoom } from "@/components/StageView";

// The broadcast, as the recorder films it.
//
// LiveKit's egress loads this page in a headless browser and captures what it
// sees, so this is literally what an RTMP destination receives. It shares its
// stage rendering with the public watch page, so the two can't drift.
//
// Contract with the recorder: log START_RECORDING once we're ready to be
// filmed, and END_RECORDING when it's over. Nothing is captured before the
// first, and the file isn't finalised until the second.

export default function StudioComposite() {
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const url = params.get("url");
  const token = params.get("token");

  // Headless Chrome has no speakers to protect, so the composite is unmuted —
  // this is the one place audio must actually flow.
  const { tiles, meta, connected, failed, caption } = useStageRoom(url, token, false);

  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    if (connected || failed) {
      started.current = true;
      console.log("START_RECORDING");
      // Nothing to film and no prospect of any: end cleanly rather than
      // leaving the recorder waiting on a page that will never be ready.
      if (failed) console.log("END_RECORDING");
    }
  }, [connected, failed]);

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-[#000741]">
      <StageGrid tiles={tiles} meta={meta} caption={caption} />

      <img
        src="/logo-wave.png?v=2"
        alt=""
        className="pointer-events-none absolute right-6 top-5 h-10 w-auto opacity-90 drop-shadow-lg"
      />
      {meta.status === "Live" && !meta.fallbackPlaying && (
        <div className="pointer-events-none absolute left-6 top-5 flex items-center gap-2 rounded-full bg-[#ED1C24] px-4 py-1.5">
          <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-white" />
          <span className="text-sm font-bold uppercase tracking-[0.14em] text-white">Live</span>
        </div>
      )}
    </div>
  );
}
