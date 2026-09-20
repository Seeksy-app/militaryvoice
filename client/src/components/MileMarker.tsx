import type { Marker } from "@shared/mileMarkers";

// A race bib, drawn rather than borrowed.
//
// The first version was a roadside sign, and side by side the bib won on two
// counts. It is the only shape that is light on dark, so against the navy card
// header it reads as an object rather than as an outline inside it. And it is
// the better metaphor: a sign is something you run past, a bib is something you
// are given with your number on it. For a slot a podcaster screenshots and
// posts, belonging beats passing.
//
// The shape is the generic one — light card, big number, perforated tear-off,
// two pin holes. Colours and type are ours.

const NAVY = "#000741";
const GOLD = "#F0A71F";
const PAPER = "#FAF7F0";

export function MileMarker({
  marker,
  size = 48,
  className = "",
}: {
  marker: Marker;
  size?: number;
  className?: string;
}) {
  const quiet = marker.kind === "open";

  // Below about 40px the small caps stop being letters and become texture, so
  // the bib drops to its number alone rather than printing something nobody can
  // read. Same rule the sign needed, for the same reason.
  const showSub = size >= 40 && !!marker.sub;

  // Fitted, not guessed — a flat size for words put START through both edges.
  // 38 of the 44 usable units, so a word sits inside the card with air around
  // it instead of against its borders.
  const isWord = marker.label.length > 2;
  const INNER = 38;
  const numSize = isWord
    ? Math.min(13, INNER / (marker.label.length * 0.68))
    : marker.label.length > 1
      ? 22
      : 26;

  const W = 54;
  const H = 48;
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      width={size * (W / H)}
      height={size}
      className={className}
      role="img"
      aria-label={
        marker.kind === "mile"
          ? `Mile ${marker.n}`
          : marker.kind === "open"
            ? "Open slot"
            : marker.kind === "medal"
              ? "Thank you"
              : marker.label
      }
      data-testid={`mile-marker-${marker.kind}${marker.n ? `-${marker.n}` : ""}`}
    >
      <rect
        x="1.5"
        y="1.5"
        width={W - 3}
        height={H - 3}
        rx="4"
        fill={quiet ? "transparent" : PAPER}
        stroke={quiet ? "#ffffff40" : NAVY}
        strokeWidth="1.5"
        strokeDasharray={quiet ? "3 2.6" : undefined}
      />
      {/* The tear-off strip and the pin holes. Small, but they are what stop it
          reading as a plain white chip with a number on it. */}
      {!quiet && (
        <>
          <line
            x1="4"
            y1={H - 11}
            x2={W - 4}
            y2={H - 11}
            stroke={NAVY}
            strokeWidth="0.8"
            strokeDasharray="1.6 1.8"
            opacity="0.45"
          />
          <circle cx="6" cy="6" r="1.1" fill={NAVY} opacity="0.3" />
          <circle cx={W - 6} cy="6" r="1.1" fill={NAVY} opacity="0.3" />
        </>
      )}
      {!quiet && showSub && (
        <text
          x={W / 2}
          y="10"
          textAnchor="middle"
          fill={GOLD}
          fontSize="6.2"
          fontWeight="800"
          letterSpacing="1.2"
        >
          {marker.sub?.toUpperCase()}
        </text>
      )}
      <text
        x={W / 2}
        y={quiet ? 30 : showSub ? (isWord ? 29 : 31) : 30}
        textAnchor="middle"
        fill={quiet ? "#ffffff55" : NAVY}
        fontSize={numSize}
        fontWeight="800"
        letterSpacing={isWord ? "0.4" : "-0.5"}
        style={{ fontFamily: "'General Sans', 'Inter', sans-serif" }}
      >
        {marker.label}
      </text>
    </svg>
  );
}
