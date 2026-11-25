import type { SelectHTMLAttributes } from "react";
import { ChevronDown } from "lucide-react";

/** Every select in the Studio (Andrew, 24 Nov: "I hate when that arrow is all the way over to the right"). The native
 *  arrow is hidden and our own chevron sits about 12px in from the right edge; the text stops before it. `wrap` takes
 *  the layout classes (margin, flex-1, w-full); `className` the look of the box itself. */
export function Select({ wrap = "", small, className = "", children, ...rest }: SelectHTMLAttributes<HTMLSelectElement> & { wrap?: string; small?: boolean }) {
  return (
    <span className={`relative inline-flex min-w-0 ${wrap}`}>
      <select {...rest} className={`w-full min-w-0 cursor-pointer appearance-none truncate ${className} ${small ? "pr-6" : "pr-9"}`}>{children}</select>
      <ChevronDown aria-hidden className={`pointer-events-none absolute top-1/2 -translate-y-1/2 text-[#667085] ${small ? "right-1.5 h-3 w-3" : "right-3 h-4 w-4"}`} />
    </span>
  );
}
