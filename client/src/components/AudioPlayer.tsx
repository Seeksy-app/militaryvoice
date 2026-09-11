import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Volume2, VolumeX } from "lucide-react";

const SRC = "/american-warriors-trailer.m4a";
const TITLE = "American Warriors";
const SOFT_VOLUME = 0.18; // background level — deliberately quiet

interface AudioValue {
  playing: boolean;
  muted: boolean;
  blocked: boolean;
  toggle: () => void;
  toggleMute: () => void;
}

const AudioCtx = createContext<AudioValue | null>(null);

/** Read-only in components that just want to react to playback (e.g. the hero waveform). */
export function useSiteAudio(): AudioValue {
  return (
    useContext(AudioCtx) ?? {
      playing: false,
      muted: false,
      blocked: false,
      toggle: () => {},
      toggleMute: () => {},
    }
  );
}

/**
 * One <audio> element for the whole site. Browsers block sound that starts on
 * its own, so we try a quiet autoplay and fall back to an obvious prompt.
 * Nothing plays loud: volume is fixed low and mute is always one tap away.
 */
export function SiteAudioProvider({ children }: { children: ReactNode }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [blocked, setBlocked] = useState(false);
  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    el.volume = SOFT_VOLUME;
    el.play()
      .then(() => setPlaying(true))
      .catch(() => setBlocked(true));
  }, []);

  const toggle = useCallback(() => {
    const el = audioRef.current;
    if (!el) return;
    if (el.paused) {
      el.volume = SOFT_VOLUME;
      el.muted = false;
      setMuted(false);
      el.play()
        .then(() => {
          setPlaying(true);
          setBlocked(false);
        })
        .catch(() => setBlocked(true));
    } else {
      el.pause();
      setPlaying(false);
    }
  }, []);

  const toggleMute = useCallback(() => {
    const el = audioRef.current;
    if (!el) return;
    // Muting while blocked should still start playback (muted audio is allowed).
    if (el.paused) {
      el.volume = SOFT_VOLUME;
      el.play()
        .then(() => {
          setPlaying(true);
          setBlocked(false);
        })
        .catch(() => setBlocked(true));
      return;
    }
    el.muted = !el.muted;
    setMuted(el.muted);
  }, []);

  const value = useMemo(() => ({ playing, muted, blocked, toggle, toggleMute }), [playing, muted, blocked, toggle, toggleMute]);

  return (
    <AudioCtx.Provider value={value}>
      {children}
      <audio ref={audioRef} src={SRC} loop preload="none" playsInline />
    </AudioCtx.Provider>
  );
}

/**
 * Sound control used in the nav (next to the theme toggle) and beside the hero
 * waveform. One tap starts the trailer if it isn't running, mutes if it is.
 */
export function AudioToggle({ className = "", tone = "light" }: { className?: string; tone?: "light" | "dark" }) {
  const { playing, muted, toggleMute } = useSiteAudio();
  const on = playing && !muted;
  const base =
    tone === "dark"
      ? "border-white/25 bg-white/10 text-white hover:bg-white/20"
      : "border-border bg-background text-muted-foreground hover:text-foreground";
  return (
    <button
      type="button"
      onClick={toggleMute}
      aria-label={on ? "Mute the trailer" : "Play the trailer"}
      title={on ? `Mute ${TITLE}` : `Listen to the ${TITLE} trailer`}
      aria-pressed={on}
      className={`inline-flex h-9 w-9 items-center justify-center rounded-full border transition-colors ${base} ${className}`}
      data-testid="button-audio-mute"
    >
      {on ? <Volume2 className="h-4 w-4 text-[#F0A71F]" /> : <VolumeX className="h-4 w-4" />}
    </button>
  );
}
