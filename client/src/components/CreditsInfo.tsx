import { Info } from "lucide-react";
import { Link } from "wouter";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/**
 * The little (i) beside a credit balance or a credit cost (Andrew, 21 Nov: "put a little info
 * mark by credits"). It opens /help/credits, the page of everything that costs a credit, in the
 * same tab. A 24px target so a thumb can hit it; the negative margin keeps the line's height.
 * One per spot, never two in a row.
 */
export function CreditsInfo({ className = "", label }: { className?: string; label?: string }) {
  // With a label: a small text link, for a place where the mark can't sit beside the number.
  if (label) {
    return (
      <Link href="/help/credits" className={`inline-flex min-h-6 items-center gap-1 rounded-full px-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#053877]/40 ${className}`} data-testid="credits-info">
        {label} <Info className="h-3.5 w-3.5" />
      </Link>
    );
  }
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Link
          href="/help/credits"
          aria-label="What uses credits"
          onClick={(e) => e.stopPropagation()}
          className={`-my-1 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full align-middle text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#053877]/40 ${className}`}
          data-testid="credits-info"
        >
          <Info className="h-3.5 w-3.5" />
        </Link>
      </TooltipTrigger>
      <TooltipContent className="text-xs">What uses credits</TooltipContent>
    </Tooltip>
  );
}
