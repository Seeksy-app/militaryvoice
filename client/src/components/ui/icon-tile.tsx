import type { ComponentType, ReactNode } from "react";
import { cn } from "@/lib/utils";
import { icon3dFor, icon3dSrc, type Icon3D } from "@/lib/icons3d";

/** A lucide-react icon (the app's one outline set), or anything shaped like one. */
export type TileIcon = ComponentType<{ className?: string; strokeWidth?: number | string }>;

/** One 3D icon (Fluent 3D, /icons3d/), at a fixed size so nothing shifts while it loads. */
export function Art3D({ name, size = 48, className, alt = "" }: { name: Icon3D; size?: number; className?: string; alt?: string }) {
  return (
    <img
      src={icon3dSrc(name)}
      width={size}
      height={size}
      alt={alt}
      aria-hidden={alt ? undefined : true}
      loading="lazy"
      decoding="async"
      draggable={false}
      className={cn("shrink-0 select-none object-contain", className)}
      style={{ width: size, height: size }}
    />
  );
}

/**
 * The one icon tile used across the app (feature cards, dashboard and help topic cards, empty states, step lists).
 *
 * Since 21 Nov 2026 it shows the 3D version of the icon it's given (Andrew: "update the 3-d icon everywhere"):
 * pass a lucide icon and, when it has a 3D counterpart (lib/icons3d.ts), that's drawn bare in the same 48px space,
 * Clay-style, with no pale tile behind it. `art` names a 3D icon directly. An icon without one (or a spinning
 * Loader2, or `children` such as a platform mark) keeps the pale-blue tile and the navy 2px outline icon.
 *
 * `size="sm"` (40px box) is only for dense rows and menus where 48px won't fit.
 */
export function IconTile({
  icon: Icon,
  art,
  size = "md",
  spin = false,
  onDark = false,
  className,
  iconClassName,
  children,
}: {
  icon?: TileIcon;
  /** A 3D icon by name, for a tile that has no line icon or wants a different 3D one. */
  art?: Icon3D;
  size?: "md" | "sm";
  /** Spin the icon (pass Loader2 while something is working). */
  spin?: boolean;
  /** On a navy section: the 3D icon sits on a soft white tile, since some (the busts) are dark. */
  onDark?: boolean;
  className?: string;
  iconClassName?: string;
  children?: ReactNode;
}) {
  const three = children || spin ? undefined : art ?? (Icon ? icon3dFor(Icon) : undefined);
  const box = size === "sm" ? "h-10 w-10" : "h-12 w-12";
  if (three) {
    return (
      <span aria-hidden="true" className={cn("flex shrink-0 items-center justify-center", box, onDark && "rounded-[12px] bg-white/90 shadow-sm", className)}>
        <Art3D name={three} size={onDark ? (size === "sm" ? 28 : 34) : size === "sm" ? 36 : 44} />
      </span>
    );
  }
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex shrink-0 items-center justify-center rounded-[12px] bg-[#E8EEF8] text-[#053877] dark:bg-white/10 dark:text-white",
        box,
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
