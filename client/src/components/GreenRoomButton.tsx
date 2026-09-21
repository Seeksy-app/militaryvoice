import { Headphones } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * The studio, drawn the same way everywhere.
 *
 * It was an amber card on the dashboard, a blue pill on event settings and a
 * bare amber pill on the studio's own door — three drawings of one door. One
 * icon (headphones on amber) and one pill, so a podcaster who has seen it
 * once knows it anywhere.
 */
export function StudioIcon({ className = "h-9 w-9" }: { className?: string }) {
  return (
    <span className={`flex shrink-0 items-center justify-center rounded-xl bg-[#F0A71F] text-[#1a1200] ${className}`} aria-hidden="true">
      <Headphones className="h-[55%] w-[55%]" />
    </span>
  );
}

export function GreenRoomButton({
  href,
  label = "Enter the green room",
  onClick,
  type = "button",
  disabled = false,
  size = "default",
  testId = "button-green-room",
}: {
  href?: string;
  label?: string;
  onClick?: () => void;
  type?: "button" | "submit";
  disabled?: boolean;
  size?: "default" | "sm";
  testId?: string;
}) {
  const btn = (
    <Button
      type={type}
      size={size}
      disabled={disabled}
      onClick={onClick}
      className="gap-2 rounded-full bg-[#F0A71F] font-semibold text-[#1a1200] hover:bg-[#f5b944]"
      data-testid={testId}
    >
      <Headphones className="h-4 w-4" /> {label}
    </Button>
  );
  return href ? (
    <a href={href} target="_blank" rel="noreferrer">
      {btn}
    </a>
  ) : (
    btn
  );
}
