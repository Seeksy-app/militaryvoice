import { useEffect, useMemo, useState } from "react";
import { useSearch, useLocation, Link } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Mic2,
  Users,
  LogOut,
  Download,
  Radio,
  Headphones,
  Mail,
  KeyRound,
  ArrowLeft,
  Settings,
  Phone,
  Globe,
  Rss,
  Youtube,
  Link2,
  RefreshCw,
  CalendarClock,
  Trash2,
  Shield,
  BookOpen,
  CalendarDays,
  ChevronDown,
  ChevronRight,
  ArrowRight,
  PlayCircle,
} from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { NavBar } from "@/components/NavBar";
import { LogoLockup } from "@/components/Logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Turnstile, useTurnstileSiteKey } from "@/components/Turnstile";
import { ProfileForm, type PendingSlotSummary } from "@/components/ProfileForm";
import { ShowMaterials } from "@/components/ShowMaterials";
import { CohostSlots } from "@/components/CohostSlots";
import { EventSettings } from "@/components/EventSettings";
import { RecordingsScreen } from "@/components/RecordingsScreen";
import { FloatingChecklist } from "@/components/FloatingChecklist";
import { PromotionScreen } from "@/components/PromotionScreen";
import { ContactsScreen } from "@/components/ContactsScreen";
import { CommandCenter, QuickDoors, TodoStrip } from "@/components/CommandCenter";
import { StudioIcon } from "@/components/GreenRoomButton";
import { CrewDashboard, type CrewInfo } from "@/components/CrewDashboard";
import { HostNav } from "@/components/HostNav";
import { ProScreen } from "@/components/ProScreen";
import { AudienceConsent } from "@/components/AudienceConsent";
import { ConnectYoutube } from "@/components/ConnectYoutube";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SocialTiles } from "@/components/SocialTiles";
import { ConnectedAccountsStrip } from "@/components/ConnectedAccountsStrip";
import { apiRequest, apiUpload, API_BASE, resolveUploadUrl } from "@/lib/queryClient";
import type { PublicEvent, PublicSignup, ProfileRow, SocialAccount } from "@shared/schema";
import {
  detectLocalTimeZone,
  slotStart,
  slotEnd,
  totalSlots,
  formatDateInZone,
  formatTimeInZone,
  zoneLabel,
} from "@/lib/schedule";
import { isLiveOnlyBlock, LIVE_ONLY_LABEL } from "@shared/slots";

interface HostSignup {
  id: number;
  slotIndex: number;
  podcastName: string;
  hostName: string;
  numPeople: number;
  status: string;
  createdAt: string;
}

interface HostContact {
  id: number;
  name: string;
  email: string;
  phone: string;
  createdAt: string;
  signupId: number;
}

interface SocialStatus {
  configured: boolean;
  accounts: SocialAccount[];
}

interface HostDashboardData {
  email: string;
  event: PublicEvent;
  signups: PublicSignup[];
  mySignups: HostSignup[];
  contacts: HostContact[];
}

/** A slot the visitor picked on the schedule before signing in. */
interface PendingSlot {
  eventId: number;
  slotIndex: number;
}

const PENDING_KEY = "mv_pending_slot";

function readPending(search: string): PendingSlot | null {
  const params = new URLSearchParams(search);
  const slot = Number(params.get("slot"));
  const eventId = Number(params.get("event"));
  if (params.has("slot") && Number.isInteger(slot) && slot >= 0) {
    const p = { eventId: Number.isInteger(eventId) && eventId > 0 ? eventId : 0, slotIndex: slot };
    try {
      sessionStorage.setItem(PENDING_KEY, JSON.stringify(p));
    } catch {
      /* ignore */
    }
    return p;
  }
  try {
    const raw = sessionStorage.getItem(PENDING_KEY);
    return raw ? (JSON.parse(raw) as PendingSlot) : null;
  } catch {
    return null;
  }
}

function clearPendingStorage() {
  try {
    sessionStorage.removeItem(PENDING_KEY);
  } catch {
    /* ignore */
  }
}

function toHref(v: string): string {
  return /^https?:\/\//i.test(v) ? v : `https://${v}`;
}
function linkLabel(v: string): string {
  return v.replace(/^https?:\/\//i, "").replace(/^www\./i, "").replace(/\/$/, "");
}

// ---------------------------------------------------------------------------
// Sign-in card (email → 6-digit code). Shows the held slot when there is one.
// ---------------------------------------------------------------------------
/**
 * For an admin who is also on the lineup or the crew under other addresses:
 * the other seats, and the way back to the admin. Shown only when the admin
 * cookie is present beside the host one; everyone else sees nothing here.
 */
function SeatSwitcher({ current }: { current: string }) {
  const { data: me } = useQuery<{ email: string }>({ queryKey: ["/api/admin/me"], retry: false, staleTime: 300_000 });
  const { data: seats = [] } = useQuery<{ email: string; label: string; kind: string }[]>({
    queryKey: ["/api/admin/view-as"],
    enabled: !!me,
    retry: false,
    staleTime: 300_000,
  });
  if (!me) return null;
  const others = seats.filter((s) => s.email !== current.trim().toLowerCase());
  return (
    <div className="flex flex-wrap items-center gap-1.5" data-testid="seat-switcher">
      <a href="/admin" className="rounded-full border border-border bg-card px-2.5 py-1 text-[11px] font-semibold text-foreground hover:border-[#053877]/40">Admin</a>
      {others.map((s) => (
        <button
          key={s.email}
          type="button"
          onClick={async () => {
            await apiRequest("POST", "/api/admin/view-as", { email: s.email });
            window.location.href = "/host/dashboard";
          }}
          className="rounded-full border border-border bg-card px-2.5 py-1 text-[11px] font-semibold text-foreground hover:border-[#053877]/40"
          data-testid={`seat-${s.email}`}
        >
          {s.label}
        </button>
      ))}
    </div>
  );
}

function LoginCard({ pending }: { pending: PendingSlotSummary | null }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  // Off by default, deliberately. The old behaviour gave everyone thirty days
  // whether they were on their own laptop or a library computer.
  const [remember, setRemember] = useState(false);

  // Cloudflare check on the code request — the one form a bot can use to
  // make us send email. Off entirely when the server has no keys.
  const siteKey = useTurnstileSiteKey();
  const [human, setHuman] = useState<string | null>(null);
  const [humanReset, setHumanReset] = useState(0);
  const needsHuman = Boolean(siteKey);

  const requestCode = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/host/request-code", { email, turnstileToken: human });
      return res.json();
    },
    onSuccess: () => {
      setStep("code");
      toast({ title: "Check your email", description: "We sent a 6-digit code to sign you in." });
    },
    onError: (err: Error) => toast({ title: "Couldn't send that", description: err.message, variant: "destructive" }),
    // Tokens are single-use, so the widget has to issue a fresh one either way.
    onSettled: () => setHumanReset((n) => n + 1),
  });

  const verifyCode = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/host/verify-code", { email, code, remember });
      return res.json();
    },
    onSuccess: () => {
      // staleTime is Infinity, and the nav fetches /api/host/profile while
      // signed out (returning null). Without clearing those, a returning
      // podcaster lands on the "Set up your show" form instead of their
      // dashboard. Drop every per-account query so they refetch as this user.
      // resetQueries, not removeQueries: removing drops the cache entry but
      // leaves the mounted observers as they were, so /api/host/dashboard kept
      // its signed-out error state, `enabled: !!data` never flipped, and a
      // correct code left you sitting on the code screen until you reloaded.
      // resetQueries refetches the active ones.
      // Every per-account query, not a hand-kept list: the events tab kept the
      // previous account's slots after a sign-out/sign-in and showed the wrong
      // person "Choose a time" for a slot they already held.
      queryClient.resetQueries({ predicate: (q) => String(q.queryKey[0]).startsWith("/api/host") });
    },
    onError: (err: Error) => toast({ title: "That code didn't work", description: err.message, variant: "destructive" }),
  });

  return (
    <div className="mx-auto mt-10 max-w-md px-4 sm:mt-16">
      {pending && (
        <div className="mb-4 overflow-hidden rounded-2xl border border-[#F0A71F]/50 bg-card" data-testid="banner-pending-slot">
          <div className="flex items-center gap-2 bg-[#F0A71F] px-4 py-2 text-xs font-semibold uppercase tracking-wide text-[#1a1200]">
            <CalendarClock className="h-3.5 w-3.5" /> Step 2 of 3 · Your pick is held
          </div>
          <div className="flex items-center justify-between gap-3 px-4 py-3">
            <div>
              <div className="text-sm font-semibold">{formatDateInZone(pending.start, pending.zone)}</div>
              <div className="tabular-nums text-base font-bold text-primary">
                {formatTimeInZone(pending.start, pending.zone)}–{formatTimeInZone(pending.end, pending.zone)}
              </div>
              <div className="text-xs text-muted-foreground">
                {pending.eventName.trim()} · {zoneLabel(pending.zone)}
              </div>
            </div>
            <Link href="/schedule" className="text-xs text-muted-foreground underline-offset-2 hover:underline">
              Change
            </Link>
          </div>
        </div>
      )}
      <Card>
        <CardHeader>
          <div className="mb-1 flex items-center gap-2 text-primary">
            {step === "email" ? <Mail className="h-4 w-4" /> : <KeyRound className="h-4 w-4" />}
            <CardTitle className="text-base">{pending ? "Enter your email to hold it" : "Podcaster sign-in"}</CardTitle>
          </div>
          <CardDescription>
            {step === "email"
              ? pending
                ? "No password needed. We'll email you a one-time code, then you'll set up your show once."
                : "Enter your email and we'll send you a one-time code."
              : `Enter the 6-digit code we sent to ${email}.`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {step === "email" ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (email.trim()) requestCode.mutate();
              }}
              className="flex flex-col gap-3"
              data-testid="form-host-request-code"
            >
              <Label htmlFor="host-email" className="sr-only">
                Email
              </Label>
              <Input
                id="host-email"
                type="email"
                autoFocus
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                data-testid="input-host-email"
              />
              {siteKey && <Turnstile siteKey={siteKey} onToken={setHuman} resetSignal={humanReset} />}
              <Button
                type="submit"
                disabled={requestCode.isPending || !email.trim() || (needsHuman && !human)}
                data-testid="button-request-code"
              >
                {requestCode.isPending ? "Sending…" : pending ? "Send my code & hold the slot" : "Send me a code"}
              </Button>
            </form>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (code.trim()) verifyCode.mutate();
              }}
              className="flex flex-col gap-3"
              data-testid="form-host-verify-code"
            >
              <Label htmlFor="host-code" className="sr-only">
                Code
              </Label>
              <Input
                id="host-code"
                inputMode="numeric"
                autoFocus
                placeholder="123456"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                data-testid="input-host-code"
              />
              <label className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-border p-3">
                <Checkbox
                  checked={remember}
                  onCheckedChange={(v) => setRemember(v === true)}
                  className="mt-0.5"
                  data-testid="checkbox-remember-me"
                />
                <span className="min-w-0">
                  <span className="block text-sm font-medium">Keep me signed in for 30 days</span>
                  <span className="block text-xs text-muted-foreground">
                    Only on a device that's yours. Leave it unticked on a shared or public computer — otherwise the
                    next person to open this browser is signed in as you.
                  </span>
                </span>
              </label>
              <Button type="submit" disabled={verifyCode.isPending || !code.trim()} data-testid="button-verify-code">
                {verifyCode.isPending ? "Checking…" : "Sign in"}
              </Button>
              <button
                type="button"
                className="text-xs text-muted-foreground underline-offset-2 hover:underline"
                onClick={() => {
                  setStep("email");
                  setCode("");
                }}
                data-testid="button-host-use-different-email"
              >
                Use a different email
              </button>
            </form>
          )}
        </CardContent>
      </Card>
      {!pending && (
        <p className="mt-4 text-center text-xs text-muted-foreground">
          First time here?{" "}
          <Link href="/schedule" className="text-primary underline-offset-2 hover:underline">
            Pick a slot on the schedule
          </Link>{" "}
          and we'll walk you through it.
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------
/**
 * What the event view says about streaming: one line, read-only.
 *
 * The connect/disconnect controls live in Integrations. Having them in both
 * places meant YouTube appeared twice with the same channel name under it,
 * which reads as a bug even when both are working.
 */
function StreamStatusRow({ onOpen }: { onOpen: () => void }) {
  const { data } = useQuery<{ connected: boolean; channelTitle?: string }>({
    queryKey: ["/api/host/youtube"],
    queryFn: async () => (await apiRequest("GET", "/api/host/youtube")).json(),
  });
  const connected = Boolean(data?.connected);
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-card p-5 text-left shadow-sm transition-colors hover-elevate"
      data-testid="row-stream-status"
    >
      <span className="flex min-w-0 items-start gap-3">
        <span
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${
            connected ? "bg-[#ED1C24]/10 text-[#ED1C24]" : "bg-muted text-muted-foreground"
          }`}
        >
          <Radio className="h-4.5 w-4.5" />
        </span>
        <span className="min-w-0">
          <span className="block text-sm font-semibold text-card-foreground">
            {connected ? `Also going out to your YouTube — ${data?.channelTitle ?? "your channel"}` : "Going out on MilitaryVoice.ai only"}
          </span>
          <span className="mt-0.5 block text-sm text-muted-foreground">
            {connected
              ? "We'll open a broadcast on your channel when your slot starts."
              : "Connect your own channel and we'll broadcast there too. Optional — your slot airs either way."}
          </span>
        </span>
      </span>
      <span className="inline-flex shrink-0 items-center gap-1 text-sm font-medium text-primary">
        {connected ? "Change" : "Set it up"} <ChevronRight className="h-3.5 w-3.5" />
      </span>
    </button>
  );
}

/**
 * A section heading you can take a link to.
 *
 * The link icon appears on hover and copies the full address including the
 * tab, so what lands in someone's clipboard opens the right screen scrolled
 * to the right place — rather than the dashboard home with a fragment that
 * matches nothing.
 */
function AnchoredHeading({ id, icon: Icon, label }: { id: string; icon: typeof Radio; label: string }) {
  const { toast } = useToast();
  const href = `${window.location.origin}${window.location.pathname}#${id}`;
  return (
    <h2
      id={id}
      className="group mb-2 mt-10 flex scroll-mt-24 items-center gap-2 text-sm font-semibold uppercase tracking-[0.08em] text-foreground"
    >
      <Icon className="h-4 w-4" /> {label}
      <a
        href={`#${id}`}
        aria-label={`Copy a link to ${label}`}
        title="Copy a link to this section"
        className="opacity-0 transition-opacity focus:opacity-100 group-hover:opacity-60 hover:!opacity-100"
        onClick={(e) => {
          e.preventDefault();
          navigator.clipboard.writeText(href).then(
            () => toast({ title: "Link copied", description: "It opens this tab, scrolled to here." }),
            () => toast({ title: "Couldn't copy that link", variant: "destructive" }),
          );
        }}
        data-testid={`anchor-${id}`}
      >
        <Link2 className="h-3.5 w-3.5" />
      </a>
    </h2>
  );
}

/** The screens the dashboard nav switches between, and their URLs. */
const SCREENS = ["dashboard", "editProfile", "events", "promotion", "recordings", "integrations", "contacts", "pro", "claim"] as const;
type Screen = (typeof SCREENS)[number];

/** /host/dashboard/<slug> ⇄ screen. Home has no slug; the rest are lowercase. */
const SCREEN_SLUG: Record<Screen, string> = {
  dashboard: "",
  editProfile: "profile",
  events: "events",
  promotion: "promotion",
  recordings: "recordings",
  integrations: "integrations",
  contacts: "contacts",
  pro: "pro",
  claim: "claim",
};
const SLUG_SCREEN = new Map<string, Screen>(
  (Object.entries(SCREEN_SLUG) as [Screen, string][]).filter(([, v]) => v).map(([k, v]) => [v, k]),
);
export function hostScreenPath(screen: Screen): string {
  const slug = SCREEN_SLUG[screen];
  return slug ? `/host/dashboard/${slug}` : "/host/dashboard";
}

export default function HostDashboard({ tab }: { tab?: string } = {}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const search = useSearch();
  const [, navigate] = useLocation();
  // The URL is the source of truth for which screen is showing, so a tab can
  // be linked, bookmarked and reached with the browser's back button.
  const screen: Screen = (tab && SLUG_SCREEN.get(tab.toLowerCase())) || "dashboard";
  const [profileDirty, setProfileDirty] = useState(false);
  const [remindEventSetup, setRemindEventSetup] = useState(false);
  // Which locked door was opened, so the Pro page scrolls to it.
  const [proFeature, setProFeature] = useState<string | undefined>(() => {
    const h = typeof window === "undefined" ? "" : window.location.hash.replace(/^#/, "");
    return ["campaigns", "crm", "studio"].includes(h) ? h : undefined;
  });

  // The nav is buttons, not links, so ProfileForm's own leave-guard (which
  // watches anchors and page unload) never sees these clicks.
  function setScreen(next: Screen) {
    navigate(hostScreenPath(next));
  }
  function goTo(next: Screen) {
    if (profileDirty && !window.confirm("You have unsaved changes to your profile. Leave without saving?")) return;
    setProfileDirty(false);
    setScreen(next);
  }
  const [claimIndex, setClaimIndex] = useState<number | null>(null);
  const [pending, setPending] = useState<PendingSlot | null>(() => readPending(search));
  const zone = useMemo(detectLocalTimeZone, []);

  // If the URL carries a new slot pick, adopt it.
  useEffect(() => {
    const p = readPending(search);
    if (p && (p.slotIndex !== pending?.slotIndex || p.eventId !== pending?.eventId)) setPending(p);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const { data, isLoading, isError } = useQuery<HostDashboardData>({
    queryKey: ["/api/host/dashboard"],
    retry: false,
  });

  const { data: profile, isLoading: profileLoading } = useQuery<ProfileRow | null>({
    queryKey: ["/api/host/profile"],
    retry: false,
    enabled: !!data,
  });

  // Is there anywhere left to stand? Everything a podcaster sets up — their
  // show, their YouTube, their artwork — only means something attached to a
  // slot. With none free and none held, the whole setup is a form leading
  // nowhere, so it switches off rather than inviting the work.
  const { data: featuredSignups } = useQuery<{ slotIndex: number; status: string }[]>({
    queryKey: ["/api/signups", "featured-fill"],
    queryFn: async () => (await apiRequest("GET", "/api/signups")).json(),
  });
  // Just enough to know what's still outstanding for the checklist.
  const { data: hostEvents } = useQuery<{ show: { showName?: string; showFormat?: string; recordingUrl?: string } | null; slotIndex: number | null }[]>({
    queryKey: ["/api/host/events"],
    queryFn: async () => (await apiRequest("GET", "/api/host/events")).json(),
    enabled: !!data,
  });
  const { data: hostAssets } = useQuery<unknown[]>({
    queryKey: ["/api/host/assets"],
    enabled: !!data,
  });

  const { data: social } = useQuery<SocialStatus>({
    queryKey: ["/api/host/social"],
    retry: false,
    enabled: !!data,
  });

  const { data: cohostBoard } = useQuery<{ blocks: { mine: boolean; takenBy: unknown; yourShow: boolean }[] }>({
    queryKey: ["/api/host/cohost-slots", data?.event.id],
    queryFn: async () => {
      const r = await fetch(`/api/host/cohost-slots/${data!.event.id}`, { credentials: "include" });
      if (!r.ok) throw new Error("no board");
      return r.json();
    },
    enabled: !!data && (data.mySignups.length ?? 0) > 0,
    retry: false,
  });

  // The posting plan, for the number on the command center. Same query the
  // planner makes, so it is cached rather than fetched twice.
  const firstSignupId = data?.mySignups[0]?.id;
  const { data: plan } = useQuery<{ posts: { selected: boolean; status: string | null; postedAt: string | null }[] }>({
    queryKey: ["/api/host/campaign", firstSignupId],
    queryFn: async () => (await apiRequest("GET", `/api/host/campaign?signupId=${firstSignupId}`)).json(),
    enabled: !!firstSignupId,
    retry: false,
  });

  // Whether their own channel is wired up, for the checklist. StreamStatusRow
  // asks the same question lower down; both read the one cached answer.
  const { data: youtube } = useQuery<{ connected: boolean; channelTitle?: string }>({
    queryKey: ["/api/host/youtube"],
    queryFn: async () => (await apiRequest("GET", "/api/host/youtube")).json(),
    retry: false,
    enabled: !!data,
  });

  // Public events list so the held slot can be described before sign-in.
  const { data: events } = useQuery<PublicEvent[]>({ queryKey: ["/api/events"] });
  const featured = (events ?? []).find((e) => e.isFeatured);
  const eventIsFull =
    !!featured &&
    (featuredSignups ?? []).filter((x) => x.status !== "cancelled").length >=
      totalSlots(featured.durationHours, featured.slotMinutes);
  const noWayIn = eventIsFull && (data?.mySignups.length ?? 0) === 0;

  const pendingEvent: PublicEvent | undefined = useMemo(() => {
    if (!pending) return undefined;
    if (data?.event && (!pending.eventId || data.event.id === pending.eventId)) return data.event;
    return (events ?? []).find((e) => (pending.eventId ? e.id === pending.eventId : e.isFeatured));
  }, [pending, data?.event, events]);

  const pendingSummary: PendingSlotSummary | null = useMemo(() => {
    if (!pending || !pendingEvent) return null;
    const n = totalSlots(pendingEvent.durationHours, pendingEvent.slotMinutes);
    if (pending.slotIndex >= n) return null;
    return {
      eventName: pendingEvent.name,
      start: slotStart(pendingEvent.startAtUtc, pendingEvent.slotMinutes, pending.slotIndex),
      end: slotEnd(pendingEvent.startAtUtc, pendingEvent.slotMinutes, pending.slotIndex),
      zone,
    };
  }, [pending, pendingEvent, zone]);

  function clearPending() {
    setPending(null);
    clearPendingStorage();
    if (window.location.search) window.history.replaceState(null, "", window.location.pathname);
  }

  const connectSocial = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/host/social/connect");
      return (await res.json()) as { url: string };
    },
    onSuccess: ({ url }) => {
      window.location.href = url;
    },
    onError: (err: Error) => toast({ title: "Couldn't open the connection page", description: err.message, variant: "destructive" }),
  });

  const refreshSocial = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/host/social/refresh");
      return (await res.json()) as SocialStatus;
    },
    onSuccess: (result) => {
      queryClient.setQueryData(["/api/host/social"], result);
      queryClient.invalidateQueries({ queryKey: ["/api/host/profile"] });
      queryClient.invalidateQueries({ queryKey: ["/api/signups"] });
      queryClient.invalidateQueries({ queryKey: ["/api/podcasters"] });
      queryClient.invalidateQueries({ queryKey: ["/api/host/dashboard"] });
      toast({
        title: result.accounts.length ? "Social accounts updated" : "No accounts connected yet",
        description: result.accounts.length
          ? `${result.accounts.length} account${result.accounts.length === 1 ? "" : "s"} will show on your card.`
          : "Connect at least one account and we'll add it to your card.",
      });
    },
    onError: (err: Error) => toast({ title: "Couldn't refresh your accounts", description: err.message, variant: "destructive" }),
  });

  /**
   * Scroll to a #section-… anchor once it exists.
   *
   * The browser's own hash scroll fires on load, which on this page is before
   * the dashboard query has come back and the section has rendered — so it
   * lands nowhere and the link looks broken. Polling briefly for the element
   * costs nothing and works whether the data is cached or cold.
   */
  useEffect(() => {
    const id = window.location.hash.replace(/^#/, "");
    if (!id) return;
    const started = Date.now();
    let frame = 0;
    const find = () => {
      const el = document.getElementById(id);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "start" });
        return;
      }
      if (Date.now() - started < 6000) frame = requestAnimationFrame(find);
    };
    frame = requestAnimationFrame(find);
    return () => cancelAnimationFrame(frame);
  }, [screen, data]);

  // ?tab=integrations from an older link. Every one of these still works; it
  // just lands on the real address now instead of leaving the query string in
  // the bar and the URL disagreeing with the screen.
  useEffect(() => {
    const t = new URLSearchParams(search).get("tab");
    if (!t) return;
    // "fans" was folded into Promotion; old links still land somewhere sane.
    const target: Screen | undefined = t === "fans" ? "promotion" : (SCREENS as readonly string[]).includes(t) ? (t as Screen) : undefined;
    if (target) navigate(hostScreenPath(target), { replace: true });
  }, [search, navigate]);

  // Coming back from the Upload-Post connect page: ?social=connected
  useEffect(() => {
    if (!data) return;
    const params = new URLSearchParams(search);
    if (params.get("social") === "connected") {
      window.history.replaceState(null, "", window.location.pathname);
      refreshSocial.mutate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, !!data]);

  // How long this sign-in lasts, said under the address. Thirty days was
  // ticked and people were still being asked for a code the same afternoon;
  // the first step to finding out why is seeing what the browser holds.
  const session = useQuery<{ expiresAt: string; remember: boolean }>({
    queryKey: ["/api/host/session"],
    enabled: !!data,
    retry: false,
  });
  const sessionLine = session.data
    ? session.data.remember
      ? `Signed in until ${new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(new Date(session.data.expiresAt))}`
      : "Signed in for this visit"
    : null;

  const logout = useMutation({
    mutationFn: async () => apiRequest("POST", "/api/host/logout"),
    onSuccess: () => {
      queryClient.removeQueries({ predicate: (q) => String(q.queryKey[0]).startsWith("/api/host") });
      setScreen("dashboard");
      clearPending();
    },
  });

  const claim = useMutation({
    mutationFn: async (input: { slotIndex: number; eventId?: number }) => {
      if (!data) throw new Error("Not signed in");
      const targetEventId = input.eventId || data.event.id;

      // Check the daytime rule before releasing anything. The server enforces
      // it too, but this path gives up the slot they hold first — a rejection
      // after that would leave them with nothing.
      if (
        targetEventId === data.event.id &&
        isLiveOnlyBlock(
          slotStart(data.event.startAtUtc, data.event.slotMinutes, input.slotIndex),
          slotEnd(data.event.startAtUtc, data.event.slotMinutes, input.slotIndex),
        )
      ) {
        const show = await (await apiRequest("GET", `/api/host/shows/${targetEventId}`)).json();
        if (show?.showFormat === "prerecorded") {
          throw new Error(
            `Slots between ${LIVE_ONLY_LABEL} have to be broadcast live. Pick an evening or overnight time, or switch your show to "Go live" first.`,
          );
        }
      }

      // One slot per podcaster: moving to a new time releases the current one first.
      for (const held of data.mySignups) {
        await apiRequest("DELETE", `/api/host/signups/${held.id}`);
      }
      const res = await apiRequest("POST", "/api/signups", {
        eventId: targetEventId,
        slotIndex: input.slotIndex,
        timezone: zone,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/signups"] });
      queryClient.invalidateQueries({ queryKey: ["/api/host/dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["/api/podcasters"] });
      toast({
        title: data && data.mySignups.length > 0 ? "Moved to your new time" : "You're on the schedule",
        description: "This slot is now yours — we'll be in touch before air time.",
      });
      setScreen("dashboard");
      setClaimIndex(null);
      clearPending();
    },
    onError: (err: Error) => {
      queryClient.invalidateQueries({ queryKey: ["/api/host/dashboard"] });
      toast({ title: "Couldn't claim that slot", description: err.message, variant: "destructive" });
      setScreen("dashboard");
      setClaimIndex(null);
      clearPending();
    },
  });

  const release = useMutation({
    mutationFn: async (id: number) => apiRequest("DELETE", `/api/host/signups/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/signups"] });
      queryClient.invalidateQueries({ queryKey: ["/api/host/dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["/api/podcasters"] });
      toast({ title: "Slot released", description: "It's open again for someone else. Pick a new time below whenever you're ready." });
    },
    onError: (err: Error) => toast({ title: "Couldn't release that slot", description: err.message, variant: "destructive" }),
  });

  const loadingProfile = isLoading || (!!data && profileLoading);
  // A profile is about the person, so a name and a photo are what make it
  // complete. The show name moved to the event, and testing for it here sent
  // anyone without one back through first-time setup forever.
  const hasProfile = !!profile && !!profile.hostName && !!profile.photoUrl;

  // Signed in with a finished profile and a held slot → jump to confirmation.
  useEffect(() => {
    if (!data || loadingProfile || !pending || !hasProfile) return;
    const taken = data.signups.some((s) => s.slotIndex === pending.slotIndex && s.status !== "cancelled");
    if (taken) {
      const mine = data.mySignups.some((s) => s.slotIndex === pending.slotIndex);
      toast({
        title: mine ? "That slot is already yours" : "That slot was just taken",
        description: mine ? "You're all set." : "Pick another open time below.",
        variant: mine ? "default" : "destructive",
      });
      clearPending();
      return;
    }
    setClaimIndex(pending.slotIndex);
    setScreen("claim");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!data, loadingProfile, hasProfile, pending?.slotIndex]);

  // Crew without a show: a producer, say. Their dashboard is not the
  // podcaster's, and it must not ask them for a podcast they do not have.
  const [crewEventId, setCrewEventId] = useState<number | null>(() => {
    try { const v = Number(localStorage.getItem("mv_crew_event") ?? ""); return v || null; } catch { return null; }
  });
  const { data: crew } = useQuery<CrewInfo>({
    queryKey: ["/api/host/crew", crewEventId],
    queryFn: async () => (await apiRequest("GET", `/api/host/crew${crewEventId ? `?eventId=${crewEventId}` : ""}`)).json(),
    enabled: !!data,
    retry: false,
  });

  if (isError) {
    return (
      <div className="min-h-screen">
        <NavBar />
        <LoginCard pending={pendingSummary} />
      </div>
    );
  }

  const slots = data
    ? Array.from({ length: totalSlots(data.event.durationHours, data.event.slotMinutes) }, (_, i) => {
        const start = slotStart(data.event.startAtUtc, data.event.slotMinutes, i);
        const end = slotEnd(data.event.startAtUtc, data.event.slotMinutes, i);
        const signup = data.signups.find((s) => s.slotIndex === i && s.status !== "cancelled");
        return { index: i, start, end, signup };
      })
    : [];
  const openSlots = slots.filter((s) => !s.signup);
  const selectedSlot = slots.find((s) => s.index === claimIndex);
  const crewMode = !!data && !loadingProfile && !hasProfile && !!crew?.isCrew;
  const inSetup = !!data && !loadingProfile && !hasProfile && !crewMode;

  // Signed in, past setup: this is a workspace, not a page of the website.
  // The public nav is for people deciding whether to take part; somebody who
  // has already taken a slot just loses a band of screen to it.
  const workspace = !!data && hasProfile && !inSetup;

  return (
    <div className="min-h-screen">
      {/* Signed in is the rule, not "finished setting up": somebody mid-setup
          is no more a visitor deciding whether to take part than somebody with
          a slot, and the band of public links costs them the same screen. */}
      {!data && <NavBar />}
      {/* Wide, like the admin: with a column of nav on the left, 1152px left
          the page itself narrower than a phone in landscape. */}
      <div className={`mx-auto max-w-[1560px] px-4 sm:px-6 ${workspace ? "py-5" : "py-10"}`}>
        {workspace ? (
          /* One line: the mark, who you are, and the way out. The page title
             is gone because the highlighted tab below already says
             "Integrations" — printing it twice, with the address bar saying it
             a third time, was three answers to a question nobody asked. */
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <Link href="/host/dashboard" className="shrink-0" data-testid="link-workspace-home">
              <LogoLockup className="h-9 w-auto" />
            </Link>
            <div className="flex min-w-0 items-center gap-2">
              {profile?.photoUrl ? (
                <img
                  src={resolveUploadUrl(profile.photoUrl)}
                  alt=""
                  className="h-8 w-8 shrink-0 rounded-full object-cover ring-1 ring-border"
                />
              ) : (
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#053877]/10 text-xs font-bold text-[#053877]">
                  {(profile?.podcastName || data?.email || "?").trim().charAt(0).toUpperCase()}
                </span>
              )}
              <span className="hidden min-w-0 sm:block">
                <span className="block truncate text-sm font-semibold text-foreground">
                  {profile?.podcastName || data?.email}
                </span>
                <span className="block truncate text-xs text-muted-foreground">
                  {data?.email}
                  {sessionLine && <span data-testid="text-session-until"> · {sessionLine}</span>}
                </span>
              </span>
              <SeatSwitcher current={data?.email ?? ""} />
              <Button
                variant="outline"
                size="sm"
                className="ml-1 shrink-0 gap-1.5 rounded-full"
                onClick={() => logout.mutate()}
                disabled={logout.isPending}
                data-testid="button-host-logout"
              >
                <LogOut className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Sign out</span>
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-foreground">
                {crewMode ? "Crew" : inSetup ? "Set up your show" : "Podcaster Dashboard"}
              </h1>
              {data && (
                <p className="mt-1 text-sm text-muted-foreground">
                  {inSetup && pendingSummary ? "Step 3 of 3 · " : ""}
                  Signed in as {data.email}
                </p>
              )}
              {data && <div className="mt-2"><SeatSwitcher current={data.email} /></div>}
            </div>
            {data && (
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5 rounded-full"
                onClick={() => logout.mutate()}
                disabled={logout.isPending}
                data-testid="button-host-logout"
              >
                <LogOut className="h-3.5 w-3.5" />
                Sign out
              </Button>
            )}
          </div>
        )}

        {/* The nav down the left, like the admin's, with the page beside it.
            Hidden during first-time setup, where there is only one thing to
            do. */}
        <div className={data && hasProfile && !inSetup ? "lg:grid lg:grid-cols-[232px_minmax(0,1fr)] lg:gap-8" : ""}>
        {data && hasProfile && !inSetup && (
          <HostNav
            screen={screen === "claim" ? "dashboard" : screen}
            eventsCount={hostEvents?.length ?? 0}
            contactsCount={data?.contacts?.length ?? 0}
            pathFor={(sc) => hostScreenPath(sc)}
            onGo={(sc, feature) => { setProFeature(feature); goTo(sc); }}
            feature={proFeature}
            proOpen
          />
        )}
        <div className="min-w-0">

        {loadingProfile ? (
          <div className="mt-8 space-y-4">
            <Skeleton className="h-24 w-full rounded-xl" />
            <Skeleton className="h-48 w-full rounded-xl" />
          </div>
        ) : !data ? null : crewMode && crew ? (
          <section className="mt-6">
            <CrewDashboard
              crew={crew}
              email={data.email}
              onPickEvent={(id) => {
                setCrewEventId(id);
                try { localStorage.setItem("mv_crew_event", String(id)); } catch { /* fine */ }
              }}
            />
          </section>
        ) : inSetup || screen === "editProfile" ? (
          <section className="mt-6">
            {inSetup && (
              <p className="mb-6 max-w-2xl text-sm text-muted-foreground">
                Tell us about your show once. Your card on the public lineup is built from these details, and they
                move with you if you switch to a different time.
              </p>
            )}
            <ProfileForm
              email={data.email}
              variant={inSetup ? "setup" : "profile"}
              profile={hasProfile ? (profile ?? null) : null}
              pendingSlot={inSetup ? pendingSummary : null}
              onDirtyChange={setProfileDirty}
              onSaved={async (next) => {
                if (inSetup && pending) {
                  // Setup asks about the show in the same pass, but the show
                  // belongs to the event — so write that record before
                  // claiming, or the claim has no show to attach to.
                  try {
                    const fresh = await (await apiRequest("GET", "/api/host/profile")).json();
                    const eventId = pending.eventId || (await (await apiRequest("GET", "/api/events")).json())[0]?.id;
                    const fd = new FormData();
                    fd.append("showName", fresh?.podcastName ?? "");
                    fd.append("showFormat", fresh?.showFormat || "live");
                    fd.append("recordingUrl", fresh?.recordingUrl ?? "");
                    fd.append("introStyle", fresh?.introStyle || "virtual");
                    await apiUpload("PUT", `/api/host/shows/${eventId}`, fd);
                  } catch (err) {
                    toast({
                      title: "Couldn't set up your show",
                      description: (err as Error).message,
                      variant: "destructive",
                    });
                    return;
                  }
                  claim.mutate({ slotIndex: pending.slotIndex, eventId: pending.eventId || undefined });
                  return;
                }
                setProfileDirty(false);
                if (inSetup && next === "events") {
                  setScreen("events");
                } else if (inSetup) {
                  // They chose to stop here, but a profile alone gets nobody
                  // on air — say so once, with the way there.
                  setScreen("dashboard");
                  setRemindEventSetup(true);
                } else {
                  setScreen("dashboard");
                }
              }}
              onCancel={hasProfile ? () => setScreen("dashboard") : undefined}
            />
          </section>
        ) : screen === "recordings" ? (
          <RecordingsScreen socialAccounts={profile?.socialAccounts} />
        ) : screen === "integrations" ? (
          <section className="mt-6">
            {/* Posting accounts lead: nearly everyone has them, and they are
                what the clips and the follow buttons depend on. Going live on
                your own channel is the smaller, optional half, so it sits
                under. "Use your own gear" is out for now — it invites people
                to bring an encoder to an event that doesn't need one. */}
            <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.08em] text-foreground">
              <Link2 className="h-4 w-4" /> Posting accounts
            </h2>
            <p className="mb-4 max-w-2xl text-sm text-muted-foreground">
              Link the accounts you post from. Connected ones show as follow buttons on your card in the public
              lineup, and are where we can send clips after your slot.
            </p>
            {social?.accounts && social.accounts.length > 0 && (
              <div className="mb-6 rounded-2xl border border-border bg-card p-5">
                <ConnectedAccountsStrip accounts={social.accounts} />
              </div>
            )}
            {social?.configured && (
              <div className="mt-4 scroll-mt-24 border-t border-border pt-4" id="section-social-accounts" data-testid="section-social-accounts">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.08em] text-foreground">Social accounts</p>
                  <div className="flex items-center gap-1">
                    {social.accounts.length > 0 && (
                      <Button
                variant="ghost"
                size="sm"
                className="h-7 gap-1 px-2 text-xs"
                onClick={() => refreshSocial.mutate()}
                disabled={refreshSocial.isPending}
                data-testid="button-social-refresh"
                      >
                <RefreshCw className={`h-3 w-3 ${refreshSocial.isPending ? "animate-spin" : ""}`} /> Refresh
                      </Button>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 gap-1 rounded-full px-2.5 text-xs"
                      onClick={() => connectSocial.mutate()}
                      disabled={connectSocial.isPending}
                      data-testid="button-social-connect"
                    >
                      <Link2 className="h-3 w-3" />
                      {connectSocial.isPending ? "Opening…" : social.accounts.length ? "Manage" : "Connect accounts"}
                    </Button>
                  </div>
                </div>
                <SocialTiles accounts={social.accounts} onConnect={() => connectSocial.mutate()} connecting={connectSocial.isPending} />
                {social.accounts.length > 0 && profile && <AudienceConsent profile={profile} />}

                {/* Linkable on its own, because "go and connect your YouTube"
                    is a thing we say in emails and in the checklist, and
                    "Integrations, then scroll down" is a worse instruction
                    than a link that lands on it. */}
                <AnchoredHeading id="section-going-out-live" icon={Radio} label="Going out live" />
                <p className="mb-4 max-w-2xl text-sm text-muted-foreground">
                  Do you want your slot to go out on your own channel as well as ours? Optional — it airs on
                  MilitaryVoice.ai either way.
                </p>
                <ConnectYoutube
                  locked={noWayIn}
                  lockedReason="Claim a time slot first — the event is full at the moment."
                />
                {social.accounts.length === 0 && (
                  <p className="mt-2 text-sm text-muted-foreground">
                    Nothing linked yet. Connected accounts light up here and show as follow buttons on your card in the lineup.
                  </p>
                )}
              </div>
                    )}

          </section>
        ) : screen === "pro" ? (
          <ProScreen feature={proFeature} />
        ) : screen === "contacts" ? (
          <ContactsScreen contacts={data?.contacts ?? []} />
        ) : screen === "promotion" ? (
          <PromotionScreen contacts={data.contacts} />
        ) : screen === "events" ? (
          <EventSettings
            onOpenPromotion={() => setScreen("promotion")}
            profilePhotoUrl={profile?.photoUrl}
            onPickSlot={() => {
              setScreen("dashboard");
              setTimeout(
                () => document.getElementById("pick-slot")?.scrollIntoView({ behavior: "smooth", block: "start" }),
                60,
              );
            }}
          >
            {(entry) => (
              <>
            {/* One long scroll made everything read as the same thing. The work
                actually falls into three moments: before the day, on the day,
                and after — so the dashboard says so. */}
                {profile && entry.slotIndex != null && (
                  <div className="mt-6 flex flex-col gap-4">
                    {/* No wrapper: the panel was titled "Show materials" and
                        the section inside it "Media", which is two names for
                        one thing. ShowMaterials carries its own headings. */}
                    {/* The YouTube row moved out. Whether their slot also goes
                        to their own channel is an Integrations question, and
                        having it here too meant one setting with two homes. */}
                    <ShowMaterials profile={profile} showFormat={entry.show?.showFormat} interviewNeed={entry.show?.interviewNeed} />
                  </div>
                )}

                {/* The guide card used to sit here. Two prompts at the foot
                    of the page competed, and the one that matters is the one
                    that moves them on to promotion — /prepare is still linked
                    from the FAQ and the emails. */}
              </>
            )}
          </EventSettings>
        ) : screen === "claim" && selectedSlot ? (
          <section className="mt-8 max-w-xl">
            <button
              type="button"
              onClick={() => {
                setScreen("dashboard");
                setClaimIndex(null);
                clearPending();
              }}
              className="mb-4 flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
              data-testid="button-back-to-dashboard"
            >
              <ArrowLeft className="h-3.5 w-3.5" /> Back to dashboard
            </button>
            <h2 className="mb-1 flex items-center gap-2 text-lg font-semibold text-foreground">
              <Radio className="h-5 w-5 text-primary" />
              Claim this slot
            </h2>
            <p
              className={`tabular-nums text-sm text-muted-foreground ${
                isLiveOnlyBlock(selectedSlot.start, selectedSlot.end) ? "mb-2" : "mb-6"
              }`}
            >
              {formatDateInZone(selectedSlot.start, zone)}, {formatTimeInZone(selectedSlot.start, zone)}–
              {formatTimeInZone(selectedSlot.end, zone)} · {zoneLabel(zone)}
            </p>
            {isLiveOnlyBlock(selectedSlot.start, selectedSlot.end) && (
              <p className="mb-6 text-sm text-muted-foreground" data-testid="text-live-only-notice">
                This is a daytime slot. Everything between {LIVE_ONLY_LABEL} is broadcast live — a recorded episode
                can only go in an evening or overnight time.
              </p>
            )}

            <div className="rounded-xl border border-border bg-card p-5">
              <div className="flex items-center gap-4">
                {profile?.photoUrl && (
                  <img src={resolveUploadUrl(profile.photoUrl)} alt="" className="h-16 w-16 shrink-0 rounded-full object-cover" />
                )}
                <div>
                  <p className="font-semibold text-card-foreground">{profile?.podcastName}</p>
                  <p className="text-sm text-muted-foreground">{profile?.hostName}</p>
                </div>
              </div>
              {data.mySignups.length > 0 && (
                <p className="mt-4 rounded-lg border border-[#F0A71F]/50 bg-[#F0A71F]/10 p-3 text-sm text-foreground" data-testid="text-swap-notice">
                  You currently hold{" "}
                  {data.mySignups.map((m) => {
                    const st = slotStart(data.event.startAtUtc, data.event.slotMinutes, m.slotIndex);
                    return `${formatDateInZone(st, zone)} · ${formatTimeInZone(st, zone)}`;
                  }).join(", ")}
                  . Confirming moves you to this time and releases that one.
                </p>
              )}
              <p className="mt-4 text-sm text-muted-foreground">
                We'll use the details from your podcaster profile for this slot. Need to change something first?{" "}
                <button type="button" onClick={() => setScreen("editProfile")} className="text-primary underline-offset-2 hover:underline">
                  Open profile settings
                </button>
                .
              </p>
              <Button
                className="mt-5"
                onClick={() => claimIndex !== null && claim.mutate({ slotIndex: claimIndex, eventId: pending?.eventId || undefined })}
                disabled={claim.isPending}
                data-testid="button-confirm-claim"
              >
                {claim.isPending ? "Claiming…" : data.mySignups.length > 0 ? "Move to this slot" : "Confirm & claim slot"}
              </Button>
            </div>
          </section>
        ) : (
          <>
            {(() => {
              const mySlot = data.mySignups.length > 0
                ? {
                    start: slotStart(data.event.startAtUtc, data.event.slotMinutes, data.mySignups[0].slotIndex),
                    end: slotEnd(data.event.startAtUtc, data.event.slotMinutes, data.mySignups[0].slotIndex),
                  }
                : null;
              const greenRoomHref = data.mySignups.length > 0
                ? data.event.isFeatured === false && data.event.slug ? `/event/${data.event.slug}/studio` : "/studio"
                : null;
              const blocks = cohostBoard?.blocks ?? [];
              const cohost = blocks.length
                ? { open: blocks.filter((b) => !b.takenBy && !b.mine).length, mine: blocks.filter((b) => b.mine).length, total: blocks.length }
                : null;
              return (
                <>
                  <CommandCenter
                    firstName={(profile?.hostName || "").trim().split(/\s+/)[0] || "there"}
                    photoUrl={profile?.photoUrl ?? ""}
                    podcastName={profile?.podcastName ?? ""}
                    email={data.email}
                    serviceLine={[profile?.serviceStatus, profile?.branch].filter((v) => v && v !== "Not applicable").join(" · ")}
                    eventName={data.event.name.trim()}
                    eventStartUtc={data.event.startAtUtc}
                  />
                  {/* The accounts, with faces, sit over the bottom of the
                      dark card — the part of a dashboard worth looking at,
                      where four cards used to say four words. */}
                  <div className="relative z-10 -mt-8 px-3 sm:px-5">
                    <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
                      {social?.configured && (social.accounts?.length ?? 0) > 0 ? (
                        <ConnectedAccountsStrip accounts={social.accounts} onManage={() => goTo("integrations")} />
                      ) : (
                        <button type="button" onClick={() => goTo("integrations")} className="flex w-full items-center gap-3 text-left text-sm text-muted-foreground hover:text-foreground" data-testid="button-connect-accounts">
                          <Link2 className="h-4 w-4 text-[#053877]" /> Connect the accounts you post from — they show as follow buttons on your card, and we post your promo cards for you.
                          <ArrowRight className="ml-auto h-4 w-4" />
                        </button>
                      )}
                      <QuickDoors
                        greenRoomHref={greenRoomHref}
                        slotLabel={mySlot ? `${formatDateInZone(mySlot.start, zone)} · ${formatTimeInZone(mySlot.start, zone)}` : null}
                        shareUrl={data.mySignups[0] ? `${window.location.origin}/s/${data.mySignups[0].id}` : null}
                        agendaHref="/agenda"
                        onGo={(sc) => goTo(sc)}
                      />
                    </div>
                  </div>
                  {/* Three cards across, not one long strip: the slot, what is
                      left to do, and what happens on the day. */}
                  <div className="mt-6 grid gap-4 lg:grid-cols-3">
                    <div className="h-full rounded-2xl border border-border bg-card p-5" data-testid="section-your-slot">
                      <p className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-foreground">Your slot</p>
                      {data.mySignups.length === 0 ? (
                        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#053877]/20 bg-[#053877]/[0.035] px-4 py-3">
                          {/* A time belongs to an event and needs a show
                              attached to it, so the way in is the event, not a
                              list of times floating on the dashboard. */}
                          <p className="text-sm text-muted-foreground">
                            No time yet. Join an event and set your show up, then pick when you're on air.
                          </p>
                          <Button
                            size="sm"
                            className="gap-1.5 rounded-full"
                            onClick={() => setScreen("events")}
                            data-testid="button-jump-to-events"
                          >
                            <CalendarDays className="h-3.5 w-3.5" /> Event settings
                          </Button>
                        </div>
                      ) : (
                        <div className="flex flex-col gap-2">
                          {data.mySignups.map((s) => {
                            const st = slotStart(data.event.startAtUtc, data.event.slotMinutes, s.slotIndex);
                            const en = slotEnd(data.event.startAtUtc, data.event.slotMinutes, s.slotIndex);
                            return (
                              <div
                                key={s.id}
                                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-primary/30 bg-primary/5 px-4 py-3"
                                data-testid={`card-host-signup-${s.id}`}
                              >
                                <div className="min-w-0">
                                  <div className="tabular-nums text-base font-semibold text-card-foreground">
                                    {formatDateInZone(st, zone)} · {formatTimeInZone(st, zone)}–{formatTimeInZone(en, zone)}
                                  </div>
                                  <div className="text-xs text-foreground/80">
                                    {zoneLabel(zone)} · {data.event.name.trim()}
                                  </div>
                                </div>
                                <AlertDialog>
                                  <AlertDialogTrigger asChild>
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      className="gap-1.5 rounded-full text-destructive hover:text-destructive"
                                      data-testid={`button-edit-slot-${s.id}`}
                                    >
                                      <Trash2 className="h-3.5 w-3.5" /> Remove me from this slot
                                    </Button>
                                  </AlertDialogTrigger>
                                  <AlertDialogContent>
                                    <AlertDialogHeader>
                                      <AlertDialogTitle>Remove you from this slot?</AlertDialogTitle>
                                      <AlertDialogDescription>
                                        {formatDateInZone(st, zone)}, {formatTimeInZone(st, zone)}–{formatTimeInZone(en, zone)} goes back on
                                        the open schedule for anyone to claim. You can pick a different time right after. Fans who asked
                                        for a reminder on this slot won't be notified.
                                      </AlertDialogDescription>
                                    </AlertDialogHeader>
                                    <AlertDialogFooter>
                                      <AlertDialogCancel>Keep my slot</AlertDialogCancel>
                                      <AlertDialogAction
                                        className="gap-1.5 bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                        onClick={() => release.mutate(s.id)}
                                        data-testid={`button-release-slot-${s.id}`}
                                      >
                                        <Trash2 className="h-3.5 w-3.5" /> Remove me
                                      </AlertDialogAction>
                                    </AlertDialogFooter>
                                  </AlertDialogContent>
                                </AlertDialog>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                    <TodoStrip
                      todos={(() => {
                const t: { key: string; label: string; screen: "editProfile" | "promotion" | "integrations" | "events"; optional?: boolean }[] = [];
                const show = hostEvents?.find((e) => e.slotIndex != null)?.show ?? hostEvents?.[0]?.show ?? null;
                if (!show?.showName) t.push({ key: "show", label: "Set up your show", screen: "events" });
                if (show?.showFormat === "prerecorded" && !show.recordingUrl) t.push({ key: "file", label: "Send us your recorded episode", screen: "events" });
                if (!profile?.photoOriginalUrl) t.push({ key: "headshot", label: "Add a print-quality headshot", screen: "editProfile" });
                if ((social?.accounts?.length ?? 0) === 0) t.push({ key: "accounts", label: "Connect your social accounts", screen: "integrations" });
                if ((hostAssets?.length ?? 0) === 0 && !profile?.mediaAnswered) t.push({ key: "materials", label: "Upload an intro, outro or images", screen: "events" });
                if (!youtube?.connected) t.push({ key: "youtube", label: "Send your slot to your own YouTube", screen: "integrations", optional: true });
                return t;
              })()}
                      onGo={(sc) => goTo(sc)}
                      eventStartUtc={data.event.startAtUtc}
                      eventName={data.event.name.trim()}
                    />
                    <div className="h-full rounded-2xl border border-border bg-card p-5" data-testid="section-on-the-day">
                      <p className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-foreground">On the day</p>
                      {mySlot ? (
                        <>
                          <p className="text-sm text-foreground/85">
                            Come to the green room by <span className="font-semibold text-foreground tabular-nums">{formatTimeInZone(new Date(mySlot.start.getTime() - 15 * 60000), zone)}</span>, fifteen minutes before you're on. Alex brings you to the stage when it's your turn.
                          </p>
                          <div className="mt-3 flex flex-wrap gap-2">
                            {greenRoomHref && (
                              <a href={greenRoomHref} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-full border border-emerald-600 bg-white px-3.5 py-2 text-sm font-medium text-foreground hover:bg-emerald-50 dark:bg-card" data-testid="link-on-the-day-green-room">
                                <StudioIcon className="h-6 w-6 rounded-md" tone="green" /> Green room
                              </a>
                            )}
                            <Link href="/watch" className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3.5 py-2 text-sm font-medium text-foreground hover:border-[#053877]/40" data-testid="link-on-the-day-watch">
                              <PlayCircle className="h-4 w-4" /> Watch page
                            </Link>
                          </div>
                        </>
                      ) : (
                        <p className="text-sm text-foreground/85">Pick your slot and your green room link and call time appear here.</p>
                      )}
                    </div>
                  </div>
                </>
              );
            })()}

            {/* ------------------------------------------------ profile header */}
            <section className="mt-4" data-testid="card-profile-header">
              <div className="overflow-hidden rounded-2xl border border-border bg-card">
                <div className="p-5 sm:p-6">
                  <div className="min-w-0">

                    {/* The website / YouTube / RSS pills lived here, but
                        "where people can listen" is a Profile settings thing
                        now and they made the card read as a link dump. */}


                    {/* Only somebody on the lineup can co-host: the hour is
                        between shows, and you need a show to be between. */}
                    {data.mySignups.length > 0 && (
                      <div data-testid="section-cohost">
                        <CohostSlots eventId={data.event.id} zone={zone} />
                      </div>
                    )}

                  </div>
                </div>
              </div>
            </section>



          </>
        )}
        </div>
        </div>
      </div>

      {/* The same checklist as the section above, following them across every
          screen. The section is read once on the day they sign up and then
          never again — which is how most of the lineup reached three weeks
          out with no link, no media and no YouTube. */}
      {workspace && (
        <FloatingChecklist
          state={{
            hasShow: !!hostEvents?.some((e) => !!e.show?.showName),
            hasSlot: (data?.mySignups.length ?? 0) > 0,
            slotsOpen: !eventIsFull,
            hasAccounts: (social?.accounts?.length ?? 0) > 0,
            hasMaterials: (hostAssets?.length ?? 0) > 0 || Boolean(profile?.mediaAnswered),
            hasYouTube: Boolean(youtube?.connected),
          }}
          onGoEvents={() => goTo("events")}
          onGoIntegrations={() => goTo("integrations")}
          onGoPromotion={() => goTo("promotion")}
        />
      )}

      {/* Half-finished is the failure mode here: a profile and no show means
          no slot, and nobody chases it. Ask once, with the door open. */}
      <AlertDialog open={remindEventSetup} onOpenChange={setRemindEventSetup}>
        <AlertDialogContent data-testid="dialog-finish-event-setup">
          <AlertDialogHeader>
            <AlertDialogTitle>One more step to get on air</AlertDialogTitle>
            <AlertDialogDescription>
              Your profile is saved. It doesn't hold a time yet — for that, set your show up for an event and pick
              when you want to be on. It takes a minute.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-remind-later">I'll do it later</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setRemindEventSetup(false);
                setScreen("events");
              }}
              data-testid="button-remind-go-events"
            >
              Go to Event settings
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
