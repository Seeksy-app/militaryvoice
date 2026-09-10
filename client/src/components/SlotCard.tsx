import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Globe2, Mic2, Video, Presentation, Image as ImageIcon, Users, HeadphonesIcon } from "lucide-react";
import type { PublicSignup } from "@shared/schema";
import { resolveUploadUrl } from "@/lib/queryClient";
import { formatTimeInZone, formatDateInZone, primeZonesFor, isHiddenGemSlot } from "@/lib/schedule";

interface Props {
  index: number;
  start: Date;
  end: Date;
  viewZone: string;
  signup?: PublicSignup;
  showDate: boolean;
  onClaim: (index: number) => void;
}

export function SlotCard({ index, start, end, viewZone, signup, showDate, onClaim }: Props) {
  const prime = primeZonesFor(start);
  const hiddenGem = isHiddenGemSlot(start);
  const isOpen = !signup;

  return (
    <Card
      data-testid={`card-slot-${index}`}
      className={`flex flex-col gap-3 p-4 ${hiddenGem ? "border-primary/50 ring-1 ring-primary/20" : ""}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          {showDate && (
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground" data-testid={`text-date-${index}`}>
              {formatDateInZone(start, viewZone)}
            </div>
          )}
          <div className="font-mono text-lg font-semibold leading-tight" data-testid={`text-time-${index}`}>
            {formatTimeInZone(start, viewZone)}
            <span className="text-muted-foreground"> – {formatTimeInZone(end, viewZone)}</span>
          </div>
        </div>
        <Badge
          variant={isOpen ? "outline" : "secondary"}
          data-testid={`badge-status-${index}`}
          className={isOpen ? "text-primary border-primary/40" : ""}
        >
          {isOpen ? "Open" : "Booked"}
        </Badge>
      </div>

      {prime.length > 0 && (
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground" data-testid={`text-prime-${index}`}>
          <Globe2 className="h-3.5 w-3.5 shrink-0 text-primary" />
          <span>
            {hiddenGem ? "Prime time overseas: " : "Great time in: "}
            {prime.map((z) => z.label).join(", ")}
          </span>
        </div>
      )}

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
          <div className="flex flex-wrap gap-1.5">
            <Badge variant="outline" className="gap-1 text-xs font-normal">
              <Users className="h-3 w-3" /> {signup.numPeople === 2 ? "2 hosts" : "1 host"}
            </Badge>
            {signup.hasVideoIntro && (
              <Badge variant="outline" className="gap-1 text-xs font-normal">
                <Video className="h-3 w-3" /> Intro
              </Badge>
            )}
            {signup.hasVideoOutro && (
              <Badge variant="outline" className="gap-1 text-xs font-normal">
                <Video className="h-3 w-3" /> Outro
              </Badge>
            )}
            {signup.hasSlides && (
              <Badge variant="outline" className="gap-1 text-xs font-normal">
                <Presentation className="h-3 w-3" /> Slides
              </Badge>
            )}
            {signup.hasImages && (
              <Badge variant="outline" className="gap-1 text-xs font-normal">
                <ImageIcon className="h-3 w-3" /> Images
              </Badge>
            )}
            {signup.needsInterviewer && (
              <Badge className="gap-1 text-xs font-normal bg-primary/15 text-primary hover:bg-primary/15">
                <HeadphonesIcon className="h-3 w-3" /> Needs interviewer
              </Badge>
            )}
          </div>
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
