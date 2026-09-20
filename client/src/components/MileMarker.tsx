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

  // The Flag Carry gets the thing itself rather than its initial. It is the one
  // marker on the course that is a picture, which is the point — it reads at
  // bib size from across a scrolling page, where a letter has to be spelled out.
  const isFlag = marker.kind === "flag";

  // The awards bib wears the medal itself. A star is a rating; a medal on a
  // ribbon is the thing you are handed at the end of a race.
  const isMedal = marker.kind === "medal";

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

  // The sub-label is fitted too. It was a flat 6.2, which was fine while every
  // tag was one short word and runs straight off both edges on "FINAL STRETCH".
  // Letter-spacing scales with the size, so the whole string scales together.
  const subText = (marker.sub ?? "").toUpperCase();
  const fit = (t: string) => Math.min(6.2, INNER / (t.length * 0.79));
  // A two-word tag goes on two lines rather than being shrunk to fit. "FINAL
  // STRETCH" on one line measures three pixels on screen at agenda size, which
  // is a grey smudge where a label should be; split, both halves read.
  const subLines =
    fit(subText) < 4.6 && subText.includes(" ") ? subText.split(/\s+/) : [subText];
  const subSize = Math.min(...subLines.map(fit));
  const subTrack = subSize * 0.19;

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
              : marker.kind === "flag"
                ? "The Flag Carry"
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
          y={subLines.length > 1 ? 8.4 : 10}
          textAnchor="middle"
          fill={GOLD}
          fontSize={subSize}
          fontWeight="800"
          letterSpacing={subTrack}
        >
          {subLines.map((line, i) => (
            <tspan key={line} x={W / 2} dy={i === 0 ? 0 : subSize * 1.05}>
              {line}
            </tspan>
          ))}
        </text>
      )}
      {isMedal ? (
        <g stroke={NAVY} strokeLinecap="butt" strokeLinejoin="round" fill="none">
          {/* Thick enough to read as ribbon. At two units they were antennae. */}
          <path d="M21.8 13.4 L25.4 22.2" strokeWidth="3.6" />
          <path d="M32.2 13.4 L28.6 22.2" strokeWidth="3.6" />
          <circle cx="27" cy="27.8" r="6" fill={NAVY} stroke="none" />
        </g>
      ) : isFlag ? (
        <g
          stroke={NAVY}
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          transform={showSub ? "translate(0 1)" : ""}
        >
          <line x1="18.5" y1="13.5" x2="18.5" y2="33" />
          <path d="M19.2 15C24.2 11.8 29.2 17.6 34.2 14.4L34.2 23.6C29.2 26.8 24.2 21 19.2 24.2Z" fill={NAVY} />
        </g>
      ) : (
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
      )}
    </svg>
  );
}
