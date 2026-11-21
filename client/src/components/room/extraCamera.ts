// An extra camera (StreamYard's "Add another camera", 21 Nov): a second camera on the owner's own
// computer joins the studio as its own picture (owner-<id>-cam-<hex>, video only), so it goes on
// stage, backstage or off like a guest. It lives in this tab and leaves with it.
import { useSyncExternalStore } from "react";
import { Room, Track, createLocalVideoTrack } from "livekit-client";
import { apiRequest } from "@/lib/queryClient";

export const EXTRA_CAMS = 2;
type Cam = { identity: string; deviceId: string; label: string; room: Room };
let cams: Cam[] = [];
const subs = new Set<() => void>();
const emit = () => { cams = [...cams]; subs.forEach((f) => f()); };

export const isExtraCam = (identity: string) => /^owner-\d+-cam-[a-f0-9]+$/.test(identity);
export const useExtraCams = () => useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, () => cams);

/** Cameras on this computer, apart from the ones already in use (the main one and any extra). */
export async function freeCameras(inUse: string[]): Promise<MediaDeviceInfo[]> {
  const all = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "videoinput" && d.deviceId);
  const busy = new Set([...inUse, ...cams.map((c) => c.deviceId)]);
  return all.filter((d) => !busy.has(d.deviceId));
}

export async function addExtraCamera(device: MediaDeviceInfo, name: string): Promise<void> {
  if (cams.length >= EXTRA_CAMS) throw new Error(`You can add up to ${EXTRA_CAMS} extra cameras.`);
  const label = (device.label || "Camera").replace(/\s*\([0-9a-f]{4}:[0-9a-f]{4}\)\s*$/i, "").slice(0, 40);
  const track = await createLocalVideoTrack({ deviceId: { exact: device.deviceId }, resolution: { width: 1280, height: 720, frameRate: 30 } })
    .catch(() => { throw new Error("That camera is busy or blocked. Close any other app using it, then try again."); });
  let room: Room | null = null;
  try {
    const { url, token, identity } = await (await apiRequest("POST", "/api/host/my-studio/camera-token", { name: `${name} · ${label}`.slice(0, 60) })).json() as { url: string; token: string; identity: string };
    room = new Room({ adaptiveStream: false, dynacast: true });
    await room.connect(url, token, { autoSubscribe: false });
    await room.localParticipant.publishTrack(track, { source: Track.Source.Camera, simulcast: true });
    const r = room;
    r.on("disconnected", () => { cams = cams.filter((c) => c.room !== r); track.stop(); emit(); });
    cams.push({ identity, deviceId: device.deviceId, label, room: r });
    emit();
  } catch (e) {
    track.stop();
    await room?.disconnect().catch(() => {});
    throw e;
  }
}

export async function stopExtraCamera(identity: string): Promise<void> {
  const c = cams.find((x) => x.identity === identity);
  if (!c) return;
  await c.room.disconnect().catch(() => {});
  cams = cams.filter((x) => x !== c);
  emit();
}

export async function stopAllExtraCameras(): Promise<void> {
  await Promise.all(cams.map((c) => c.room.disconnect().catch(() => {})));
  cams = [];
  emit();
}
