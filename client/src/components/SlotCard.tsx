import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Mic2 } from "lucide-react";
import type { PublicSignup } from "@shared/schema";
import { resolveUploadUrl } from "@/lib/queryClient";
import { formatTimeInZone, formatDateInZone, type OnAirSettings } from "@/lib/schedule";

interface Props {
  index: number;
  start: Date;
  end: Date;
  viewZone: string;
  signup?: PublicSignup;
  showDate: boolean;
  onClaim: (index: number) => void;
  /** The lineup is closed: a free slot is shown, not offered. */
  closed?: boolean;
  onAirSettings?: OnAirSettings;
}

export function SlotCard({ index, start, end, viewZone, signup, showDate, onClaim, onAirSettings, closed }: Props) {
  const isOpen = !signup;

  return (
    <Card data-testid={`card-slot-${index}`} className="flex flex-col gap-3 p-4 pb-5">
      <div className="flex flex-wrap items-start justify-between gap-x-2 gap-y-1">
        <div className="min-w-0">
          {showDate && (
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground" data-testid={`text-date-${index}`}>
              {formatDateInZone(start, viewZone)}
            </div>
          )}
          <div className="tabular-nums text-base font-semibold leading-tight sm:text-lg" data-testid={`text-time-${index}`}>
            <span className="whitespace-nowrap">{formatTimeInZone(start, viewZone)}</span>
            <span className="whitespace-nowrap text-muted-foreground"> – {formatTimeInZone(end, viewZone)}</span>
          </div>
        </div>
        <Badge
          variant={isOpen ? "outline" : "secondary"}
          data-testid={`badge-status-${index}`}
          className={`shrink-0 ${isOpen ? "text-primary border-primary/40" : ""}`}
        >
          {isOpen ? "Open" : "Booked"}
        </Badge>
      </div>

      {signup ? (
        <div className="mt-auto flex items-center gap-2.5 rounded-lg bg-muted/60 px-2.5 py-2" data-testid={`text-podcast-${index}`}>
          {signup.photoUrl ? (
            <img
              src={resolveUploadUrl(signup.photoUrl)}
              alt={signup.hostName}
              className="h-9 w-9 shrink-0 rounded-full object-cover ring-2 ring-[#F0A71F]/50"
            />
          ) : (
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground">
              <Mic2 className="h-4 w-4" />
            </div>
          )}
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold leading-tight">{signup.podcastName}</div>
            <div className="truncate text-xs text-muted-foreground">{signup.hostName}</div>
          </div>
        </div>
      ) : closed ? (
        <p className="mt-auto rounded-md bg-muted px-3 py-2 text-center text-xs font-semibold text-muted-foreground" data-testid={`text-slot-closed-${index}`}>
          Lineup closed
        </p>
      ) : (
        <Button
          onClick={() => onClaim(index)}
          size="sm"
          className="mt-auto"
          data-testid={`button-claim-${index}`}
        >
          Claim this slot
        </Button>
      )}
    </Card>
  );
}
