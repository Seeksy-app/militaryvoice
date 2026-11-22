import { useRef, useState, type ReactNode } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

/**
 * A hover-over that also works by touch and keyboard: a mouse shows it on hover, a tap toggles it
 * (iPad, phone), Tab focus shows it, Escape or a tap elsewhere closes it. A plain tooltip never opens on touch.
 */
export function InfoTip({ children, tip, label, testId, className = "rounded-xl" }: { children: ReactNode; tip: ReactNode; /** What a screen reader hears for the trigger. */ label: string; testId?: string; className?: string }) {
  const [open, setOpen] = useState(false);
  const pointer = useRef<string>("");
  const timer = useRef<number>();
  const hoverIn = (e: React.PointerEvent) => { if (e.pointerType !== "mouse") return; window.clearTimeout(timer.current); setOpen(true); };
  const hoverOut = (e: React.PointerEvent) => { if (e.pointerType !== "mouse") return; timer.current = window.setTimeout(() => setOpen(false), 150); };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={label}
          data-testid={testId}
          onPointerDown={(e) => { pointer.current = e.pointerType; }}
          onPointerEnter={hoverIn}
          onPointerLeave={hoverOut}
          onFocus={(e) => { if (e.currentTarget.matches(":focus-visible")) setOpen(true); }}
          onBlur={() => setOpen(false)}
          // A mouse click after hovering keeps it open; a tap or Enter toggles it.
          onClick={(e) => { e.preventDefault(); const mouse = pointer.current === "mouse"; pointer.current = ""; setOpen((o) => (mouse ? true : !o)); }}
          className={`inline-flex cursor-help focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#053877] focus-visible:ring-offset-2 dark:focus-visible:ring-[#9cc3ff] ${className}`}
        >
          {children}
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="start"
        sideOffset={8}
        collisionPadding={16}
        role="tooltip"
        onOpenAutoFocus={(e) => e.preventDefault()}
        onCloseAutoFocus={(e) => e.preventDefault()}
        onPointerEnter={hoverIn}
        onPointerLeave={hoverOut}
        className="w-[300px] max-w-[calc(100vw-32px)] rounded-xl px-4 py-3 text-[13px] leading-snug text-foreground [&_p]:[text-wrap:pretty]"
      >
        {tip}
      </PopoverContent>
    </Popover>
  );
}
