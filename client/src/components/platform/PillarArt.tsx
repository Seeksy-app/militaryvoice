// Small on-brand illustrations for the four pillar cards on the About page.
// Flat, line-and-shape drawings in the brand's navy, gold and soft blues.
// Decorative only: the card's heading carries the meaning.

const NAVY = "#053877";
const DEEP = "#000741";
const GOLD = "#F0A71F";
const SOFT = "#cfdcf2";
const MIST = "#e6edf9";

function Frame({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <svg viewBox="0 0 320 140" className="h-full w-full" aria-hidden="true" focusable="false" data-art={label}>
      {children}
    </svg>
  );
}

/** A stage with a speaker at a lectern, broadcasting to three screens. */
function EventsArt() {
  return (
    <Frame label="events">
      {/* spotlight */}
      <path d="M92 4 L60 108 L124 108 Z" fill={GOLD} opacity="0.16" />
      <circle cx="92" cy="6" r="5" fill={GOLD} />
      {/* stage */}
      <path d="M22 108 H162 L152 122 H32 Z" fill={NAVY} />
      <rect x="22" y="104" width="140" height="6" rx="2" fill={DEEP} />
      {/* speaker + lectern */}
      <circle cx="92" cy="52" r="9" fill={DEEP} />
      <path d="M78 90 C78 72 84 64 92 64 C100 64 106 72 106 90 Z" fill={DEEP} />
      <path d="M78 78 H106 L102 104 H82 Z" fill="#fff" stroke={NAVY} strokeWidth="2" />
      <rect x="86" y="84" width="12" height="3" rx="1.5" fill={GOLD} />
      {/* audience */}
      {[40, 58, 76, 94, 112, 130, 148].map((x, i) => (
        <circle key={x} cx={x} cy={i % 2 ? 131 : 133} r="6" fill={SOFT} />
      ))}
      {/* broadcast waves */}
      {[14, 24, 34].map((r, i) => (
        <path key={r} d={`M ${176 + r * 0.2} ${58 - r} A ${r} ${r} 0 0 1 ${176 + r * 0.2} ${58 + r}`} fill="none" stroke={GOLD} strokeWidth="2.5" strokeLinecap="round" opacity={1 - i * 0.25} />
      ))}
      {/* screens */}
      {[
        [220, 16],
        [252, 52],
        [220, 88],
      ].map(([x, y], i) => (
        <g key={i}>
          <rect x={x} y={y} width="58" height="36" rx="6" fill="#fff" stroke={NAVY} strokeWidth="2" />
          <rect x={x + 5} y={y + 5} width="48" height="26" rx="3" fill={i === 1 ? NAVY : MIST} />
          <path d={`M ${x + 25} ${y + 12} L ${x + 34} ${y + 18} L ${x + 25} ${y + 24} Z`} fill={i === 1 ? GOLD : NAVY} />
        </g>
      ))}
    </Frame>
  );
}

/** A run of show assembling itself, with Alex's spark. */
function AiArt() {
  const rows = [
    { y: 30, w: 92, time: "7:00" },
    { y: 54, w: 70, time: "7:25" },
    { y: 78, w: 84, time: "7:30" },
  ];
  return (
    <Frame label="ai">
      {/* the sheet */}
      <rect x="54" y="10" width="170" height="122" rx="12" fill="#fff" stroke={NAVY} strokeWidth="2" />
      <rect x="54" y="10" width="170" height="14" rx="7" fill={NAVY} />
      <rect x="54" y="18" width="170" height="6" fill={NAVY} />
      <circle cx="66" cy="17" r="2.5" fill={GOLD} />
      <circle cx="75" cy="17" r="2.5" fill={SOFT} />
      {rows.map((r) => (
        <g key={r.y}>
          <rect x="66" y={r.y} width="30" height="14" rx="7" fill={MIST} />
          <text x="81" y={r.y + 10} textAnchor="middle" fontSize="8" fontWeight="700" fill={NAVY} fontFamily="Inter, sans-serif">{r.time}</text>
          <rect x="104" y={r.y + 4} width={r.w} height="6" rx="3" fill={SOFT} />
        </g>
      ))}
      {/* the row sliding into place */}
      <g transform="translate(18 0)">
        <rect x="60" y="100" width="150" height="22" rx="8" fill={GOLD} opacity="0.18" />
        <rect x="66" y="104" width="30" height="14" rx="7" fill={GOLD} />
        <text x="81" y="114" textAnchor="middle" fontSize="8" fontWeight="700" fill={DEEP} fontFamily="Inter, sans-serif">7:55</text>
        <rect x="104" y="108" width="76" height="6" rx="3" fill={NAVY} />
      </g>
      <path d="M40 111 H70" stroke={GOLD} strokeWidth="2" strokeDasharray="3 4" strokeLinecap="round" />
      {/* Alex's spark */}
      <circle cx="262" cy="52" r="30" fill={NAVY} />
      <path d="M262 30 C264 44 268 48 282 52 C268 56 264 60 262 74 C260 60 256 56 242 52 C256 48 260 44 262 30 Z" fill={GOLD} />
      <path d="M290 18 C291 24 292 25 298 26 C292 27 291 28 290 34 C289 28 288 27 282 26 C288 25 289 24 290 18 Z" fill={GOLD} opacity="0.8" />
      <path d="M244 96 C252 104 272 104 280 96" fill="none" stroke={SOFT} strokeWidth="3" strokeLinecap="round" />
    </Frame>
  );
}

/** A lens over creator cards, one of them carrying the gold badge. */
function DiscoveryArt() {
  const card = (x: number, y: number, hi = false) => (
    <g>
      <rect x={x} y={y} width="74" height="92" rx="10" fill="#fff" stroke={hi ? GOLD : SOFT} strokeWidth={hi ? 2.5 : 2} />
      <circle cx={x + 37} cy={y + 30} r="14" fill={hi ? NAVY : SOFT} />
      <rect x={x + 16} y={y + 54} width="42" height="6" rx="3" fill={hi ? NAVY : SOFT} />
      <rect x={x + 22} y={y + 66} width="30" height="5" rx="2.5" fill={MIST} />
      <rect x={x + 12} y={y + 78} width="50" height="5" rx="2.5" fill={MIST} />
    </g>
  );
  return (
    <Frame label="discovery">
      {card(34, 30)}
      {card(123, 22, true)}
      {card(212, 30)}
      {/* verified badge */}
      <circle cx="190" cy="30" r="12" fill={GOLD} />
      <path d="M184 30 L188.5 34.5 L196.5 26" fill="none" stroke={DEEP} strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" />
      {/* lens */}
      <circle cx="178" cy="78" r="30" fill={NAVY} opacity="0.08" stroke={NAVY} strokeWidth="5" />
      <path d="M200 100 L222 122" stroke={NAVY} strokeWidth="9" strokeLinecap="round" />
      <path d="M160 64 A20 20 0 0 1 176 56" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" />
    </Frame>
  );
}

/** A shield with a check over a profile card. */
function VerifiedArt() {
  return (
    <Frame label="verified">
      {/* profile card */}
      <rect x="40" y="24" width="170" height="94" rx="12" fill="#fff" stroke={SOFT} strokeWidth="2" />
      <circle cx="78" cy="62" r="20" fill={SOFT} />
      <circle cx="78" cy="56" r="7" fill={NAVY} />
      <path d="M66 74 C68 66 88 66 90 74" fill={NAVY} />
      <rect x="108" y="48" width="78" height="7" rx="3.5" fill={NAVY} />
      <rect x="108" y="62" width="56" height="6" rx="3" fill={SOFT} />
      <rect x="108" y="74" width="66" height="6" rx="3" fill={MIST} />
      <rect x="58" y="96" width="92" height="12" rx="6" fill={GOLD} opacity="0.2" />
      <rect x="64" y="100" width="60" height="4" rx="2" fill={GOLD} />
      {/* shield */}
      <path d="M246 14 L284 28 V62 C284 88 268 106 246 118 C224 106 208 88 208 62 V28 Z" fill={NAVY} />
      <path d="M246 24 L275 35 V62 C275 82 263 96 246 106 C229 96 217 82 217 62 V35 Z" fill="none" stroke={GOLD} strokeWidth="2" opacity="0.7" />
      <path d="M231 64 L242 75 L262 53" fill="none" stroke={GOLD} strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
    </Frame>
  );
}

const ART = { Events: EventsArt, "Run by AI": AiArt, Discovery: DiscoveryArt, Verified: VerifiedArt } as const;

/** The illustrated band across the top of a pillar card. */
export function PillarArt({ kicker }: { kicker: string }) {
  const Art = ART[kicker as keyof typeof ART];
  if (!Art) return null;
  return (
    <div className="-mx-7 -mt-7 mb-6 flex h-36 items-center justify-center border-b border-border bg-[linear-gradient(180deg,#eef3fb,#f8fafe)] px-6 py-3 dark:bg-[linear-gradient(180deg,#0d1a45,#0a1433)] sm:h-40">
      <Art />
    </div>
  );
}
