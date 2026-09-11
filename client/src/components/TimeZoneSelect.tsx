import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SPOTLIGHT_ZONES, US_ZONES, zoneLabel } from "@/lib/schedule";
import { Button } from "@/components/ui/button";
import { Locate } from "lucide-react";

interface Props {
  value: string;
  onChange: (zone: string) => void;
  onDetect: () => void;
  localZone: string;
  /** "dark" for use on navy hero bands. */
  variant?: "light" | "dark";
}

export function TimeZoneSelect({ value, onChange, onDetect, localZone, variant = "light" }: Props) {
  const dark = variant === "dark";
  const isCustom = !SPOTLIGHT_ZONES.some((z) => z.id === value) && !US_ZONES.some((z) => z.id === value) && value !== "UTC";

  return (
    <div className="flex items-center gap-2">
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger
          className={`w-[220px] ${dark ? "border-white/30 bg-white/10 text-white backdrop-blur hover:bg-white/15 [&>svg]:text-white/70" : ""}`}
          data-testid="select-timezone"
        >
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
      <Button
        variant="outline"
        size="icon"
        onClick={onDetect}
        aria-label="Use my detected time zone"
        title="Use my time zone"
        className={dark ? "border-white/30 bg-white/10 text-white hover:bg-white/15 hover:text-white" : ""}
        data-testid="button-detect-timezone"
      >
        <Locate className="h-4 w-4" />
      </Button>
    </div>
  );
}
