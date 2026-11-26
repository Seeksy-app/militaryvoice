import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, Redirect, Route, Switch, useLocation } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BarChart3, CalendarDays, CheckSquare, Film, LayoutDashboard, ListOrdered, LogOut, Radio, Sparkles, Users } from "lucide-react";
import { LoginCard } from "@/pages/HostDashboard";
import { sideOf, STATUS_LABEL, useMe, useProductions, useStages, type Production, type Role, type Side } from "./api";
import { C, FONT_BODY, FONT_COND, FONT_MONO, Pill, useEtClock, useLiveFonts } from "./ui";
import Overview from "./Overview";
import Events, { EventEdit } from "./Events";
import Crew from "./Crew";
import Approvals from "./Approvals";
import ClientPortal from "./ClientPortal";

/**
 * Military Voices LIVE at /live (phase 1, 26 Nov 2026). MV staff and crew get Production Command (navy); a client
 * login gets only its own portal at /live/<client> (light). Packet A's API decides who sees what; these screens
 * only mirror it and never show a control the role can't use.
 */

type Ctx = { productions: Production[]; current: Production | null; setCurrent: (id: number) => void; role: Role | null; side: Side; isAdmin: boolean; email: string };
const LiveCtx = createContext<Ctx | null>(null);
export const useLive = () => {
  const c = useContext(LiveCtx);
  if (!c) throw new Error("useLive outside LiveApp");
  return c;
};

/** Paths Production Command owns, so a client's slug can never be one of them. */
const OWN = ["events", "crew", "run-of-show", "ai", "control", "media", "approvals", "reports", "p"];

export default function LiveApp() {
  useLiveFonts();
  const qc = useQueryClient();
  const me = useMe();
  const signedOut = me.error?.status === 401;
  // The sign-in card refreshes every /api/host query when a code is accepted; watching the session tells us to ask again.
  const session = useQuery<{ email: string } | null>({
    queryKey: ["/api/host/session", "live"],
    queryFn: async () => { const r = await fetch("/api/host/session", { credentials: "include", cache: "no-store" }); return r.ok ? r.json() : null; },
    enabled: signedOut,
    retry: false,
  });
  useEffect(() => { if (session.data?.email) void qc.invalidateQueries({ queryKey: ["/api/production"] }); }, [session.data?.email, qc]);

  const open = !!me.data?.open;
  const prods = useProductions(open);
  const email = me.data?.email ?? "";
  const isAdmin = !!me.data?.admin;

  const [pick, setPick] = useState<number | null>(() => {
    const q = Number(new URLSearchParams(window.location.search).get("p"));
    if (q) return q;
    try { return Number(localStorage.getItem("live:prod")) || null; } catch { return null; }
  });
  const list = prods.data ?? [];
  const current = list.find((p) => p.id === pick) ?? list[0] ?? null;
  const setCurrent = (id: number) => { setPick(id); try { localStorage.setItem("live:prod", String(id)); } catch { /* private window */ } };
  const role = current?.myRole ?? (isAdmin ? "mv_admin" : null);
  const ctx = useMemo<Ctx>(() => ({ productions: list, current, setCurrent, role, side: sideOf(role), isAdmin, email }), [list, current, role, isAdmin, email]);

  if (me.isLoading) return <Splash />;
  if (signedOut || prods.error?.status === 401) return <SignIn />;
  if (me.error) return <NotOpen text={me.error.status === 403 || me.error.status === 404 ? "Military Voices LIVE isn't open for this account." : me.error.message} email="" />;
  if (!open || prods.error?.status === 403) return <NotOpen text="Military Voices LIVE isn't open for this account." email={email} />;
  if (prods.isLoading) return <Splash />;
  if (prods.error) return <NotOpen text={prods.error.message} email={email} />;
  if (!list.length && !isAdmin) return <NotOpen text="You're not on a production yet. When the production team adds you, it shows here." email={email} />;

  return (
    <LiveCtx.Provider value={ctx}>
      {/* Arrays, not fragments: wouter's Switch only looks at its direct children. */}
      <Switch>
        {ctx.side === "client" ? [
          <Route key="portal" path="/:slug/:tab?">{(p) => <ClientPortal slug={p.slug} tab={p.tab} />}</Route>,
          <Route key="home"><Redirect to={`/${current?.org?.slug || "portal"}`} replace /></Route>,
        ] : [
          <Route key="home" path="/"><Shell><Overview /></Shell></Route>,
          <Route key="events" path="/events"><Shell><Events /></Shell></Route>,
          <Route key="new" path="/events/new"><Shell><EventEdit id={null} /></Shell></Route>,
          <Route key="edit" path="/events/:id">{(p) => <Shell><EventEdit id={Number(p.id)} /></Shell>}</Route>,
          <Route key="crew" path="/crew"><Shell><Crew /></Shell></Route>,
          <Route key="approvals" path="/approvals"><Shell><Approvals /></Shell></Route>,
          ...NAV.filter((n) => n.phase > 1).map((n) => (
            <Route key={n.href} path={n.href}><Shell><ComingPage title={n.label} phase={n.phase} what={n.what ?? ""} /></Shell></Route>
          )),
          // MV can look at a client's portal exactly as the client sees it.
          <Route key="preview" path="/:slug/:tab?">{(p) => (OWN.includes(p.slug) ? <Redirect to="/" replace /> : <ClientPortal slug={p.slug} tab={p.tab} preview />)}</Route>,
        ]}
      </Switch>
    </LiveCtx.Provider>
  );
}

/* ------------------------------------------------------------------ nav */

type NavItem = { href: string; label: string; icon: typeof Users; phase: number; sides: Side[]; what?: string };
const NAV: NavItem[] = [
  { href: "/", label: "Production Command", icon: LayoutDashboard, phase: 1, sides: ["mv", "crew"] },
  { href: "/events", label: "Events", icon: CalendarDays, phase: 1, sides: ["mv", "crew"] },
  { href: "/run-of-show", label: "Run of Show", icon: ListOrdered, phase: 2, sides: ["mv", "crew"], what: "Sessions, speakers and scripts by day, with versions and the client's approval." },
  { href: "/crew", label: "Crew & Technical", icon: Users, phase: 1, sides: ["mv", "crew"] },
  { href: "/ai", label: "AI Assistant", icon: Sparkles, phase: 2, sides: ["mv"], what: "Drafts and schedule changes waiting for a person to approve, edit or reject, with the full activity log." },
  { href: "/control", label: "Live Control", icon: Radio, phase: 3, sides: ["mv", "crew"], what: "Cameras, program, health, run of show and cues for the stage. Crew get On-Site Crew Control here." },
  { href: "/media", label: "Media Library", icon: Film, phase: 4, sides: ["mv"], what: "Recordings and clips by day, session and speaker, with rights and approval on each." },
  { href: "/approvals", label: "Approvals", icon: CheckSquare, phase: 1, sides: ["mv"] },
  { href: "/reports", label: "Reports", icon: BarChart3, phase: 4, sides: ["mv"], what: "Viewership, sponsor delivery with proof clips, incidents and the after-action report." },
];

function Shell({ children }: { children: ReactNode }) {
  const { productions, current, setCurrent, side, email, isAdmin } = useLive();
  const [loc] = useLocation();
  const clock = useEtClock();
  const stages = useStages(current?.id ?? null);
  const first = stages.data?.[0]?.name;
  // A production often carries its stage in its name already ("Convention · Exhibit Hall Stage").
  const stage = first && !current?.name.includes(first) ? first : "";
  const nav = NAV.filter((n) => n.sides.includes(side));
  return (
    <div className="flex min-h-screen flex-col" style={{ background: C.bg, color: C.ink, fontFamily: FONT_BODY }} data-testid="live-shell">
      <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-3 border-b px-3 sm:gap-4 sm:px-4" style={{ background: C.head, borderColor: C.line }}>
        <Link href="/" className="flex shrink-0 items-center gap-2" aria-label="Military Voices LIVE">
          <span className="hidden sm:inline text-[17px] font-bold tracking-[.06em]" style={{ fontFamily: FONT_COND }}>MILITARY VOICES</span>
          <span className="rounded px-1.5 py-px text-[13px] font-bold italic tracking-[.08em]" style={{ fontFamily: FONT_COND, background: C.gold, color: "#0b2447" }}>LIVE</span>
        </Link>
        <span className="hidden h-7 w-px shrink-0 sm:block" style={{ background: C.line }} aria-hidden />
        <div className="min-w-0 leading-tight">
          <p className="text-[15px] font-semibold" style={{ fontFamily: FONT_COND, letterSpacing: ".04em" }}>Production Command</p>
          {productions.length > 1 ? (
            <select
              value={current?.id ?? ""}
              onChange={(e) => setCurrent(Number(e.target.value))}
              className="-ml-1 max-w-[420px] truncate rounded bg-transparent px-1 text-[12.5px] outline-none hover:bg-white/5"
              style={{ color: C.muted, colorScheme: "dark" }}
              aria-label="Production"
              data-testid="live-production-pick"
            >
              {productions.map((p) => <option key={p.id} value={p.id} style={{ background: C.bg }}>{p.name}</option>)}
            </select>
          ) : (
            <p className="truncate text-[12.5px]" style={{ color: C.muted }}>{current ? `${current.name}${stage ? ` · ${stage}` : ""}` : "No production yet"}</p>
          )}
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-3">
          {current && <span className="hidden sm:inline"><Pill tone="gold">{STATUS_LABEL[current.status].toUpperCase()}</Pill></span>}
          <span className="hidden text-[13px] tabular-nums md:inline" style={{ fontFamily: FONT_MONO, color: C.muted }}>{clock}</span>
          <span className="hidden max-w-[200px] truncate text-[12.5px] lg:inline" style={{ color: C.muted }} title={email}>{email}</span>
          {!isAdmin && <SignOut />}
        </div>
      </header>
      <div className="flex min-h-0 flex-1">
        <nav className="hidden w-[208px] shrink-0 border-r px-2 py-3 md:block" style={{ borderColor: C.line }} aria-label="Production Command">
          {nav.map((n) => {
            const on = n.href === "/" ? loc === "/" : loc.startsWith(n.href);
            return (
              <Link
                key={n.href}
                href={n.href}
                className="mb-0.5 flex h-9 items-center gap-2.5 rounded-md px-2.5 text-[14px] font-medium hover:bg-white/5"
                style={on ? { background: C.active, color: "#fff" } : { color: n.phase > 1 ? "#7f90ab" : C.ink }}
                data-testid={`live-nav-${n.href.slice(1) || "home"}`}
              >
                <n.icon className="h-4 w-4 shrink-0" style={{ color: on ? C.gold : undefined }} aria-hidden />
                <span className="min-w-0 flex-1 truncate">{n.label}</span>
                {n.phase > 1 && <span className="text-[10.5px]" style={{ fontFamily: FONT_MONO, color: "#7f90ab" }}>P{n.phase}</span>}
              </Link>
            );
          })}
        </nav>
        <main className="min-w-0 flex-1 p-3 sm:p-4">
          {/* Phone: the same sections as a strip under the bar. */}
          <div className="-mx-3 mb-3 flex gap-1 overflow-x-auto border-b px-3 pb-2 md:hidden" style={{ borderColor: C.line }}>
            {nav.filter((n) => n.phase === 1).map((n) => {
              const on = n.href === "/" ? loc === "/" : loc.startsWith(n.href);
              return <Link key={n.href} href={n.href} className="whitespace-nowrap rounded-md px-2.5 py-1.5 text-[13.5px] font-semibold" style={on ? { background: C.active, color: "#fff" } : { color: C.muted }}>{n.href === "/" ? "Overview" : n.label}</Link>;
            })}
          </div>
          {children}
        </main>
      </div>
    </div>
  );
}

function SignOut() {
  return (
    <button
      type="button"
      onClick={() => void fetch("/api/host/logout", { method: "POST", credentials: "include" }).finally(() => window.location.reload())}
      className="flex h-8 w-8 items-center justify-center rounded-md hover:bg-white/10"
      style={{ color: C.muted }}
      title="Sign out"
      aria-label="Sign out"
    >
      <LogOut className="h-4 w-4" aria-hidden />
    </button>
  );
}

function ComingPage({ title, phase, what }: { title: string; phase: number; what: string }) {
  return (
    <div className="max-w-[640px] rounded-lg border p-5" style={{ background: C.card, borderColor: C.line }}>
      <p className="text-[22px] font-semibold" style={{ fontFamily: FONT_COND }}>{title}</p>
      <p className="mt-1 text-[14px]" style={{ color: C.muted }}>{what}</p>
      <p className="mt-3 text-[12.5px]" style={{ fontFamily: FONT_MONO, color: C.muted }}>Coming in phase {phase}</p>
    </div>
  );
}

/* ------------------------------------------------------------------ outside the shell (light, like the rest of the site) */

function Splash() {
  return <div className="min-h-screen" style={{ background: C.bg }} />;
}

function SignIn() {
  return (
    <div className="min-h-screen pb-10 text-white" style={{ fontFamily: FONT_BODY, background: C.bg }}>
      <div className="mx-auto flex max-w-md items-center gap-2 px-4 pt-10">
        <span className="text-[17px] font-bold tracking-[.06em]" style={{ fontFamily: FONT_COND }}>MILITARY VOICES</span>
        <span className="rounded px-1.5 py-px text-[13px] font-bold italic tracking-[.08em]" style={{ fontFamily: FONT_COND, background: C.gold, color: "#0b2447" }}>LIVE</span>
      </div>
      <LoginCard pending={null} />
    </div>
  );
}

function NotOpen({ text, email }: { text: string; email: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#f3f5f9] px-4 text-[#0d1b2e]" style={{ fontFamily: FONT_BODY }}>
      <div className="max-w-sm rounded-xl border border-[#dde3ec] bg-white p-5 text-center">
        <p className="text-[17px] font-semibold">{text}</p>
        {email && <p className="mt-1 text-[13px] text-[#4f5d72]">Signed in as {email}.</p>}
        <p className="mt-3 text-[13px] text-[#4f5d72]">Questions? Email <a className="font-semibold text-[#1f4f8f] hover:underline" href="mailto:hello@militaryvoices.ai">hello@militaryvoices.ai</a>.</p>
      </div>
    </div>
  );
}
