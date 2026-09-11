import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Mic2 } from "lucide-react";
import type { PublicSignup } from "@shared/schema";
import { resolveUploadUrl } from "@/lib/queryClient";
import { AgendaSignupActions } from "@/components/AgendaSignupActions";
import { SocialIconRow, parseSocialAccounts } from "@/components/SocialIcons";
import { formatTimeInZone, formatDateInZone, zoneLabel, onAirWindow, type OnAirSettings } from "@/lib/schedule";

interface Props {
  index: number;
  start: Date;
  end: Date;
  viewZone: string;
  signup?: PublicSignup;
  showDate: boolean;
  onClaim: (index: number) => void;
  onAirSettings?: OnAirSettings;
}

export function SlotCard({ index, start, end, viewZone, signup, showDate, onClaim, onAirSettings }: Props) {
  const isOpen = !signup;
  const onAir = onAirSettings ? onAirWindow(start, onAirSettings) : null;

  return (
    <Card data-testid={`card-slot-${index}`} className="flex flex-col gap-3 p-4 pb-5">
      <div className="flex flex-wrap items-start justify-between gap-x-2 gap-y-1">
        <div className="min-w-0">
          {showDate && (
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground" data-testid={`text-date-${index}`}>
              {formatDateInZone(start, viewZone)}
            </div>
          )}
          <div className="font-mono text-base font-semibold leading-tight sm:text-lg" data-testid={`text-time-${index}`}>
            <span className="whitespace-nowrap">{formatTimeInZone(start, viewZone)}</span>
            <span className="whitespace-nowrap text-muted-foreground"> – {formatTimeInZone(end, viewZone)}</span>
          </div>
          {onAir && signup && (
            <div className="mt-0.5 text-xs text-muted-foreground" data-testid={`text-onair-${index}`}>
              On air {formatTimeInZone(onAir.start, viewZone)}–{formatTimeInZone(onAir.end, viewZone)}
              {onAirSettings!.bufferMinutes > 0 &&
                ` · ${onAirSettings!.bufferMinutes}m ${onAirSettings!.bufferPosition === "before" ? "before" : "after"} for transition`}
            </div>
          )}
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
        <div className="flex flex-1 flex-col gap-2">
          <div className="flex items-center gap-2" data-testid={`text-podcast-${index}`}>
            {signup.photoUrl && (
              <img
                src={resolveUploadUrl(signup.photoUrl)}
                alt={signup.hostName}
                className="h-7 w-7 shrink-0 rounded-full object-cover ring-1 ring-border"
              />
            )}
            <span className="flex items-center gap-2 text-sm font-medium">
              <Mic2 className="h-4 w-4 text-primary" />
              {signup.podcastName}
            </span>
          </div>
          <SocialIconRow accounts={parseSocialAccounts(signup.socialAccounts)} />
          <AgendaSignupActions
            signup={signup}
            shareText={`I'm tuning in to ${signup.hostName} on ${signup.podcastName} — ${formatDateInZone(
              start,
              viewZone
            )}, ${formatTimeInZone(start, viewZone)} ${zoneLabel(viewZone)}, during the MilitaryVoice.ai marathon! ${
              typeof window !== "undefined" ? window.location.href : ""
            }`}
          />
        </div>
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
