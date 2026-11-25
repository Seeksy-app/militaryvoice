import type { ReactNode } from "react";
import type { IconType } from "react-icons";
import { SiFacebook, SiKick, SiObsstudio, SiSpotify, SiThreads, SiTiktok, SiTwitch, SiX, SiYoutube, SiYoutubemusic } from "react-icons/si";
import { FaLinkedin } from "react-icons/fa6";

/**
 * Every third-party brand as its own mark, in its own colours (Andrew, 22 Nov: "make sure we use all the right
 * icon branding, like for YouTube, Spotify, Resream, OBS, and StreamYard"). One place for all of them: use
 * <BrandMark brand="obs" /> anywhere a brand shows, never a line icon or letters standing in for one.
 * Marks come from Simple Icons (react-icons/si) or the brand's own file in /brands/. Never recolour, stretch or crop:
 * the only change allowed is white for the black-only marks (X, Threads, TikTok, OBS) on a dark background.
 */
export type Brand =
  | "youtube" | "youtube-music" | "spotify" | "apple-podcasts" | "facebook" | "instagram" | "linkedin" | "tiktok" | "x" | "threads"
  | "buzzsprout" | "zoom" | "restream" | "obs" | "streamyard" | "twitch" | "kick";

type Look = { name: string; icon?: IconType; color?: string; file?: string; /** Black mark: white on dark backgrounds. */ mono?: boolean };
const IG = "M7.0301.084c-1.2768.0602-2.1487.264-2.911.5634-.7888.3075-1.4575.72-2.1228 1.3877-.6652.6677-1.075 1.3368-1.3802 2.127-.2954.7638-.4956 1.6365-.552 2.914-.0564 1.2775-.0689 1.6882-.0626 4.947.0062 3.2586.0206 3.6671.0825 4.9473.061 1.2765.264 2.1482.5635 2.9107.308.7889.72 1.4573 1.388 2.1228.6679.6655 1.3365 1.0743 2.1285 1.38.7632.295 1.6361.4961 2.9134.552 1.2773.056 1.6884.069 4.9462.0627 3.2578-.0062 3.668-.0207 4.9478-.0814 1.28-.0607 2.147-.2652 2.9098-.5633.7889-.3086 1.4578-.72 2.1228-1.3881.665-.6682 1.0745-1.3378 1.3795-2.1284.2957-.7632.4966-1.636.552-2.9124.056-1.2809.0692-1.6898.063-4.948-.0063-3.2583-.021-3.6668-.0817-4.9465-.0607-1.2797-.264-2.1487-.5633-2.9117-.3084-.7889-.72-1.4568-1.3876-2.1228C21.2982 1.33 20.628.9208 19.8378.6165 19.074.321 18.2017.1197 16.9244.0645 15.6471.0093 15.236-.005 11.977.0014 8.718.0076 8.31.0215 7.0301.0839m.1402 21.6932c-1.17-.0509-1.8053-.2453-2.2287-.408-.5606-.216-.96-.4771-1.3819-.895-.422-.4178-.6811-.8186-.9-1.378-.1644-.4234-.3624-1.058-.4171-2.228-.0595-1.2645-.072-1.6442-.079-4.848-.007-3.2037.0053-3.583.0607-4.848.05-1.169.2456-1.805.408-2.2282.216-.5613.4762-.96.895-1.3816.4188-.4217.8184-.6814 1.3783-.9003.423-.1651 1.0575-.3614 2.227-.4171 1.2655-.06 1.6447-.072 4.848-.079 3.2033-.007 3.5835.005 4.8495.0608 1.169.0508 1.8053.2445 2.228.408.5608.216.96.4754 1.3816.895.4217.4194.6816.8176.9005 1.3787.1653.4217.3617 1.056.4169 2.2263.0602 1.2655.0739 1.645.0796 4.848.0058 3.203-.0055 3.5834-.061 4.848-.051 1.17-.245 1.8055-.408 2.2294-.216.5604-.4763.96-.8954 1.3814-.419.4215-.8181.6811-1.3783.9-.4224.1649-1.0577.3617-2.2262.4174-1.2656.0595-1.6448.072-4.8493.079-3.2045.007-3.5825-.006-4.848-.0608M16.953 5.5864A1.44 1.44 0 1 0 18.39 4.144a1.44 1.44 0 0 0-1.437 1.4424M5.8385 12.012c.0067 3.4032 2.7706 6.1557 6.173 6.1493 3.4026-.0065 6.157-2.7701 6.1506-6.1733-.0065-3.4032-2.771-6.1565-6.174-6.1498-3.403.0067-6.156 2.771-6.1496 6.1738M8 12.0077a4 4 0 1 1 4.008 3.9921A3.9996 3.9996 0 0 1 8 12.0077";
export const BRANDS: Record<Brand, Look> = {
  youtube: { name: "YouTube", icon: SiYoutube, color: "#FF0000" },
  "youtube-music": { name: "YouTube Music", icon: SiYoutubemusic, color: "#FF0000" },
  spotify: { name: "Spotify", icon: SiSpotify, color: "#1ED760" },
  "apple-podcasts": { name: "Apple Podcasts", file: "/brands/apple-podcasts.svg" },
  facebook: { name: "Facebook", icon: SiFacebook, color: "#0866FF" },
  instagram: { name: "Instagram" },
  linkedin: { name: "LinkedIn", icon: FaLinkedin, color: "#0A66C2" },
  tiktok: { name: "TikTok", icon: SiTiktok, color: "#000000", mono: true },
  x: { name: "X", icon: SiX, color: "#000000", mono: true },
  threads: { name: "Threads", icon: SiThreads, color: "#000000", mono: true },
  buzzsprout: { name: "Buzzsprout", file: "/brands/buzzsprout.svg" },
  zoom: { name: "Zoom", file: "/brands/zoom.svg" },
  // Restream isn't in Simple Icons: its sign (circle, black) from Restream's own media kit, restre.am/media-kit (22 Nov 2026), unaltered.
  restream: { name: "Restream", file: "/brands/restream.svg" },
  obs: { name: "OBS Studio", icon: SiObsstudio, color: "#302E31", mono: true },
  streamyard: { name: "StreamYard", file: "/brands/streamyard.svg" },
  twitch: { name: "Twitch", icon: SiTwitch, color: "#9146FF" },
  kick: { name: "Kick", icon: SiKick, color: "#53FC18" },
};
/** Brands whose file isn't in /brands/ yet: BrandMark renders nothing for them. */
// A brand listed here shows no mark at all (never letters or a stand-in) until its official file is added.
const MISSING = new Set<Brand>([]);
export const hasBrandMark = (b: Brand) => !MISSING.has(b);

/** onWhite: it sits on a white tile, so a black mark stays black in dark mode too. */
function Mark({ brand, className, onDark, onWhite }: { brand: Brand; className: string; onDark?: boolean; onWhite?: boolean }) {
  const b = BRANDS[brand];
  if (MISSING.has(brand)) return null;
  if (brand === "instagram") {
    return (
      <svg viewBox="0 0 24 24" className={className} aria-hidden>
        <defs><radialGradient id="mv-ig" cx="0.3" cy="1.07" r="1.2"><stop offset="0" stopColor="#FFDD55" /><stop offset="0.1" stopColor="#FFDD55" /><stop offset="0.5" stopColor="#FF543E" /><stop offset="1" stopColor="#C837AB" /></radialGradient></defs>
        <path d={IG} fill="url(#mv-ig)" />
      </svg>
    );
  }
  if (b.file) return <img src={b.file} alt="" className={`${className} object-contain`} draggable={false} />;
  const I = b.icon!;
  return <I className={`${className} ${b.mono ? (onWhite ? "text-black" : onDark ? "text-white" : "text-black dark:text-white") : ""}`} style={b.mono ? undefined : { color: b.color }} aria-hidden />;
}

/**
 * A brand's mark. `tile` sits it on a white rounded square (the same in light and dark mode), the way the
 * lists show a source; bare, it sits inline next to its name. Size it with className (the tile is about 1.6× the mark).
 */
export function BrandMark({ brand, tile = false, className = "h-5 w-5", tileClassName = "h-10 w-10 rounded-xl", onDark, title }: { brand: Brand; tile?: boolean; className?: string; tileClassName?: string; onDark?: boolean; title?: string }) {
  if (MISSING.has(brand)) return null;
  const mark = <Mark brand={brand} className={className} onDark={onDark && !tile} />;
  if (!tile) return <span className="inline-flex shrink-0 items-center justify-center" title={title ?? BRANDS[brand].name} data-brand={brand}>{mark}</span>;
  return <span className={`inline-flex shrink-0 items-center justify-center border border-black/10 bg-white ${tileClassName}`} title={title ?? BRANDS[brand].name} data-brand={brand}><Mark brand={brand} className={className} onWhite /></span>;
}

/** Several marks overlapping, e.g. StreamYard + Restream + OBS in a page header. Missing marks are left out. */
export function BrandStack({ brands, className = "h-5 w-5", tileClassName = "h-9 w-9 rounded-xl" }: { brands: Brand[]; className?: string; tileClassName?: string }): ReactNode {
  const shown = brands.filter(hasBrandMark);
  return (
    <span className="inline-flex shrink-0 items-center" data-testid="brand-stack">
      {shown.map((b, i) => <span key={b} className={i ? "-ml-2.5" : ""} style={{ zIndex: shown.length - i }}><BrandMark brand={b} tile className={className} tileClassName={`${tileClassName} ring-2 ring-white dark:ring-card`} /></span>)}
    </span>
  );
}

/** Several marks side by side on one white tile, for a list row's one-tile icon slot. Missing marks are left out. */
export function BrandGroup({ brands, className = "h-[15px] w-[15px]", tileClassName = "h-10 w-10 rounded-xl" }: { brands: Brand[]; className?: string; tileClassName?: string }): ReactNode {
  const shown = brands.filter(hasBrandMark);
  return (
    <span className={`inline-flex shrink-0 flex-wrap content-center items-center justify-center gap-0.5 border border-black/10 bg-white p-0.5 ${tileClassName}`} title={shown.map((b) => BRANDS[b].name).join(", ")} data-testid="brand-group">
      {shown.map((b) => <Mark key={b} brand={b} className={className} onWhite />)}
    </span>
  );
}
