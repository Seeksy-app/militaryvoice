import type { PublicSignup } from "@shared/schema";

export type CardSponsor = NonNullable<PublicSignup["sponsor"]>;

/** The sponsor's link, counted: where the click came from rides along. */
export function sponsorHref(sponsor: CardSponsor, source: string): string | undefined {
  return sponsor.url ? `/go/sponsor/${sponsor.id}?src=${source}` : undefined;
}

/**
 * The sponsor's band across the top of a card. Navy, with a hairline of gold
 * along the top and the logo as the only bright thing on it, so the sponsor
 * reads as part of the card's design rather than a sticker on it.
 * Clicking it goes to the sponsor through the counted link. Every card this
 * sits on is narrow, so the line and the logo are always stacked, centred.
 */
export function SponsorRibbon({ sponsor, source, size = "md", testId }: { sponsor: CardSponsor; source: string; size?: "sm" | "md"; testId?: string }) {
  const href = sponsorHref(sponsor, source);
  const Tagish = href ? "a" : "div";
  const sm = size === "sm";
  return (
    <Tagish
      {...(href ? { href, target: "_blank", rel: "noreferrer" } : {})}
      className={`group/sp relative block overflow-hidden bg-[#04102b] text-white ${href ? "transition-colors hover:bg-[#071a3f]" : ""}`}
      data-testid={testId}
      title={`This segment is sponsored by ${sponsor.name}`}
    >
      <span aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-[3px] bg-gradient-to-r from-[#F0A71F]/0 via-[#F0A71F] to-[#F0A71F]/0" />
      <span aria-hidden="true" className="pointer-events-none absolute -right-8 -top-8 h-24 w-24 rounded-full bg-[#F0A71F]/10 blur-2xl" />
      <span className={`relative flex flex-col items-center text-center ${sm ? "gap-1.5 px-3 pb-3 pt-3.5" : "gap-2 px-4 pb-3.5 pt-4"}`}>
        <span className={`whitespace-nowrap font-semibold uppercase tracking-[0.22em] text-[#F0A71F] ${sm ? "text-[9px]" : "text-[10px]"}`}>
          This segment is sponsored by
        </span>
        {sponsor.logoUrl ? (
          <img
            src={sponsor.logoUrl}
            alt={sponsor.name}
            className={`shrink-0 object-contain drop-shadow-[0_1px_8px_rgba(240,167,31,0.25)] transition-transform group-hover/sp:scale-[1.03] ${sm ? "h-7 max-w-[9rem]" : "h-8 max-w-[10rem]"}`}
          />
        ) : (
          <span className="text-base font-bold tracking-tight">{sponsor.name}</span>
        )}
      </span>
    </Tagish>
  );
}
