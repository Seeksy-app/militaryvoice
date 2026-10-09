import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { BarChart3, Users, Scissors, Link2, Radio, Compass, BookOpen, Mail, DollarSign } from "lucide-react";
import { adminGet } from "@/lib/adminApi";

// Admin → Growth → Analytics (9 Oct 2026): the platform's numbers, not any one event's.

type Data = {
  days: number;
  accounts: { total: number; new: number };
  revenue: { mrrCents: number; plans: { plan: string; name: string; interval: string; n: number }[]; addons: { addon: string; n: number }[] };
  postify: { uploads: number; clips: number; episodes: number };
  smartlink: { pages: number; live: number; views: number; clicks: number };
  hosting: { shows: number; downloads: number };
  discovery: { members: number; new: number; searches: number; reveals: number };
  magazine: { plays: number; pictures: number; links: number; scans: number };
  email: { sent: number; failed: number };
  series: { d: string; accounts: number; clips: number; views: number; downloads: number }[];
};

const money = (c: number) => `$${(c / 100).toLocaleString(undefined, { minimumFractionDigits: c % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;

function Bars({ data, k, label }: { data: Data["series"]; k: "accounts" | "clips" | "views" | "downloads"; label: string }) {
  const max = Math.max(1, ...data.map((x) => x[k]));
  const total = data.reduce((a, x) => a + x[k], 0);
  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <div className="flex items-baseline justify-between">
        <p className="text-sm font-semibold">{label}</p>
        <p className="text-lg font-bold tabular-nums">{total.toLocaleString()}</p>
      </div>
      <div className="mt-3 flex h-20 items-end gap-[2px]" aria-label={`${label} by day`}>
        {data.map((x) => (
          <div key={x.d} title={`${x.d}: ${x[k]}`} className="flex-1 rounded-t-sm bg-[#053877]/80 hover:bg-[#F0A71F]" style={{ height: `${Math.max(x[k] ? 6 : 2, (x[k] / max) * 100)}%`, opacity: x[k] ? 1 : 0.25 }} />
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-muted-foreground"><span>{data[0]?.d.slice(5)}</span><span>{data[data.length - 1]?.d.slice(5)}</span></div>
    </div>
  );
}

function Card({ icon: Icon, title, rows }: { icon: typeof Users; title: string; rows: [string, string | number][] }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <p className="flex items-center gap-2 text-sm font-semibold"><Icon className="h-4 w-4 text-[#053877]" /> {title}</p>
      <dl className="mt-3 space-y-1.5 text-sm">
        {rows.map(([k, v]) => (
          <div key={k} className="flex items-baseline justify-between gap-3">
            <dt className="text-muted-foreground">{k}</dt>
            <dd className="font-semibold tabular-nums">{typeof v === "number" ? v.toLocaleString() : v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export function PlatformAnalytics() {
  const [days, setDays] = useState(30);
  const q = useQuery<Data>({ queryKey: ["/api/admin/platform-analytics", days], queryFn: () => adminGet(`/api/admin/platform-analytics?days=${days}`), refetchInterval: 5 * 60_000 });
  const d = q.data;
  return (
    <section className="flex flex-col gap-5" data-testid="platform-analytics">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-xl font-bold tracking-tight"><BarChart3 className="h-5 w-5 text-[#053877]" /> Analytics</h2>
          <p className="mt-1 text-sm text-muted-foreground">The whole platform, not one event.</p>
        </div>
        <div className="inline-flex rounded-full border border-border bg-card p-1 text-sm font-semibold" role="tablist" aria-label="Window">
          {[7, 30, 90].map((n) => (
            <button key={n} type="button" role="tab" aria-selected={days === n} onClick={() => setDays(n)} className={`rounded-full px-3 py-1 ${days === n ? "bg-[#053877] text-white" : "text-muted-foreground hover:text-foreground"}`}>{n} days</button>
          ))}
        </div>
      </div>
      {!d ? (
        <p className="text-sm text-muted-foreground">{q.isError ? "Couldn't load the numbers." : "Loading…"}</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[
              ["Monthly revenue", money(d.revenue.mrrCents)],
              ["Accounts", d.accounts.total.toLocaleString()],
              [`New accounts · ${d.days}d`, d.accounts.new.toLocaleString()],
              [`Clips made · ${d.days}d`, d.postify.clips.toLocaleString()],
            ].map(([k, v]) => (
              <div key={k} className="rounded-2xl border border-border bg-card p-4">
                <p className="text-2xl font-bold tabular-nums">{v}</p>
                <p className="text-xs font-semibold text-muted-foreground">{k}</p>
              </div>
            ))}
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <Bars data={d.series} k="accounts" label="New accounts" />
            <Bars data={d.series} k="clips" label="Clips made" />
            <Bars data={d.series} k="views" label="SmartLink views" />
            <Bars data={d.series} k="downloads" label="Episode downloads" />
          </div>
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            <Card icon={DollarSign} title="Plans" rows={[
              ...d.revenue.plans.map((p) => [`${p.name}${p.interval === "year" ? " (yearly)" : ""}`, p.n] as [string, number]),
              ...d.revenue.addons.map((a) => [a.addon === "discovery" ? "Discovery Pro" : a.addon, a.n] as [string, number]),
              ...(d.revenue.plans.length || d.revenue.addons.length ? [] : [["Paid plans", 0] as [string, number]]),
            ]} />
            <Card icon={Scissors} title={`Pōstify · ${d.days} days`} rows={[["Episodes uploaded", d.postify.uploads], ["Episodes clipped", d.postify.episodes], ["Clips made", d.postify.clips]]} />
            <Card icon={Link2} title="SmartLinks" rows={[["Pages", d.smartlink.pages], ["Live", d.smartlink.live], [`Views · ${d.days}d`, d.smartlink.views], [`Clicks · ${d.days}d`, d.smartlink.clicks]]} />
            <Card icon={Radio} title="Hosting" rows={[["Shows hosted", d.hosting.shows], [`Downloads · ${d.days}d`, d.hosting.downloads]]} />
            <Card icon={Compass} title="Discovery" rows={[["Members", d.discovery.members], [`New · ${d.days}d`, d.discovery.new], [`Searches · ${d.days}d`, d.discovery.searches], [`Contacts revealed · ${d.days}d`, d.discovery.reveals]]} />
            <Card icon={BookOpen} title="Magazine" rows={[["Plays", d.magazine.plays], ["Pictures clicked", d.magazine.pictures], ["Links clicked", d.magazine.links], ["QR scans", d.magazine.scans]]} />
            <Card icon={Mail} title={`Email · ${d.days} days`} rows={[["Sent", d.email.sent], ["Failed", d.email.failed]]} />
          </div>
        </>
      )}
    </section>
  );
}
