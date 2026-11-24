import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CalendarDays, Check, Clock, Link2, Loader2, MapPin, Mic2, Share2 } from "lucide-react";
import type { PublicEvent } from "@shared/schema";
import { apiRequest } from "@/lib/queryClient";
import { NavBar } from "@/components/NavBar";
import { SiteFooter } from "@/components/SiteFooter";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { eventDay, eventTimes, readQuestions } from "@shared/eventTime";
import Landing from "@/pages/Landing";

/**
 * A member's own event (24 Nov 2026, Andrew: "Yes, build free first", mockup approved): when, where, who's hosting,
 * and the sign-up card. The events we run (the Marathon, Radio, everything without a kind) keep their own page.
 */
type HostedEvent = PublicEvent & { host?: { name: string; show: string; photo: string } | null };

export function useEventBySlug(slug?: string) {
  // The same query as the Marathon-style page, so whichever page it turns out to be paints from one fetch.
  return useQuery<PublicEvent>({
    queryKey: ["/api/event", slug ?? "featured"],
    queryFn: async () => {
      const res = await apiRequest("GET", slug ? `/api/event?slug=${encodeURIComponent(slug)}` : "/api/event");
      return res.json();
    },
    retry: false,
  });
}

/** /event/:slug: a member's event gets this page; everything else, the page it has always had. */
export default function EventRoute({ slug }: { slug: string }) {
  const { data, isLoading } = useEventBySlug(slug);
  if (isLoading) return <div className="min-h-screen bg-background"><NavBar /></div>;
  if (data?.kind) return <EventPage ev={data as HostedEvent} />;
  return <Landing slug={slug} />;
}

function EventPage({ ev }: { ev: HostedEvent }) {
  const tz = ev.timezone || "America/New_York";
  const end = ev.endAtUtc || new Date(Date.parse(ev.startAtUtc) + ev.durationHours * 3600000).toISOString();
  const over = Date.parse(end) < Date.now();
  const inPerson = ev.mode === "person";
  const src = useMemo(() => new URLSearchParams(window.location.search).get("src") ?? "", []);
  const [shared, setShared] = useState(false);
  const pageUrl = `${window.location.origin}/event/${ev.slug}`;
  const share = async () => {
    if (navigator.share) { try { await navigator.share({ title: ev.name, url: pageUrl }); return; } catch { /* closed */ } }
    try { await navigator.clipboard.writeText(pageUrl); } catch { /* the address bar has it */ }
    setShared(true);
    setTimeout(() => setShared(false), 2000);
  };
  const host = ev.host;
  const hostLine = host ? (host.show && host.show !== host.name ? host.show : host.name) : "";

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <NavBar />
      <section className="text-white" style={{ background: "radial-gradient(ellipse 70% 120% at 82% 50%, #0d3a8a 0%, #05175a 40%, #000741 75%)" }}>
        <div className="mx-auto grid w-full max-w-6xl gap-8 px-4 py-9 sm:px-6 lg:grid-cols-[1.25fr_1fr] lg:py-12">
          <div className="min-w-0">
            <p className="text-xs font-extrabold uppercase tracking-[0.2em] text-[#F0A71F]">Event · {inPerson ? "In person" : "Online"}{ev.kind === "lineup" ? " · Lineup" : ""}</p>
            <h1 className="mt-2 text-4xl font-bold leading-[1.04] tracking-tight [text-wrap:balance] sm:text-[52px]" data-testid="event-title">{ev.name}</h1>
            {ev.tagline && <p className="mt-3 max-w-lg text-[17px] text-white/85">{ev.tagline}</p>}
            {hostLine && (
              <div className="mt-5 flex items-center gap-3">
                {host?.photo ? <img src={host.photo} alt="" className="h-11 w-11 rounded-full object-cover ring-2 ring-white/20" /> : <span className="flex h-11 w-11 items-center justify-center rounded-full bg-white/10"><Mic2 className="h-5 w-5 text-[#F0A71F]" /></span>}
                <div><div className="text-sm font-semibold">Hosted by {hostLine}</div>{host?.show && host.name && host.show !== host.name && <div className="text-[12.5px] text-white/65">{host.name}</div>}</div>
              </div>
            )}
            <div className="mt-5 space-y-2 text-[15px]">
              <p className="flex items-center gap-2.5"><CalendarDays className="h-4 w-4 shrink-0 text-[#F0A71F]" /> {eventDay(ev.startAtUtc, tz)}</p>
              <p className="flex items-center gap-2.5" data-testid="event-times"><Clock className="h-4 w-4 shrink-0 text-[#F0A71F]" /> {eventTimes(ev.startAtUtc, end, tz)}</p>
              {inPerson ? (
                <p className="flex items-start gap-2.5"><MapPin className="mt-0.5 h-4 w-4 shrink-0 text-[#F0A71F]" /><span>{[ev.venueName, ev.venueAddress].filter(Boolean).join(" · ")}{ev.venueAddress && <> <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([ev.venueName, ev.venueAddress].filter(Boolean).join(", "))}`} target="_blank" rel="noreferrer" className="font-semibold text-[#F0A71F] hover:underline">Directions</a></>}</span></p>
              ) : (
                <p className="flex items-center gap-2.5"><MapPin className="h-4 w-4 shrink-0 text-[#F0A71F]" /> Online</p>
              )}
            </div>
            <div className="mt-5 flex flex-wrap gap-2">
              <button type="button" onClick={() => void share()} className="inline-flex h-9 items-center gap-1.5 rounded-full border border-white/25 bg-white/10 px-4 text-[13px] font-semibold hover:bg-white/20" data-testid="event-share-page">
                {shared ? <><Check className="h-4 w-4" /> Link copied</> : <><Share2 className="h-4 w-4" /> Share this event</>}
              </button>
              {ev.kind === "lineup" && !over && <a href={`/event/${ev.slug}/schedule`} className="inline-flex h-9 items-center gap-1.5 rounded-full bg-white/10 px-4 text-[13px] font-semibold hover:bg-white/20"><Mic2 className="h-4 w-4" /> Podcasters: book a slot</a>}
            </div>
          </div>
          <div className="self-start rounded-[20px] bg-card p-5 text-card-foreground shadow-[0_18px_44px_rgba(0,0,0,0.3)]">
            <SignupCard ev={ev} over={over} src={src} />
          </div>
        </div>
      </section>
      {ev.description && (
        <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
          <h2 className="text-xl font-bold">What it is</h2>
          <p className="mt-1 max-w-2xl whitespace-pre-line text-[15px] leading-relaxed text-foreground/80">{ev.description}</p>
        </main>
      )}
      <div className="flex-1" />
      <SiteFooter />
    </div>
  );
}

function SignupCard({ ev, over, src }: { ev: HostedEvent; over: boolean; src: string }) {
  const qs = readQuestions(ev.questions);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [answers, setAnswers] = useState<string[]>(() => qs.map(() => ""));
  const [website, setWebsite] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState<{ joinUrl: string } | null>(null);
  const online = ev.mode !== "person";

  if (over) return <><div className="text-2xl font-bold">This event is over</div><p className="mt-1 text-sm text-muted-foreground">Thanks to everyone who came.</p></>;

  if (ev.signupMode !== "free") {
    return (
      <div data-testid="event-open">
        <div className="text-2xl font-bold">Free</div>
        <p className="mt-1 text-sm text-muted-foreground">No sign-up needed. Just come along.</p>
        {online && ev.joinUrl && <a href={ev.joinUrl} target="_blank" rel="noreferrer" className="mt-4 flex h-12 w-full items-center justify-center gap-2 rounded-full bg-[#F0A71F] text-[15.5px] font-semibold text-[#1a1200] hover:bg-[#f5b944]"><Link2 className="h-4 w-4" /> Join here</a>}
      </div>
    );
  }

  if (done) {
    return (
      <div data-testid="event-signed-up">
        <div className="flex items-center gap-2 text-2xl font-bold"><span className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-100 text-emerald-700"><Check className="h-5 w-5" /></span> You're signed up</div>
        <p className="mt-2 text-sm text-muted-foreground">See you on {eventDay(ev.startAtUtc, ev.timezone || "America/New_York")}.</p>
        {done.joinUrl && <a href={done.joinUrl} target="_blank" rel="noreferrer" className="mt-4 flex h-12 w-full items-center justify-center gap-2 rounded-full bg-[#F0A71F] text-[15.5px] font-semibold text-[#1a1200] hover:bg-[#f5b944]" data-testid="event-join-link"><Link2 className="h-4 w-4" /> Join here</a>}
        {done.joinUrl && <p className="mt-2 break-all text-center text-[12px] text-muted-foreground">{done.joinUrl}</p>}
      </div>
    );
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr("");
    try {
      const r = await apiRequest("POST", `/api/event/${encodeURIComponent(ev.slug)}/register`, { name, email, answers, src, website });
      const d = (await r.json()) as { joinUrl?: string };
      setDone({ joinUrl: d.joinUrl ?? "" });
    } catch (x) {
      setErr((x as Error).message.replace(/^\d+:\s*/, "").replace(/^\{"message":"(.*)"\}$/, "$1"));
    }
    setBusy(false);
  };
  return (
    <form onSubmit={(e) => void submit(e)} data-testid="event-register">
      <div className="text-2xl font-bold">Free</div>
      <p className="text-[13px] text-muted-foreground">Register to attend</p>
      <div className="mt-3"><Label htmlFor="reg-name">Your name</Label><Input id="reg-name" className="mt-1.5" value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" autoComplete="name" required /></div>
      <div className="mt-2.5"><Label htmlFor="reg-email">Email</Label><Input id="reg-email" type="email" className="mt-1.5" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" autoComplete="email" required /></div>
      {qs.map((q, i) => (
        <div key={i} className="mt-2.5">
          <Label htmlFor={`reg-q${i}`}>{q.q}</Label>
          {q.type === "choice" ? (
            <div className="mt-1.5 flex flex-wrap gap-1.5" role="radiogroup" aria-label={q.q}>
              {q.options.map((o) => (
                <button key={o} type="button" role="radio" aria-checked={answers[i] === o} onClick={() => setAnswers((a) => a.map((x, j) => (j === i ? o : x)))}
                  className={`h-10 whitespace-nowrap rounded-lg border px-3.5 text-sm font-semibold ${answers[i] === o ? "border-[#053877] bg-[#053877] text-white" : "border-border hover:bg-muted"}`}>{o}</button>
              ))}
            </div>
          ) : (
            <Input id={`reg-q${i}`} className="mt-1.5" value={answers[i] ?? ""} onChange={(e) => setAnswers((a) => a.map((x, j) => (j === i ? e.target.value : x)))} placeholder="Your answer" />
          )}
        </div>
      ))}
      {/* Only bots fill this in. */}
      <input type="text" name="website" value={website} onChange={(e) => setWebsite(e.target.value)} tabIndex={-1} autoComplete="off" aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 opacity-0" />
      {err && <p className="mt-3 text-sm font-medium text-destructive">{err}</p>}
      <button type="submit" disabled={busy} className="mt-4 flex h-12 w-full items-center justify-center gap-2 rounded-full bg-[#F0A71F] text-[15.5px] font-semibold text-[#1a1200] hover:bg-[#f5b944] disabled:opacity-60" data-testid="event-register-go">{busy && <Loader2 className="h-4 w-4 animate-spin" />} Register</button>
    </form>
  );
}
