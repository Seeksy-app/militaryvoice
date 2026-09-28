import { useEffect } from "react";
import { FONTS, type BioFont } from "@shared/bio";

/** Loads the page's typeface from Google Fonts, once, when it isn't the site's own. */
export function useBioFont(font: BioFont) {
  useEffect(() => {
    const g = FONTS[font]?.google;
    if (!g || typeof document === "undefined") return;
    const id = `gf-${font}`;
    if (document.getElementById(id)) return;
    const l = document.createElement("link");
    l.id = id;
    l.rel = "stylesheet";
    l.href = `https://fonts.googleapis.com/css2?family=${g}&display=swap`;
    document.head.appendChild(l);
  }, [font]);
}
