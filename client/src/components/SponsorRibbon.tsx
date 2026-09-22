import { Tag } from "lucide-react";
import type { PublicSignup } from "@shared/schema";

export type CardSponsor = NonNullable<PublicSignup["sponsor"]>;

/** The sponsor's link, counted: where the click came from rides along. */
export function sponsorHref(sponsor: CardSponsor, source: string): string | undefined {
  return sponsor.url ? `/go/sponsor/${sponsor.id}?src=${source}` : undefined;
}

/**
 * The ribbon across a sponsored card: "This segment is sponsored by" and the
 * sponsor's logo, on the amber band the site uses for what matters. The same
 * band on the homepage and the agenda, so a sponsor sees one thing everywhere.
 * Clicking it goes to the sponsor through the counted link.
 */
export function SponsorRibbon({ sponsor, source, size = "md", testId }: { sponsor: CardSponsor; source: string; size?: "sm" | "md"; testId?: string }) {
  const href = sponsorHref(sponsor, source);
  const Tagish = href ? "a" : "div";
  const sm = size === "sm";
  return (
    <Tagish
      {...(href ? { href, target: "_blank", rel: "noreferrer" } : {})}
      className={`relative flex items-center gap-2 overflow-hidden bg-gradient-to-r from-[#F0A71F] via-[#f5b53a] to-[#F0A71F] text-[#1a1200] ${sm ? "px-3 py-1 text-[10px]" : "px-3 py-1.5 text-[11px]"} ${href ? "transition-[filter] hover:brightness-105" : ""}`}
      data-testid={testId}
      title={`Sponsored by ${sponsor.name}`}
    >
      <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-0 w-1.5 bg-[#1a1200]/15" />
      <Tag className={`${sm ? "h-3 w-3" : "h-3.5 w-3.5"} shrink-0`} />
      <span className="shrink-0 font-bold uppercase tracking-[0.14em]">This segment is sponsored by</span>
      {sponsor.logoUrl ? (
        <span className={`ml-auto flex shrink-0 items-center rounded-md bg-[#04102b] ${sm ? "px-1.5 py-0.5" : "px-2 py-0.5"}`}>
          <img src={sponsor.logoUrl} alt={sponsor.name} className={`${sm ? "h-4 max-w-[5.5rem]" : "h-5 max-w-[7rem]"} object-contain`} />
        </span>
      ) : (
        <span className="ml-auto shrink-0 font-extrabold">{sponsor.name}</span>
      )}
    </Tagish>
  );
}
