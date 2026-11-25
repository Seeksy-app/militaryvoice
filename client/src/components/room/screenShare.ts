import { Track, type LocalParticipant } from "livekit-client";

/**
 * Share a screen without leaving the studio (Andrew, 24 Nov, after Riccoh's show: "make it where the screen share
 * stays: they pick what screen or what tab, and then it shows it on the screen. It keeps them in the studio").
 *
 * Chrome jumps to the tab or window you share; a CaptureController with setFocusBehavior("no-focus-change"),
 * called as soon as getDisplayMedia resolves, keeps this tab in front. LiveKit's setScreenShareEnabled awaits
 * other things before we could reach the controller, so we capture here and publish the tracks as the screen
 * share (and its sound) ourselves. Stopping is LiveKit's: setScreenShareEnabled(false), or Chrome's own
 * "Stop sharing", which ends the track and LiveKit unpublishes it.
 *
 * - selfBrowserSurface "exclude": the studio tab isn't offered (sharing it makes a hall of mirrors).
 * - surfaceSwitching "include": Chrome's "Share this tab instead" swaps the source without stopping.
 *
 * Returns whether this tab is expected to stay in front: true when focus was held, or a whole screen was shared
 * (that never moves focus); false when the browser may have switched (Safari, Firefox, an older Chrome).
 */
export async function startScreenShare(lp: LocalParticipant): Promise<{ stays: boolean }> {
  const Ctl = (window as unknown as { CaptureController?: new () => { setFocusBehavior?: (b: string) => void } }).CaptureController;
  const controller = Ctl ? new Ctl() : undefined;
  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: { frameRate: 30 },
    audio: true,
    selfBrowserSurface: "exclude",
    surfaceSwitching: "include",
    systemAudio: "include",
    ...(controller ? { controller } : {}),
  } as DisplayMediaStreamOptions);
  // Right away, in the same task as the resolve, or Chrome has already moved focus.
  let held = false;
  try { controller?.setFocusBehavior?.("no-focus-change"); held = !!controller?.setFocusBehavior; } catch { /* a whole screen: nothing to hold */ }
  const [video] = stream.getVideoTracks();
  const [audio] = stream.getAudioTracks();
  if (!video) { stream.getTracks().forEach((t) => t.stop()); throw new Error("No picture came through from the share."); }
  const surface = (video.getSettings() as MediaTrackSettings & { displaySurface?: string }).displaySurface;
  try {
    await lp.publishTrack(video, { source: Track.Source.ScreenShare, name: "screen" });
    if (audio) await lp.publishTrack(audio, { source: Track.Source.ScreenShareAudio, name: "screen_audio" });
  } catch (e) {
    stream.getTracks().forEach((t) => t.stop());
    throw e;
  }
  return { stays: held || surface === "monitor" };
}
