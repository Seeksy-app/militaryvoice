import { useEffect, useId, useMemo, useRef, useState } from "react";
import { MapPin, Plane } from "lucide-react";

/**
 * Where / From / To with suggestions (Andrew, 26 Nov: "need auto complete cities"). The list is local and free:
 * /places/places.json, built from OurAirports (public domain) and GeoNames (CC-BY 4.0), fetched once on first use.
 * Rows: [kind, name, sub, code, rank, lat, lon]; kind c = city, a = airport, m = a metro's "all airports".
 * Free text still works: a landmark on Hotels, a three-letter code on Flights.
 */
export type Place = { kind: "c" | "a" | "m"; name: string; sub: string; code: string; rank: number; us: boolean; words: string[] };
type Row = [string, string, string, string, number, number, number];

let loading: Promise<Place[]> | null = null;
const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const wordsOf = (s: string) => fold(s).split(/[^a-z0-9]+/).filter(Boolean);
function loadPlaces(): Promise<Place[]> {
  loading ??= fetch("/places/places.json")
    .then((r) => (r.ok ? r.json() : []))
    .then((rows: Row[]) => rows.map(([kind, name, sub, code, rank]) => ({ kind: kind as Place["kind"], name, sub, code, rank, us: /United States$|, [A-Z]{2}$/.test(sub) || /, [A-Z]{2}( \(|$)/.test(name), words: [...wordsOf(name), ...wordsOf(sub), ...(code ? [code.toLowerCase()] : [])] })))
    .catch(() => { loading = null; return []; });
  return loading;
}

/** Every typed word must start a word of the place (or be its code). Hotels: cities (US, then world), then airports. Flights: metros, then airports and cities that have one. */
function matches(all: Place[], q: string, mode: "hotel" | "flight"): Place[] {
  const qs = wordsOf(q);
  if (!qs.length || fold(q).trim().length < 2) return [];
  const code = qs.length === 1 && qs[0].length === 3 ? qs[0] : "";
  const hit = all.filter((p) => (mode === "hotel" ? p.kind !== "m" : p.kind !== "c" || !!p.code) && qs.every((w) => p.words.some((x) => x.startsWith(w))));
  const group = (p: Place) => (mode === "hotel" ? (p.kind === "c" ? (p.us ? 0 : 1) : 2) : p.kind === "m" ? 0 : 1);
  const exact = (p: Place) => (code && p.code.toLowerCase() === code ? 0 : 1);
  // "san" should give San Diego before Sankara airport: a name that starts with what was typed comes first in its group.
  const head = fold(q).trim();
  const lead = (p: Place) => (fold(p.name).startsWith(head) ? 0 : 1);
  // A match in the name beats one only in the second line ("wash" → Washington before Seattle, WA).
  const inName = (p: Place) => { const ws = wordsOf(p.name); return qs.every((w) => ws.some((x) => x.startsWith(w))) ? 0 : 1; };
  return hit.sort((a, b) => exact(a) - exact(b) || group(a) - group(b) || inName(a) - inName(b) || lead(a) - lead(b) || b.rank - a.rank).slice(0, 8);
}

/** What a pick puts in the box, as the list names it: "Denver, CO", "Denver International Airport (DEN)", "Washington, DC (all airports)". */
export const placeText = (p: Place) => p.name;
/** The codes a pick searches: one airport, or a metro's airports ("DCA · IAD · BWI"). */
export const placeCodes = (p: Place) => (p.kind === "m" ? p.sub.split(/\s*·\s*/).filter((c) => /^[A-Z]{3}$/.test(c)) : p.code ? [p.code] : []);

export function PlaceInput({ mode, value, onText, onPick, placeholder, aria, testid, className, onLeave }: {
  mode: "hotel" | "flight"; value: string; onText: (v: string) => void; onPick: (p: Place) => void; placeholder: string; aria: string; testid: string; className: string; onLeave?: () => void;
}) {
  const [all, setAll] = useState<Place[]>([]);
  const [open, setOpen] = useState(false);
  const [focused, setFocused] = useState(false);
  const [hi, setHi] = useState(0);
  const id = useId();
  const box = useRef<HTMLDivElement>(null);
  // Only the box being typed in shows its list.
  const list = useMemo(() => (open && focused ? matches(all, value, mode) : []), [all, value, mode, open, focused]);
  useEffect(() => setHi(0), [value]);
  const warm = () => { if (!all.length) void loadPlaces().then(setAll); };
  const pick = (p: Place) => { onPick(p); setOpen(false); };
  return (
    <div ref={box} className="relative min-w-0 flex-1" onBlur={(e) => { if (!box.current?.contains(e.relatedTarget as Node)) { setOpen(false); setFocused(false); onLeave?.(); } }}>
      <input
        role="combobox" aria-label={aria} aria-expanded={list.length > 0} aria-controls={`${id}-list`} aria-autocomplete="list"
        aria-activedescendant={list.length ? `${id}-${hi}` : undefined} autoComplete="off" spellCheck={false}
        value={value} placeholder={placeholder} className={className} data-testid={testid}
        onFocus={() => { setFocused(true); warm(); }}
        onChange={(e) => { warm(); onText(e.target.value); setOpen(true); }}
        onKeyDown={(e) => {
          if (!list.length) return;
          if (e.key === "ArrowDown") { e.preventDefault(); setHi((hi + 1) % list.length); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setHi((hi - 1 + list.length) % list.length); }
          else if (e.key === "Enter") { e.preventDefault(); pick(list[hi]); }
          else if (e.key === "Escape") setOpen(false);
        }}
      />
      {list.length > 0 && (
        <ul id={`${id}-list`} role="listbox" className="absolute -left-[40px] -right-[14px] top-[calc(100%+14px)] z-40 max-h-[360px] sm:right-auto sm:w-[460px] overflow-auto rounded-xl border border-[#dfe4ec] bg-white py-1.5 shadow-[0_18px_40px_-14px_rgba(11,27,51,0.35)] dark:border-white/10 dark:bg-card" data-testid={`${testid}-list`}>
          {list.map((p, k) => {
            const Icon = p.kind === "c" ? MapPin : Plane;
            return (
              <li key={`${p.kind}${p.name}${p.code}`} id={`${id}-${k}`} role="option" aria-selected={k === hi}
                onMouseDown={(e) => e.preventDefault()} onMouseEnter={() => setHi(k)} onClick={() => pick(p)}
                className={`flex cursor-pointer items-center gap-3 px-3.5 py-2.5 ${k === hi ? "bg-[#eef4ff] dark:bg-white/10" : ""}`}>
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#eef2f8] text-[#0b3a78] dark:bg-white/10 dark:text-white"><Icon className={`h-[18px] w-[18px] ${p.kind === "c" ? "" : "-rotate-45"}`} /></span>
                <span className="min-w-0 flex-1 leading-tight">
                  <span className="line-clamp-2 block text-[15.5px] font-bold text-[#0b1b33] dark:text-white">{p.name}</span>
                  <span className="block truncate text-[13px] text-[#5b6678] dark:text-white/60">{p.sub}</span>
                </span>
              </li>
            );
          })}
          <li role="presentation" className="px-3.5 pb-1 pt-1.5 text-[11px] text-[#8a93a3] dark:text-white/40">Cities: GeoNames (CC BY 4.0). Airports: OurAirports.</li>
        </ul>
      )}
    </div>
  );
}
