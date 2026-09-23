import { X } from "lucide-react";
import { Button } from "@/components/ui/button";

// The filters a brand manager actually reaches for, in three groups the way
// they think about them: the creator, what the creator does, and who follows.
// Every one maps to a real Influencers Club filter on the server (and anything
// the server doesn't know is dropped there), so nothing here is decoration.

export type Filters = {
  location?: string;
  gender?: "" | "male" | "female";
  engagementMin?: string;
  lastPost?: "" | "90" | "365";
  verifiedOnly?: boolean;
  brandDeals?: boolean;
  hasPodcast?: boolean;
  excludePrivate?: boolean;
  keywordsInBio?: string;
  excludeKeywords?: string;
  hashtags?: string;
  audienceCountry?: string;
  audienceCountryMin?: string;
  audienceGender?: "" | "male" | "female";
  audienceGenderMin?: string;
  credibility?: "" | "normal" | "good" | "high" | "best";
};

const COUNTRIES = ["United States", "Canada", "United Kingdom", "Australia", "Germany", "Japan", "South Korea", "Philippines", "Italy", "Spain", "Mexico", "Poland"];

/** The chips above the results: one per filter in force, each removable. */
export function activeFilters(f: Filters): { key: keyof Filters | "audienceCountryMin" | "audienceGenderMin"; label: string; clear: Partial<Filters> }[] {
  const out: { key: keyof Filters; label: string; clear: Partial<Filters> }[] = [];
  if (f.location) out.push({ key: "location", label: `Based in ${f.location}`, clear: { location: "" } });
  if (f.gender) out.push({ key: "gender", label: f.gender === "female" ? "Women creators" : "Men creators", clear: { gender: "" } });
  if (f.engagementMin && Number(f.engagementMin) > 0) out.push({ key: "engagementMin", label: `Engagement ${f.engagementMin}%+`, clear: { engagementMin: "" } });
  if (f.lastPost) out.push({ key: "lastPost", label: f.lastPost === "90" ? "Posted in 90 days" : "Posted this year", clear: { lastPost: "" } });
  if (f.verifiedOnly) out.push({ key: "verifiedOnly", label: "Verified accounts", clear: { verifiedOnly: false } });
  if (f.brandDeals) out.push({ key: "brandDeals", label: "Has done brand deals", clear: { brandDeals: false } });
  if (f.hasPodcast) out.push({ key: "hasPodcast", label: "Has a podcast", clear: { hasPodcast: false } });
  if (f.excludePrivate) out.push({ key: "excludePrivate", label: "Public profiles only", clear: { excludePrivate: false } });
  if (f.keywordsInBio?.trim()) out.push({ key: "keywordsInBio", label: `Bio: ${f.keywordsInBio.split(",").map((w) => w.trim()).filter(Boolean).join(" or ")}`, clear: { keywordsInBio: "" } });
  if (f.excludeKeywords?.trim()) out.push({ key: "excludeKeywords", label: `Bio not: ${f.excludeKeywords}`, clear: { excludeKeywords: "" } });
  if (f.hashtags?.trim()) out.push({ key: "hashtags", label: `#${f.hashtags.split(",").map((w) => w.trim().replace(/^#/, "")).filter(Boolean).join(" #")}`, clear: { hashtags: "" } });
  if (f.audienceCountry) out.push({ key: "audienceCountry", label: `Audience ${f.audienceCountryMin || 30}%+ ${f.audienceCountry}`, clear: { audienceCountry: "", audienceCountryMin: "" } });
  if (f.audienceGender) out.push({ key: "audienceGender", label: `Audience ${f.audienceGenderMin || 50}%+ ${f.audienceGender === "female" ? "women" : "men"}`, clear: { audienceGender: "", audienceGenderMin: "" } });
  if (f.credibility) out.push({ key: "credibility", label: `Audience quality ${f.credibility}+`, clear: { credibility: "" } });
  return out;
}

/** What the server wants: the booleans as booleans, empty strings left out. */
export function filtersForServer(f: Filters): Record<string, unknown> {
  return Object.fromEntries(Object.entries(f).filter(([, v]) => v !== "" && v !== false && v != null));
}

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="flex flex-col gap-1.5 text-sm">
      <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</span>
      {children}
      {hint && <span className="text-[11px] text-muted-foreground">{hint}</span>}
    </label>
  );
}

const control = "h-10 w-full rounded-xl border border-border bg-background px-3 text-sm outline-none focus:border-[#053877]/50 focus:ring-2 focus:ring-[#053877]/15";

function Toggle({ on, onChange, label, sub }: { on: boolean; onChange: (v: boolean) => void; label: string; sub?: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} onClick={() => onChange(!on)} className={`flex items-center justify-between gap-3 rounded-xl border px-3 py-2.5 text-left text-sm transition-colors ${on ? "border-[#053877] bg-[#053877]/[0.06]" : "border-border hover:border-[#053877]/30"}`}>
      <span><span className="block font-medium">{label}</span>{sub && <span className="block text-xs text-muted-foreground">{sub}</span>}</span>
      <span className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${on ? "bg-[#053877]" : "bg-muted-foreground/25"}`}>
        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${on ? "left-[18px]" : "left-0.5"}`} />
      </span>
    </button>
  );
}

export function FiltersPanel({ value, onChange, onApply, onClose, platform }: { value: Filters; onChange: (f: Filters) => void; onApply: () => void; onClose: () => void; platform: string }) {
  const set = (patch: Partial<Filters>) => onChange({ ...value, ...patch });
  const count = activeFilters(value).length;
  return (
    <div className="rounded-3xl border border-border bg-card p-5 shadow-xl sm:p-6" data-testid="discover-filters-panel">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold tracking-tight">All filters{count ? <span className="ml-2 rounded-full bg-[#053877] px-2 py-0.5 text-xs text-white">{count}</span> : null}</h3>
        <button type="button" onClick={onClose} className="rounded-full p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="Close filters"><X className="h-5 w-5" /></button>
      </div>

      <div className="mt-5 grid gap-8 lg:grid-cols-3">
        <section className="flex flex-col gap-4">
          <h4 className="text-xs font-semibold uppercase tracking-[0.16em] text-[#053877] dark:text-[#8fb5e8]">The creator</h4>
          <Field label="Based in">
            <select className={control} value={value.location ?? ""} onChange={(e) => set({ location: e.target.value })}>
              <option value="">Anywhere</option>
              {COUNTRIES.map((c) => <option key={c}>{c}</option>)}
            </select>
          </Field>
          <Field label="Gender">
            <select className={control} value={value.gender ?? ""} onChange={(e) => set({ gender: e.target.value as Filters["gender"] })}>
              <option value="">Any</option>
              <option value="female">Women</option>
              <option value="male">Men</option>
            </select>
          </Field>
          <Field label="Keywords in bio" hint="Any of them. Separate with commas.">
            <input className={control} value={value.keywordsInBio ?? ""} onChange={(e) => set({ keywordsInBio: e.target.value })} placeholder="army wife, milso, veteran owned" />
          </Field>
          <Field label="Not in bio">
            <input className={control} value={value.excludeKeywords ?? ""} onChange={(e) => set({ excludeKeywords: e.target.value })} placeholder="giveaway, promo" />
          </Field>
          <Toggle on={!!value.verifiedOnly} onChange={(v) => set({ verifiedOnly: v })} label="Verified accounts only" sub="The platform's blue check" />
        </section>

        <section className="flex flex-col gap-4">
          <h4 className="text-xs font-semibold uppercase tracking-[0.16em] text-[#053877] dark:text-[#8fb5e8]">Their content</h4>
          <Field label="Engagement rate, at least">
            <select className={control} value={value.engagementMin ?? ""} onChange={(e) => set({ engagementMin: e.target.value })}>
              <option value="">Any</option>
              {["1", "2", "3", "5", "8"].map((v) => <option key={v} value={v}>{v}%</option>)}
            </select>
          </Field>
          <Field label="Last post">
            <select className={control} value={value.lastPost ?? ""} onChange={(e) => set({ lastPost: e.target.value as Filters["lastPost"] })}>
              <option value="">Any time</option>
              <option value="90">In the last 90 days</option>
              <option value="365">In the last year</option>
            </select>
          </Field>
          <Field label="Hashtags they use">
            <input className={control} value={value.hashtags ?? ""} onChange={(e) => set({ hashtags: e.target.value })} placeholder="#militarylife, #veteranowned" />
          </Field>
          <Toggle on={!!value.brandDeals} onChange={(v) => set({ brandDeals: v })} label="Has done brand deals" sub="Sponsored posts on record" />
          <Toggle on={!!value.hasPodcast} onChange={(v) => set({ hasPodcast: v })} label="Has a podcast" sub="A show linked from their profile" />
          {platform === "instagram" && <Toggle on={!!value.excludePrivate} onChange={(v) => set({ excludePrivate: v })} label="Public profiles only" />}
        </section>

        <section className="flex flex-col gap-4">
          <h4 className="text-xs font-semibold uppercase tracking-[0.16em] text-[#053877] dark:text-[#8fb5e8]">Who follows them</h4>
          <Field label="Audience in">
            <div className="grid grid-cols-[1fr_6rem] gap-2">
              <select className={control} value={value.audienceCountry ?? ""} onChange={(e) => set({ audienceCountry: e.target.value })}>
                <option value="">Anywhere</option>
                {COUNTRIES.map((c) => <option key={c}>{c}</option>)}
              </select>
              <select className={control} value={value.audienceCountryMin ?? "30"} onChange={(e) => set({ audienceCountryMin: e.target.value })} disabled={!value.audienceCountry} aria-label="At least">
                {["20", "30", "50", "70"].map((v) => <option key={v} value={v}>{v}%+</option>)}
              </select>
            </div>
          </Field>
          <Field label="Audience gender">
            <div className="grid grid-cols-[1fr_6rem] gap-2">
              <select className={control} value={value.audienceGender ?? ""} onChange={(e) => set({ audienceGender: e.target.value as Filters["audienceGender"] })}>
                <option value="">Any</option>
                <option value="female">Mostly women</option>
                <option value="male">Mostly men</option>
              </select>
              <select className={control} value={value.audienceGenderMin ?? "50"} onChange={(e) => set({ audienceGenderMin: e.target.value })} disabled={!value.audienceGender} aria-label="At least">
                {["50", "60", "70", "80"].map((v) => <option key={v} value={v}>{v}%+</option>)}
              </select>
            </div>
          </Field>
          <Field label="Audience quality" hint="How much of the audience is real, active people.">
            <select className={control} value={value.credibility ?? ""} onChange={(e) => set({ credibility: e.target.value as Filters["credibility"] })}>
              <option value="">Any</option>
              <option value="normal">Normal or better</option>
              <option value="good">Good or better</option>
              <option value="high">High or better</option>
              <option value="best">Best only</option>
            </select>
          </Field>
        </section>
      </div>

      <div className="mt-6 flex flex-wrap items-center justify-end gap-2 border-t border-border pt-4">
        {count > 0 && <Button variant="ghost" className="rounded-full" onClick={() => onChange({})}>Clear all</Button>}
        <Button className="rounded-full bg-[#053877] px-6 font-semibold text-white hover:bg-[#0a4a99]" onClick={onApply} data-testid="discover-filters-apply">Show creators</Button>
      </div>
    </div>
  );
}

export function FilterChips({ value, onChange }: { value: Filters; onChange: (f: Filters) => void }) {
  const chips = activeFilters(value);
  if (!chips.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {chips.map((c) => (
        <span key={c.key} className="inline-flex items-center gap-1 rounded-full border border-[#053877]/25 bg-[#053877]/[0.06] py-1 pl-3 pr-1.5 text-xs font-medium text-[#053877] dark:text-[#8fb5e8]">
          {c.label}
          <button type="button" onClick={() => onChange({ ...value, ...c.clear })} className="rounded-full p-0.5 hover:bg-[#053877]/10" aria-label={`Remove ${c.label}`}><X className="h-3 w-3" /></button>
        </span>
      ))}
      <button type="button" onClick={() => onChange({})} className="ml-1 text-xs font-medium text-muted-foreground underline underline-offset-2 hover:text-foreground">Clear all</button>
    </div>
  );
}
