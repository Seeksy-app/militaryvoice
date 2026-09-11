// Brand mark: seven waveform bars whose heights trace a "V" — a chevron
// (military rank insignia) and the V of Voice in one shape, no container.
// Bars are Navy on light backgrounds and white on dark; the center bar, the
// point where the voice begins, is Amber. Palette: ParadeDeck style guide.
const BARS: { x: number; h: number }[] = [
  { x: 4, h: 36 },
  { x: 10, h: 26 },
  { x: 16, h: 16 },
  { x: 22, h: 9 },
  { x: 28, h: 16 },
  { x: 34, h: 26 },
  { x: 40, h: 36 },
];

export function LogoMark({ className = "h-8 w-8" }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" fill="none" className={className} aria-hidden="true">
      {BARS.map((b, i) => {
        const center = i === 3;
        return (
          <rect
            key={b.x}
            x={b.x}
            y={24 - b.h / 2}
            width="4.4"
            height={b.h}
            rx="2.2"
            className={center ? "fill-[#F0A71F]" : "fill-[#053877] dark:fill-white"}
          />
        );
      })}
    </svg>
  );
}

export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <span className={`font-bold tracking-tight ${className}`} style={{ fontFamily: "'General Sans', 'Inter', sans-serif" }}>
      <span className="text-[#000741] dark:text-white">MilitaryVoice</span>
      <span className="text-[#0064B1] dark:text-[#3D8FDB]">.ai</span>
    </span>
  );
}
