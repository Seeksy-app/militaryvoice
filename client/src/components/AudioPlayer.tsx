import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Volume2, VolumeX } from "lucide-react";

const SRC = "/american-warriors-trailer.m4a";
const TITLE = "American Warriors";
const SOFT_VOLUME = 0.05; // background level — deliberately very quiet
const PREF_KEY = "mv_audio"; // "on" | "off"
const TOGGLE_SELECTOR = '[data-testid="button-audio-mute"]';

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
  /** True only when the trailer is actually audible. */
  playing: boolean;
  toggle: () => void;
}

const AudioCtx = createContext<AudioValue | null>(null);

/** For components that just react to playback (e.g. the hero waveform). */
export function useSiteAudio(): AudioValue {
  return useContext(AudioCtx) ?? { playing: false, toggle: () => {} };
}

/**
 * One <audio> element for the whole site, looping the trailer quietly.
 *
 * Sound is on by default. Browsers refuse to start audible audio before the
 * visitor interacts, so when that happens we start the track muted (which is
 * allowed) and unmute on their first click, tap, or keypress. Turning it off
 * is remembered, so it stays off across pages and reloads.
 */
export function SiteAudioProvider({ children }: { children: ReactNode }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const playingRef = useRef(false);
  playingRef.current = playing;

  useEffect(() => {
    const el = audioRef.current;
    if (!el || readPref() === "off") return;
    el.volume = SOFT_VOLUME;
    el.muted = false;

    let cleanup = () => {};

    const armUnmuteOnInteraction = () => {
      const unmute = (e: Event) => {
        // A click on the sound button is that button's job, not ours.
        const t = e.target;
        if (t instanceof Element && t.closest(TOGGLE_SELECTOR)) return;
        if (readPref() === "off") {
          cleanup();
          return;
        }
        el.muted = false;
        el.volume = SOFT_VOLUME;
        void el.play().then(() => setPlaying(true)).catch(() => {});
        cleanup();
      };
      const events: (keyof WindowEventMap)[] = ["pointerdown", "keydown", "touchstart", "wheel"];
      events.forEach((n) => window.addEventListener(n, unmute, { passive: true }));
      cleanup = () => events.forEach((n) => window.removeEventListener(n, unmute));
    };

    el.play()
      .then(() => setPlaying(true))
      .catch(() => {
        // Blocked: keep it rolling silently and wait for any interaction.
        el.muted = true;
        el.play()
          .then(armUnmuteOnInteraction)
          .catch(armUnmuteOnInteraction);
      });

    return () => cleanup();
  }, []);

  // Two tabs open on the site would each play their own copy, which sounds like
  // the trailer doubling over itself. localStorage fires a `storage` event in
  // every *other* tab, so turning it off anywhere turns it off everywhere.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== PREF_KEY) return;
      const el = audioRef.current;
      if (!el) return;
      if (e.newValue === "off") {
        el.pause();
        setPlaying(false);
      } else if (e.newValue === "on" && el.paused) {
        el.volume = SOFT_VOLUME;
        el.muted = false;
        void el.play().then(() => setPlaying(true)).catch(() => {});
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const toggle = useCallback(() => {
    const el = audioRef.current;
    if (!el) return;
    if (playingRef.current) {
      el.pause();
      el.muted = false;
      setPlaying(false);
      writePref("off");
    } else {
      el.volume = SOFT_VOLUME;
      el.muted = false;
      el.play()
        .then(() => {
          setPlaying(true);
          writePref("on");
        })
        .catch(() => setPlaying(false));
    }
  }, []);

  const value = useMemo(() => ({ playing, toggle }), [playing, toggle]);

  return (
    <AudioCtx.Provider value={value}>
      {children}
      <audio ref={audioRef} src={SRC} loop preload="auto" playsInline />
    </AudioCtx.Provider>
  );
}

/** Sound on/off. The single control, beside the hero waveform. */
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
      className={`inline-flex h-7 items-center justify-center gap-1 rounded-full border px-2 text-[11px] font-medium leading-none transition-colors ${base} ${className}`}
      data-testid="button-audio-mute"
    >
      {playing ? <Volume2 className="h-3.5 w-3.5 text-[#F0A71F]" /> : <VolumeX className="h-3.5 w-3.5" />}
      {withLabel && <span>{playing ? "Sound on" : "Sound off"}</span>}
    </button>
  );
}
