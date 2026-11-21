# Studio Style fonts (self-hosted)

These are the fonts a creator can pick under Studio → Style. The studio stage, the filmed page (`/room/composite/…`, which is what recordings and live streams carry) and RoomStage load them from here as `/fonts/<slug>.woff2`. They never come from a font CDN.

Rules:

- **OFL only.** Every file here is under the SIL Open Font License 1.1. The full licence for each one is in `licenses/<slug>-OFL.txt`, and it has to stay next to the font.
- **Latin subset, woff2.** Files come from the Fontsource npm packages at the versions below, as published (Google Fonts' own builds). Only the `latin` subset is here, which covers U+0000–00FF, so names like "José" or "Zoë" work.
- **Reserved Font Names.** Merriweather and Playfair Display reserve their names. We serve the files exactly as Fontsource publishes them, unchanged. If we ever subset or edit them ourselves, the edited file has to get a new name.
- **Adding a font:** OFL only. Add the woff2 file and its licence, add a line to the table, and add the name to `ROOM_FONTS` in `client/src/components/RoomStage.tsx` and to Podcasting's Style list.

| Font | File | Licence | Source | Copyright |
|---|---|---|---|---|
| Inter (default and fallback) | `inter.woff2` (variable, 100–900) | OFL 1.1 | `@fontsource-variable/inter@5.3.0` | The Inter Project Authors |
| Montserrat | `montserrat.woff2` (variable) | OFL 1.1 | `@fontsource-variable/montserrat@5.3.0` | The Montserrat Project Authors |
| Oswald | `oswald.woff2` (variable) | OFL 1.1 | `@fontsource-variable/oswald@5.3.0` | The Oswald Project Authors |
| Bebas Neue | `bebas-neue.woff2` (400 only) | OFL 1.1 | `@fontsource/bebas-neue@5.3.0` | The Bebas Neue Project Authors |
| Source Sans 3 | `source-sans-3.woff2` (variable) | OFL 1.1 | `@fontsource-variable/source-sans-3@5.3.1` | Adobe / Google Inc. |
| Merriweather | `merriweather.woff2` (variable) | OFL 1.1, Reserved Font Name | `@fontsource-variable/merriweather@5.3.0` | The Merriweather Project Authors |
| Playfair Display | `playfair-display.woff2` (variable) | OFL 1.1, Reserved Font Name | `@fontsource-variable/playfair-display@5.3.0` | The Playfair Display Project Authors |

**Not hosted:** Roboto Slab is licensed Apache 2.0, not OFL. If a look names it, it falls back to Inter.
