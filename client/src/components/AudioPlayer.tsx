import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Volume2, VolumeX } from "lucide-react";

const SRC = "/american-warriors-trailer.m4a";
const TITLE = "American Warriors";
const SOFT_VOLUME = 0.05; // background level — deliberately very quiet
const PREF_KEY = "mv_audio"; // "on" | "off"

function readPref(): "on" | "off" | null {
  try {
    const v = localStorage.getItem(PREF_KEY);
    return v === "on" || v === "off" ? v : null;
  } catch {
    return null;
  }
}
function writePref(v: "on" | "off") {
  try {
    localStorage.setItem(PREF_KEY, v);
  } catch {
    /* ignore */
  }
}

interface AudioValue {
  playing: boolean;
  toggle: () => void;
}

const AudioCtx = createContext<AudioValue | null>(null);

/** For components that just react to playback (e.g. the hero waveform). */
export function useSiteAudio(): AudioValue {
  return useContext(AudioCtx) ?? { playing: false, toggle: () => {} };
}

/**
 * One <audio> element for the whole site, playing the trailer quietly on a
 * loop. Sound is a single on/off the visitor controls, and the choice is
 * remembered — once it's off it stays off across pages and reloads. Browsers
 * block sound that starts on its own, so the first play often needs a tap.
 */
export function SiteAudioProvider({ children }: { children: ReactNode }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);

  // Only try to start on a fresh visitor or one who left it on.
  useEffect(() => {
    const el = audioRef.current;
    if (!el || readPref() === "off") return;
    el.volume = SOFT_VOLUME;
    el.play()
      .then(() => setPlaying(true))
      .catch(() => setPlaying(false));
  }, []);

  const toggle = useCallback(() => {
    const el = audioRef.current;
    if (!el) return;
    if (el.paused) {
      el.volume = SOFT_VOLUME;
      el.muted = false;
      el.play()
        .then(() => {
          setPlaying(true);
          writePref("on");
        })
        .catch(() => setPlaying(false));
    } else {
      el.pause();
      setPlaying(false);
      writePref("off");
    }
  }, []);

  const value = useMemo(() => ({ playing, toggle }), [playing, toggle]);

  return (
    <AudioCtx.Provider value={value}>
      {children}
      <audio ref={audioRef} src={SRC} loop preload="none" playsInline />
    </AudioCtx.Provider>
  );
}

/**
 * Sound on/off. Sits in the nav next to the theme toggle and beside the hero
 * waveform. Always visible, including on phones.
 */
export function AudioToggle({
  className = "",
  tone = "light",
  withLabel = false,
}: {
  className?: string;
  tone?: "light" | "dark";
  withLabel?: boolean;
}) {
  const { playing, toggle } = useSiteAudio();
  const base =
    tone === "dark"
      ? "border-white/25 bg-white/10 text-white hover:bg-white/20"
      : playing
        ? "border-primary/40 bg-primary/10 text-primary hover:bg-primary/15"
        : "border-border bg-background text-muted-foreground hover:text-foreground";
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={playing ? `Turn off the ${TITLE} trailer` : `Play the ${TITLE} trailer`}
      title={playing ? "Sound on — tap to turn it off" : "Sound off — tap to listen"}
      aria-pressed={playing}
      className={`inline-flex h-9 items-center justify-center gap-1.5 rounded-full border px-2.5 text-xs font-medium transition-colors ${base} ${className}`}
      data-testid="button-audio-mute"
    >
      {playing ? <Volume2 className="h-4 w-4 text-[#F0A71F]" /> : <VolumeX className="h-4 w-4" />}
      {withLabel && <span>{playing ? "Sound on" : "Sound off"}</span>}
    </button>
  );
}
