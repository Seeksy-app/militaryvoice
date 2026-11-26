/**
 * The light sky behind Travel's title (Andrew's target, 26 Nov): soft clouds and a jet climbing on the right with a
 * contrail. Drawn here as SVG, so there's no image file to load and nothing from stock. A generic airliner with no
 * livery or airline mark.
 */
export function TravelSky() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-b from-[#cfe1fa] via-[#e7f0fd] to-[#f4f8ff] dark:from-[#0c2347] dark:via-[#0d1f3d] dark:to-transparent" />
      <svg className="absolute inset-x-0 top-0 h-[260px] w-full dark:opacity-20" viewBox="0 0 1200 260" preserveAspectRatio="xMidYMid slice">
        <defs>
          <filter id="mv-cloud" x="-20%" y="-50%" width="140%" height="200%"><feGaussianBlur stdDeviation="14" /></filter>
          <linearGradient id="mv-trail" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#fff" stopOpacity="0" />
            <stop offset="1" stopColor="#fff" stopOpacity="0.9" />
          </linearGradient>
        </defs>
        <g filter="url(#mv-cloud)" fill="#fff">
          <ellipse cx="80" cy="40" rx="140" ry="34" opacity="0.75" />
          <ellipse cx="380" cy="18" rx="180" ry="30" opacity="0.6" />
          <ellipse cx="620" cy="70" rx="150" ry="26" opacity="0.55" />
          <ellipse cx="900" cy="30" rx="220" ry="38" opacity="0.7" />
          <ellipse cx="1130" cy="120" rx="160" ry="40" opacity="0.8" />
          <ellipse cx="250" cy="200" rx="260" ry="46" opacity="0.65" />
          <ellipse cx="760" cy="215" rx="300" ry="44" opacity="0.6" />
        </g>
        {/* The contrail behind the jet, fading to nothing on the left. */}
        <path d="M640 150 L1000 78" stroke="url(#mv-trail)" strokeWidth="5" strokeLinecap="round" />
        <path d="M660 160 L1004 92" stroke="url(#mv-trail)" strokeWidth="3" strokeLinecap="round" opacity="0.7" />
      </svg>
      <svg className="absolute right-[1%] top-0 hidden w-[230px] drop-shadow-[0_8px_10px_rgba(11,27,51,0.18)] md:block xl:w-[330px] dark:opacity-60" viewBox="0 0 300 120">
        <defs>
          <linearGradient id="mv-body" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#ffffff" />
            <stop offset="0.6" stopColor="#eef2f7" />
            <stop offset="1" stopColor="#b9c4d3" />
          </linearGradient>
          <linearGradient id="mv-wing" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#dfe5ee" />
            <stop offset="1" stopColor="#a9b5c6" />
          </linearGradient>
        </defs>
        <g transform="rotate(-16 150 60) translate(20 40)">
          {/* far wing, behind the body */}
          <path d="M128 18 L104 -14 L116 -15 L152 16 Z" fill="#c9d2de" />
          {/* tail fin and stabiliser */}
          <path d="M22 16 L4 -20 L19 -20 L58 15 Z" fill="url(#mv-wing)" />
          <path d="M30 26 L8 40 L20 41 L56 28 Z" fill="#b3bfcf" />
          {/* body */}
          <path d="M2 22 C10 13 40 12 210 12 C236 12 252 17 262 23 C252 29 236 33 210 33 L34 33 C16 33 6 29 2 22 Z" fill="url(#mv-body)" />
          {/* windows and cockpit */}
          <g fill="#5d6b80">{Array.from({ length: 22 }, (_, i) => <rect key={i} x={62 + i * 7.2} y="17.5" width="3.4" height="3" rx="1.2" />)}</g>
          <path d="M240 18 C247 18 253 20 257 22 L244 22 Z" fill="#3b475a" />
          {/* near wing with its engine */}
          <path d="M118 28 L80 70 L99 71 L160 30 Z" fill="url(#mv-wing)" />
          <ellipse cx="104" cy="46" rx="15" ry="6" fill="#c4cdd9" />
          <ellipse cx="117" cy="46" rx="3" ry="5.4" fill="#6b778a" />
        </g>
      </svg>
    </div>
  );
}
