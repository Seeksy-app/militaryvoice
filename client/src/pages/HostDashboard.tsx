import { useEffect, useMemo, useState } from "react";
import { useSearch, Link } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Mic2,
  Users,
  LogOut,
  Download,
  Radio,
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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { ProfileForm, type PendingSlotSummary } from "@/components/ProfileForm";
import { ShowMaterials } from "@/components/ShowMaterials";
import { EventSettings } from "@/components/EventSettings";
import { RecordingsScreen } from "@/components/RecordingsScreen";
import { OwnEncoder } from "@/components/OwnEncoder";
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
function LoginCard({ pending }: { pending: PendingSlotSummary | null }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");

  const requestCode = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/host/request-code", { email });
      return res.json();
    },
    onSuccess: () => {
      setStep("code");
      toast({ title: "Check your email", description: "We sent a 6-digit code to sign you in." });
    },
    onError: (err: Error) => toast({ title: "Couldn't send that", description: err.message, variant: "destructive" }),
  });

  const verifyCode = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/host/verify-code", { email, code });
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
      for (const key of ["/api/host/dashboard", "/api/host/profile", "/api/host/social"]) {
        queryClient.resetQueries({ queryKey: [key] });
      }
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
              <Button type="submit" disabled={requestCode.isPending || !email.trim()} data-testid="button-request-code">
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
 * One section of Event settings. Everything for an event reads as a single
 * scroll — tabs hid two thirds of it behind a click — but each part folds
 * away so the page stays walkable.
 */
function EventPanel({
  title,
  hint,
  defaultOpen = false,
  children,
}: {
  title: string;
  hint?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-5 py-4 text-left hover:bg-[#053877]/[0.04]"
        data-testid={`panel-${title.toLowerCase().replace(/\s+/g, "-")}`}
      >
        {open ? (
          <ChevronDown className="h-4 w-4 shrink-0 text-[#053877]" />
        ) : (
          <ChevronRight className="h-4 w-4 shrink-0 text-[#053877]" />
        )}
        <span className="text-sm font-semibold uppercase tracking-[0.08em] text-foreground">{title}</span>
        {hint && <span className="hidden text-xs text-muted-foreground sm:inline">{hint}</span>}
      </button>
      {open && <div className="flex flex-col gap-6 border-t border-border bg-card px-5 pb-6 pt-5">{children}</div>}
    </section>
  );
}

export default function HostDashboard() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const search = useSearch();
  const [screen, setScreen] = useState<"dashboard" | "editProfile" | "events" | "recordings" | "integrations" | "fans" | "claim">("dashboard");
  const [profileDirty, setProfileDirty] = useState(false);
  const [remindEventSetup, setRemindEventSetup] = useState(false);

  // The nav is buttons, not links, so ProfileForm's own leave-guard (which
  // watches anchors and page unload) never sees these clicks.
  function goTo(next: typeof screen) {
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

  const { data: social } = useQuery<SocialStatus>({
    queryKey: ["/api/host/social"],
    retry: false,
    enabled: !!data,
  });

  // Public events list so the held slot can be described before sign-in.
  const { data: events } = useQuery<PublicEvent[]>({ queryKey: ["/api/events"] });

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

  const logout = useMutation({
    mutationFn: async () => apiRequest("POST", "/api/host/logout"),
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: ["/api/host/dashboard"] });
      queryClient.removeQueries({ queryKey: ["/api/host/profile"] });
      queryClient.removeQueries({ queryKey: ["/api/host/social"] });
      setScreen("dashboard");
      clearPending();
    },
  });

  const claim = useMutation({
    mutationFn: async (input: { slotIndex: number; eventId?: number }) => {
      if (!data) throw new Error("Not signed in");
      // One slot per podcaster: moving to a new time releases the current one first.
      for (const held of data.mySignups) {
        await apiRequest("DELETE", `/api/host/signups/${held.id}`);
      }
      const res = await apiRequest("POST", "/api/signups", {
        eventId: input.eventId || data.event.id,
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
  const inSetup = !!data && !loadingProfile && !hasProfile;

  return (
    <div className="min-h-screen">
      <NavBar />
      <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">
              {inSetup
                ? "Set up your show"
                : screen === "editProfile"
                  ? "Profile settings"
                  : screen === "events"
                    ? "Event settings"
                    : screen === "recordings"
                      ? "Recordings"
                      : screen === "integrations"
                        ? "Integrations"
                      : screen === "fans"
                        ? "Fans & contacts"
                      : "Podcaster Dashboard"}
            </h1>
            {data && (
              <p className="mt-1 text-sm text-muted-foreground">
                {inSetup && pendingSummary ? "Step 3 of 3 · " : ""}
                Signed in as {data.email}
              </p>
            )}
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

        {/* Two places to be, said plainly: one about them, one about an
            event. Everything else hangs off those. Hidden during first-time
            setup, where there is only one thing to do. */}
        {data && hasProfile && !inSetup && (
          <nav className="mt-6 grid grid-cols-2 gap-1 rounded-2xl border border-border bg-card p-1.5 shadow-sm sm:grid-cols-3 lg:grid-cols-6">
            {(
              [
                ["dashboard", "Dashboard", "Your card and slot"],
                ["editProfile", "Profile settings", "About you"],
                ["events", "Event settings", "Your shows and times"],
                ["recordings", "Recordings", "Yours after the show"],
                ["integrations", "Integrations", "Your connected accounts"],
                ["fans", "Fans & contacts", "Who asked for a reminder"],
              ] as const
            ).map(([value, label, hint]) => {
              const active = screen === value;
              return (
                <button
                  key={value}
                  type="button"
                  onClick={() => goTo(value)}
                  aria-current={active ? "page" : undefined}
                  className={`flex flex-col gap-0.5 rounded-xl px-2 py-2.5 transition-colors ${
                    active
                      ? "bg-[#053877] text-white shadow-sm"
                      : "bg-[#053877]/[0.05] text-foreground hover:bg-[#053877]/10"
                  }`}
                  data-testid={`nav-host-${value}`}
                >
                  <span className="text-sm font-semibold">{label}</span>
                  <span className="hidden text-[12px] font-normal opacity-70 sm:block">{hint}</span>
                </button>
              );
            })}
          </nav>
        )}

        {loadingProfile ? (
          <div className="mt-8 space-y-4">
            <Skeleton className="h-24 w-full rounded-xl" />
            <Skeleton className="h-48 w-full rounded-xl" />
          </div>
        ) : !data ? null : inSetup || screen === "editProfile" ? (
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
              <div className="mt-4 border-t border-border pt-4" data-testid="section-social-accounts">
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
                {social.accounts.length === 0 && (
                  <p className="mt-2 text-sm text-muted-foreground">
                    Nothing linked yet. Connected accounts light up here and show as follow buttons on your card in the lineup.
                  </p>
                )}
              </div>
                    )}

          </section>
        ) : screen === "fans" ? (
          <>
            {/* --------------------------------------------------- reminders */}
            <section className="mt-8">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.08em] text-foreground">
                  <Users className="h-4 w-4" />
                  Fans who want a reminder ({data.contacts.length})
                </h2>
                {data.contacts.length > 0 && (
                  <a href={`${API_BASE}/api/host/export.csv`} data-testid="link-host-export-csv">
                    <Button variant="outline" size="sm" className="gap-1.5 rounded-full">
                      <Download className="h-3.5 w-3.5" />
                      Export CSV
                    </Button>
                  </a>
                )}
              </div>

              {data.contacts.length === 0 ? (
                <div className="rounded-xl border border-border bg-card p-5 text-sm text-muted-foreground">
                  No fans have asked for a reminder yet. Share your agenda link to get the word out.
                </div>
              ) : (
                <div className="overflow-hidden rounded-xl border border-border bg-card">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border text-left text-xs uppercase tracking-[0.08em] text-foreground">
                        <th className="px-4 py-2.5 font-medium">Name</th>
                        <th className="px-4 py-2.5 font-medium">Email</th>
                        <th className="px-4 py-2.5 font-medium">Phone</th>
                        <th className="px-4 py-2.5 font-medium">Signed up</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.contacts.map((c) => (
                        <tr key={c.id} className="border-b border-border last:border-0" data-testid={`row-contact-${c.id}`}>
                          <td className="px-4 py-2.5 font-medium text-card-foreground">{c.name || "—"}</td>
                          <td className="px-4 py-2.5 text-card-foreground">{c.email}</td>
                          <td className="px-4 py-2.5 text-muted-foreground">{c.phone || "—"}</td>
                          <td className="px-4 py-2.5 text-muted-foreground">{new Date(c.createdAt).toLocaleDateString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </>
        ) : screen === "events" ? (
          <EventSettings
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
                    <EventPanel title="Show materials" hint="Files and show details" defaultOpen>
                      <ShowMaterials profile={profile} showFormat={entry.show?.showFormat} interviewNeed={entry.show?.interviewNeed} />
                    </EventPanel>

                    <EventPanel title="Stream" hint="Where it goes out">
                      <p className="text-[15px] text-foreground">
                        Do you want your slot to go out on your own channels as well as ours? Optional — it airs on
                        MilitaryVoice.ai either way.
                      </p>
                      <ConnectYoutube />
                      {/* Pushing your own live feed in is meaningless for a
                          pre-recorded slot: we're rolling your file, there is no
                          feed to send. Only offer it when the slot is live. */}
                      {entry.show?.showFormat !== "prerecorded" && <OwnEncoder />}
                    </EventPanel>

                  </div>
                )}

                {/* The guide is about getting ready for an event, so it reads
                    here rather than on the dashboard home. */}
                <section className="mt-2">
              <Link href="/prepare" data-testid="link-prepare-guide">
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-primary/25 bg-primary/5 p-5 transition-colors hover-elevate">
                  <div className="flex items-start gap-3">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                      <BookOpen className="h-4.5 w-4.5" />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-card-foreground">Getting ready for your slot</p>
                      <p className="mt-0.5 text-sm text-muted-foreground">
                        What to send us beforehand, how show day runs, and when to be in the studio.
                      </p>
                    </div>
                  </div>
                  <span className="inline-flex items-center gap-1 text-sm font-medium text-primary">
                    Read the guide <ArrowRight className="h-3.5 w-3.5" />
                  </span>
                </div>
              </Link>
                </section>
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
            <p className="mb-6 tabular-nums text-sm text-muted-foreground">
              {formatDateInZone(selectedSlot.start, zone)}, {formatTimeInZone(selectedSlot.start, zone)}–
              {formatTimeInZone(selectedSlot.end, zone)} · {zoneLabel(zone)}
            </p>

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
            {/* ------------------------------------------------ profile header */}
            <section className="mt-8" data-testid="card-profile-header">
              <div className="overflow-hidden rounded-2xl border border-border bg-card">
                <div className="h-1.5 bg-primary" />
                <div className="flex flex-col gap-5 p-5 sm:flex-row sm:items-start sm:p-6">
                  {profile?.photoUrl ? (
                    <img
                      src={resolveUploadUrl(profile.photoUrl)}
                      alt={profile.hostName}
                      className="h-24 w-24 shrink-0 rounded-full object-cover ring-4 ring-primary/10"
                    />
                  ) : (
                    <div className="flex h-24 w-24 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground">
                      <Mic2 className="h-8 w-8" />
                    </div>
                  )}

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h2 className="truncate text-xl font-bold tracking-tight text-card-foreground sm:text-2xl">{profile?.podcastName}</h2>
                        <p className="mt-0.5 text-sm text-muted-foreground">
                          Hosted by <span className="font-medium text-card-foreground">{profile?.hostName}</span>
                        </p>
                      </div>
                    </div>

                    <dl className="mt-4 flex flex-col gap-1.5 text-sm">
                      <div className="flex min-w-0 items-center gap-2 text-muted-foreground">
                        <Mail className="h-3.5 w-3.5 shrink-0 text-primary" />
                        <dd className="truncate">{data.email}</dd>
                      </div>
                      {(profile?.serviceStatus || profile?.branch) && (
                        <div className="flex min-w-0 items-center gap-2 text-muted-foreground">
                          <Shield className="h-3.5 w-3.5 shrink-0 text-primary" />
                          <dd className="truncate">
                            {[profile.serviceStatus, profile.branch].filter((v) => v && v !== "Not applicable").join(" · ")}
                          </dd>
                        </div>
                      )}
                      {profile?.phone && (
                        <div className="flex items-center gap-2 text-muted-foreground">
                          <Phone className="h-3.5 w-3.5 shrink-0 text-primary" />
                          <dd>{profile.phone}</dd>
                        </div>
                      )}
                    </dl>

                    {/* The website / YouTube / RSS pills lived here, but
                        "where people can listen" is a Profile settings thing
                        now and they made the card read as a link dump. */}

                    <div className="mt-4 border-t border-border pt-4" data-testid="section-your-slot">
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
                                  <div className="text-xs text-muted-foreground">
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

                    {/* Only once something is actually connected. The seven
                        grey "Not connected" tiles that used to sit here were a
                        third of the card saying nothing; three real accounts
                        with faces and follower counts earn the space. */}
                    {social?.configured && social.accounts.length > 0 && (
                      <div className="mt-4 border-t border-border pt-4" data-testid="section-social-accounts">
                        <ConnectedAccountsStrip
                          accounts={social.accounts}
                          onManage={() => goTo("integrations")}
                        />
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </section>


          </>
        )}
      </div>

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
