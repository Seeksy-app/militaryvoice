import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SPOTLIGHT_ZONES, US_ZONES, zoneLabel } from "@/lib/schedule";
import { Button } from "@/components/ui/button";
import { Locate } from "lucide-react";

interface Props {
  value: string;
  onChange: (zone: string) => void;
  onDetect: () => void;
  localZone: string;
}

export function TimeZoneSelect({ value, onChange, onDetect, localZone }: Props) {
  const isCustom = !SPOTLIGHT_ZONES.some((z) => z.id === value) && !US_ZONES.some((z) => z.id === value) && value !== "UTC";

  return (
    <div className="flex items-center gap-2">
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="w-[220px]" data-testid="select-timezone">
          <SelectValue placeholder="Choose a time zone">{zoneLabel(value)}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectLabel>Your time zone</SelectLabel>
            <SelectItem value={localZone}>{zoneLabel(localZone)} (detected)</SelectItem>
          </SelectGroup>
          <SelectGroup>
            <SelectLabel>Global / military hubs</SelectLabel>
            {SPOTLIGHT_ZONES.filter((z) => z.id !== localZone).map((z) => (
              <SelectItem key={z.id} value={z.id}>
                {z.label}
              </SelectItem>
            ))}
          </SelectGroup>
          <SelectGroup>
            <SelectLabel>US zones</SelectLabel>
            {US_ZONES.filter((z) => z.id !== localZone).map((z) => (
              <SelectItem key={z.id} value={z.id}>
                {z.label}
              </SelectItem>
            ))}
          </SelectGroup>
          <SelectGroup>
            <SelectItem value="UTC">UTC</SelectItem>
          </SelectGroup>
          {isCustom && (
            <SelectGroup>
              <SelectItem value={value}>{zoneLabel(value)}</SelectItem>
            </SelectGroup>
          )}
        </SelectContent>
      </Select>
      <Button variant="outline" size="icon" onClick={onDetect} aria-label="Use my detected time zone" data-testid="button-detect-timezone">
        <Locate className="h-4 w-4" />
      </Button>
    </div>
  );
}
