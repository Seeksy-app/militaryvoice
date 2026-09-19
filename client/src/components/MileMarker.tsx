import type { Marker } from "@shared/mileMarkers";

// A course marker, drawn rather than borrowed.
//
// The shape is the one every road race uses — a tall panel on a short post,
// a small word above a big number — because that is what makes it read as a
// mile marker at a glance rather than as a badge. The colours and the type are
// ours; real races' signage is their own branding.

const NAVY = "#000741";
const GOLD = "#F0A71F";

/**
 * @param tone  `solid` for the numbered miles, `quiet` for the bookends and
 *              the open slots — so scanning the column gives you the shape of
 *              the day before you read a word of it.
 */
export function MileMarker({
  marker,
  size = 56,
  className = "",
}: {
  marker: Marker;
  size?: number;
  className?: string;
}) {
  const quiet = marker.kind === "open";
  const accent = marker.kind === "point-two" ? GOLD : marker.kind === "mile" ? GOLD : "#ffffff";
  const panel = quiet ? "transparent" : NAVY;
  const stroke = quiet ? "#ffffff38" : GOLD;

  // A long label has to sit on one line inside a fixed panel, so the type
  // shrinks for words and stays big for numbers — "FINISH" and "14" cannot
  // share a size and both look deliberate.
  // Below about 50px the small caps stop being letters and become texture, so
  // the sign drops to just its number rather than printing something nobody
  // can read.
  const showSub = size >= 50 && !!marker.sub;
  const isWord = marker.label.length > 2;
  // Fitted, not guessed. A flat 12 for words put "START" through both edges of
  // the panel and spilled "FINISH" — the same mistake as the burned-in
  // captions earlier: picking a size that happens to suit the shortest case.
  // 0.68em is a fair average advance for bold sans at these sizes, and the
  // usable width is the panel less its stroke and a little air.
  // 34, not the full 38 of usable panel: solving for the exact width leaves a
  // word touching both edges, which reads as a mistake even when it technically
  // fits. The margin is the difference between fitting and looking placed.
  const INNER = 34;
  const numSize = isWord
    ? Math.min(12, INNER / (marker.label.length * 0.68))
    : marker.label.length > 1
      ? 21
      : 26;

  const W = 46;
  const H = 62;
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      width={size * (W / H)}
      height={size}
      className={className}
      role="img"
      aria-label={
        marker.kind === "mile" ? `Mile ${marker.n}` : marker.kind === "open" ? "Open slot" : marker.label
      }
      data-testid={`mile-marker-${marker.kind}${marker.n ? `-${marker.n}` : ""}`}
    >
      {/* The post, behind the panel so the panel's corner radius reads. */}
      <rect x={W / 2 - 1.6} y={H - 16} width="3.2" height="16" rx="1.4" fill={quiet ? "#ffffff30" : GOLD} />
      <rect
        x="1.5"
        y="1.5"
        width={W - 3}
        height={H - 19}
        rx="6"
        fill={panel}
        stroke={stroke}
        strokeWidth="2"
      />
      {!quiet && showSub && (
        <text
          x={W / 2}
          y="15"
          textAnchor="middle"
          fill={GOLD}
          fontSize="7"
          fontWeight="700"
          letterSpacing="1.1"
          style={{ textTransform: "uppercase" }}
        >
          {marker.sub?.toUpperCase()}
        </text>
      )}
      <text
        x={W / 2}
        y={quiet ? 28 : showSub ? 34 : 29}
        textAnchor="middle"
        fill={quiet ? "#ffffff55" : accent}
        fontSize={numSize}
        fontWeight="800"
        letterSpacing={isWord ? "0.6" : "-0.5"}
        style={{ fontFamily: "'General Sans', 'Inter', sans-serif" }}
      >
        {marker.label}
      </text>
    </svg>
  );
}
