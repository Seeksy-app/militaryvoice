import type { ComponentType, ReactNode } from "react";
import { cn } from "@/lib/utils";

/** A lucide-react icon (the app's one outline set), or anything shaped like one. */
export type TileIcon = ComponentType<{ className?: string; strokeWidth?: number | string }>;

/**
 * The one icon tile used across the app (feature cards, dashboard and help
 * topic cards, empty states, step lists): a 48px pale-blue rounded square
 * (12px corners) holding a 28px navy outline icon at a 2px stroke. No fill
 * colours, gradients, borders or shadows. Pass the icon component, not an
 * element; `children` is only for a glyph that isn't a lucide icon (a
 * platform mark), sized by the caller.
 *
 * `size="sm"` (40px box, 22px icon) is only for dense rows and menus where
 * 48px won't fit. Use it sparingly.
 */
export function IconTile({
  icon: Icon,
  size = "md",
  spin = false,
  className,
  iconClassName,
  children,
}: {
  icon?: TileIcon;
  size?: "md" | "sm";
  /** Spin the icon (pass Loader2 while something is working). */
  spin?: boolean;
  className?: string;
  iconClassName?: string;
  children?: ReactNode;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex shrink-0 items-center justify-center rounded-[12px] bg-[#E8EEF8] text-[#053877] dark:bg-white/10 dark:text-white",
        size === "sm" ? "h-10 w-10" : "h-12 w-12",
        className,
      )}
    >
      {children ??
        (Icon && (
          <Icon
            strokeWidth={2}
            className={cn(size === "sm" ? "h-[22px] w-[22px]" : "h-7 w-7", spin && "animate-spin", iconClassName)}
          />
        ))}
    </span>
  );
}
