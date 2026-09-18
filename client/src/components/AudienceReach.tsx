import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Users, Eye, Radio, Heart } from "lucide-react";

// The lineup's own reach, on the sponsor pages.
//
// A sponsor's first question is "who am I reaching", and until now both pages
// answered it with hours and slot counts — production facts, not audience
// facts. These figures come from the podcasters' own connected accounts.
//
// Two rules govern how it's written. Every number is stated as what it
// actually is: a combined following is a sum across channels, not a count of
// people, and saying so out loud is what makes the rest of the page credible
// to someone whose job is discounting inflated decks. And the section removes
// itself entirely when there's no snapshot — a stats band reading zero is
// worse for a pitch than no stats band.

export interface AudienceSnapshot {
  generatedAt: string;
  windowDays: number;
  shows: number;
  showsTotal: number;
  channels: number;
  followers: number;
  reach: number;
  impressions: number;
  engagements: number;
  byPlatform: { platform: string; channels: number; followers: number }[];
  dropped: number;
  unavailable: number;
}

const PLATFORM_LABEL: Record<string, string> = {
  instagram: "Instagram",
  youtube: "YouTube",
  facebook: "Facebook",
  x: "X",
  linkedin: "LinkedIn",
  threads: "Threads",
  tiktok: "TikTok",
};

function compact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 10_000) return `${Math.round(n / 1000)}K`;
  return n.toLocaleString("en-US");
}

export function useAudienceSnapshot() {
  return useQuery<AudienceSnapshot | null>({
    queryKey: ["/api/audience/summary"],
    queryFn: async () => (await apiRequest("GET", "/api/audience/summary")).json(),
    staleTime: 10 * 60 * 1000,
  });
}

/**
 * @param tone  `dark` sits on the navy band, `light` on the page ground.
 */
export function AudienceReach({ tone = "light" }: { tone?: "light" | "dark" }) {
  const { data } = useAudienceSnapshot();
  if (!data || data.followers <= 0) return null;

  const dark = tone === "dark";
  const gold = "#F0A71F";
  const headline = { fontFamily: "'General Sans', 'Inter', sans-serif" } as const;
  const asOf = new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric" }).format(
    new Date(data.generatedAt),
  );
  const months = Math.round(data.windowDays / 30);

  const figures = [
    {
      icon: Users,
      n: compact(data.followers),
      label: "combined following",
      note: `across ${data.channels} connected channels`,
    },
    {
      icon: Eye,
      n: compact(data.impressions),
      label: "impressions",
      note: `in the last ${months} months`,
    },
    {
      icon: Radio,
      n: compact(data.reach),
      label: "people reached",
      note: "unique accounts, same period",
    },
    {
      icon: Heart,
      n: compact(data.engagements),
      label: "likes, comments, shares",
      note: "on the posts we can measure",
    },
  ].filter((f) => f.n !== "0");

  return (
    <section
      className={dark ? "text-white" : "border-y border-border bg-background"}
      style={dark ? { backgroundColor: "#000741" } : undefined}
      data-testid="section-audience-reach"
    >
      <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:py-20">
        <div className="text-xs font-semibold uppercase tracking-[0.18em]" style={{ color: gold }}>
          Who you'd be reaching
        </div>
        <h2
          className={`mt-3 max-w-3xl text-3xl font-bold leading-[1.25] tracking-tight sm:text-4xl sm:leading-[1.25] ${
            dark ? "text-white" : ""
          }`}
          style={headline}
        >
          The shows on the board already carry an audience.
        </h2>
        <p className={`mt-3 max-w-2xl ${dark ? "text-white/70" : "text-muted-foreground"}`}>
          Read straight from the connected channels of {data.shows}
          {data.showsTotal > data.shows ? ` of the ${data.showsTotal} shows` : " shows"} confirmed so far — so this is a
          floor, not a ceiling. It grows with every host who joins the lineup.
        </p>

        <div
          className={`mt-10 grid grid-cols-2 gap-y-10 border-t pt-10 lg:grid-cols-4 ${
            dark ? "border-white/15" : "border-border"
          }`}
        >
          {figures.map(({ icon: Icon, n, label, note }) => (
            <div key={label} className="px-1 lg:px-0">
              <Icon className="h-5 w-5" style={{ color: gold }} />
              <div
                className={`mt-2.5 text-4xl font-bold tabular-nums tracking-tight sm:text-5xl ${
                  dark ? "text-white" : "text-foreground"
                }`}
                style={headline}
                data-testid={`stat-${label.split(" ")[0]}`}
              >
                {n}
              </div>
              <div className={`mt-1 text-sm font-medium ${dark ? "text-white/85" : "text-foreground"}`}>{label}</div>
              <div className={`text-xs ${dark ? "text-white/50" : "text-muted-foreground"}`}>{note}</div>
            </div>
          ))}
        </div>

        {data.byPlatform.length > 0 && (
          <div className="mt-10 flex flex-wrap gap-2">
            {data.byPlatform.map((p) => (
              <span
                key={p.platform}
                className={`inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-sm ${
                  dark ? "bg-white/10 text-white/90" : "border border-border bg-background text-foreground"
                }`}
                data-testid={`platform-${p.platform}`}
              >
                <span className="font-medium">{PLATFORM_LABEL[p.platform] ?? p.platform}</span>
                <span className="tabular-nums opacity-70">{compact(p.followers)}</span>
              </span>
            ))}
          </div>
        )}

        {/* The part a media buyer checks first. Putting it in plain words is
            the difference between a number they trust and one they halve. */}
        <p className={`mt-8 max-w-3xl text-xs leading-relaxed ${dark ? "text-white/45" : "text-muted-foreground"}`}>
          Pulled from each host's own accounts on {asOf}. Combined following adds every connected channel together and
          is not deduplicated — a listener who follows a show on two platforms is counted twice, and audiences overlap
          between shows. Figures that failed a consistency check against the platform's own reporting were left out
          rather than estimated.
        </p>
      </div>
    </section>
  );
}
