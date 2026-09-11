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
  Video,
  Presentation,
  Image as ImageIcon,
  MessageSquare,
  Link2,
  RefreshCw,
  CalendarClock,
  Pencil,
  Trash2,
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
import { SocialTiles } from "@/components/SocialTiles";
import { apiRequest, API_BASE, resolveUploadUrl } from "@/lib/queryClient";
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
      queryClient.invalidateQueries({ queryKey: ["/api/host/dashboard"] });
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
              <div className="font-mono text-base font-bold text-primary">
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
export default function HostDashboard() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const search = useSearch();
  const [screen, setScreen] = useState<"dashboard" | "editProfile" | "claim">("dashboard");
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
  const hasProfile = !!profile && !!profile.podcastName && !!profile.hostName && !!profile.photoUrl;

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
      <div className={`mx-auto px-4 py-10 sm:px-6 ${inSetup || screen === "editProfile" ? "max-w-6xl" : "max-w-4xl"}`}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">
              {inSetup ? "Set up your show" : screen === "editProfile" ? "Profile Settings" : "Podcaster Dashboard"}
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

        {loadingProfile ? (
          <div className="mt-8 space-y-4">
            <Skeleton className="h-24 w-full rounded-xl" />
            <Skeleton className="h-48 w-full rounded-xl" />
          </div>
        ) : !data ? null : inSetup || screen === "editProfile" ? (
          <section className="mt-6">
            {inSetup && (
              <p className="mb-6 max-w-2xl text-sm text-muted-foreground">
                Tell us about your show once. Every slot you claim from here on reuses these details, and your card on
                the public lineup is built from them.
              </p>
            )}
            <ProfileForm
              email={data.email}
              profile={hasProfile ? (profile ?? null) : null}
              pendingSlot={inSetup ? pendingSummary : null}
              onSaved={() => {
                if (inSetup && pending) {
                  claim.mutate({ slotIndex: pending.slotIndex, eventId: pending.eventId || undefined });
                } else {
                  setScreen("dashboard");
                }
              }}
              onCancel={hasProfile ? () => setScreen("dashboard") : undefined}
            />
          </section>
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
            <p className="mb-6 font-mono text-sm text-muted-foreground">
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
                          {profile?.numPeople === 2 && " and a co-host"}
                        </p>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        className="gap-1.5 rounded-full"
                        onClick={() => setScreen("editProfile")}
                        data-testid="button-profile-settings"
                      >
                        <Settings className="h-3.5 w-3.5" />
                        Profile Settings
                      </Button>
                    </div>

                    <dl className="mt-4 grid gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2">
                      <div className="flex min-w-0 items-center gap-2 text-muted-foreground">
                        <Mail className="h-3.5 w-3.5 shrink-0 text-primary" />
                        <dd className="truncate">{data.email}</dd>
                      </div>
                      {profile?.phone && (
                        <div className="flex items-center gap-2 text-muted-foreground">
                          <Phone className="h-3.5 w-3.5 shrink-0 text-primary" />
                          <dd>{profile.phone}</dd>
                        </div>
                      )}
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <Users className="h-3.5 w-3.5 shrink-0 text-primary" />
                        <dd>{profile?.numPeople === 2 ? "Two on the mic" : "Solo host"}</dd>
                      </div>
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <Radio className="h-3.5 w-3.5 shrink-0 text-primary" />
                        <dd>
                          {data.mySignups.length === 0
                            ? "No slot claimed yet"
                            : `${data.mySignups.length} slot${data.mySignups.length === 1 ? "" : "s"} on ${data.event.name.trim()}`}
                        </dd>
                      </div>
                    </dl>

                    {(profile?.socialLinks || profile?.rssUrl || profile?.youtubeUrl) && (
                      <div className="mt-4 flex flex-wrap gap-1.5">
                        {profile?.socialLinks && (
                          <a
                            href={toHref(profile.socialLinks)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1 text-xs font-medium text-foreground hover-elevate"
                            data-testid="link-profile-website"
                          >
                            <Globe className="h-3 w-3 text-primary" />
                            <span className="truncate">{linkLabel(profile.socialLinks)}</span>
                          </a>
                        )}
                        {profile?.youtubeUrl && (
                          <a
                            href={profile.youtubeUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1 text-xs font-medium text-foreground hover-elevate"
                            data-testid="link-profile-youtube"
                          >
                            <Youtube className="h-3 w-3 text-primary" /> YouTube
                          </a>
                        )}
                        {profile?.rssUrl && (
                          <a
                            href={profile.rssUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1 text-xs font-medium text-foreground hover-elevate"
                            data-testid="link-profile-rss"
                          >
                            <Rss className="h-3 w-3 text-primary" /> RSS feed
                          </a>
                        )}
                      </div>
                    )}

                    {social?.configured && (
                      <div className="mt-4 border-t border-border pt-4" data-testid="section-social-accounts">
                        <div className="mb-2 flex items-center justify-between gap-3">
                          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Social accounts</p>
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

                    <div className="mt-4 border-t border-border pt-4">
                      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Bringing to the show</p>
                      <div className="flex flex-wrap gap-1.5">
                        {profile?.hasVideoIntro && (
                          <Badge variant="secondary" className="gap-1 font-normal">
                            <Video className="h-3 w-3" /> Video intro
                          </Badge>
                        )}
                        {profile?.hasVideoOutro && (
                          <Badge variant="secondary" className="gap-1 font-normal">
                            <Video className="h-3 w-3" /> Video outro
                          </Badge>
                        )}
                        {profile?.hasSlides && (
                          <Badge variant="secondary" className="gap-1 font-normal">
                            <Presentation className="h-3 w-3" /> Slides
                          </Badge>
                        )}
                        {profile?.hasImages && (
                          <Badge variant="secondary" className="gap-1 font-normal">
                            <ImageIcon className="h-3 w-3" /> Images
                          </Badge>
                        )}
                        {profile?.needsInterviewer && (
                          <Badge variant="outline" className="gap-1 border-primary/40 font-normal text-primary">
                            <Users className="h-3 w-3" /> Interviewer requested
                          </Badge>
                        )}
                        {!profile?.hasVideoIntro && !profile?.hasVideoOutro && !profile?.hasSlides && !profile?.hasImages && !profile?.needsInterviewer && (
                          <span className="text-sm text-muted-foreground">Just the conversation — no extra media yet.</span>
                        )}
                      </div>
                      {profile?.notes && (
                        <p className="mt-3 flex items-start gap-2 text-sm text-muted-foreground">
                          <MessageSquare className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                          <span className="italic">{profile.notes}</span>
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </section>

            {/* ---------------------------------------------------- my slot */}
            <section className="mt-8">
              <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                <Mic2 className="h-4 w-4" />
                Your slot
              </h2>
              {data.mySignups.length === 0 ? (
                <div className="rounded-xl border border-border bg-card p-5 text-sm text-muted-foreground">
                  You don't have a claimed slot on this email yet — pick one below.
                </div>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2">
                  {data.mySignups.map((s) => {
                    const st = slotStart(data.event.startAtUtc, data.event.slotMinutes, s.slotIndex);
                    const en = slotEnd(data.event.startAtUtc, data.event.slotMinutes, s.slotIndex);
                    return (
                      <div
                        key={s.id}
                        className="relative overflow-hidden rounded-xl border border-primary/30 bg-card p-4"
                        data-testid={`card-host-signup-${s.id}`}
                      >
                        <div className="absolute inset-y-0 left-0 w-1 bg-primary" />
                        <div className="flex items-start justify-between gap-3 pl-2">
                          <div>
                            <div className="flex items-center gap-2">
                              <Radio className="h-3.5 w-3.5 text-primary" />
                              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                Slot #{s.slotIndex + 1} · {data.event.name.trim()}
                              </span>
                            </div>
                            <p className="mt-2 font-mono text-base font-semibold text-card-foreground">
                              {formatDateInZone(st, zone)} · {formatTimeInZone(st, zone)}–{formatTimeInZone(en, zone)}
                            </p>
                            <p className="text-sm text-muted-foreground">{zoneLabel(zone)}</p>
                          </div>
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 shrink-0 rounded-full text-muted-foreground hover:text-foreground"
                                aria-label="Change or release this slot"
                                title="Change or release this slot"
                                data-testid={`button-edit-slot-${s.id}`}
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Release this slot?</AlertDialogTitle>
                                <AlertDialogDescription>
                                  {formatDateInZone(st, zone)}, {formatTimeInZone(st, zone)}–{formatTimeInZone(en, zone)} goes back on the
                                  open schedule for anyone to claim. You can pick a different time right after. Fans who asked for a
                                  reminder on this slot won't be notified.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Keep my slot</AlertDialogCancel>
                                <AlertDialogAction
                                  className="gap-1.5 bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                  onClick={() => release.mutate(s.id)}
                                  data-testid={`button-release-slot-${s.id}`}
                                >
                                  <Trash2 className="h-3.5 w-3.5" /> Release slot
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>

            {/* ------------------------------------------------- open slots (only until they hold one) */}
            {data.mySignups.length === 0 && (
              <section className="mt-8">
                <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                  <Radio className="h-4 w-4" />
                  Claim a slot on {data.event.name}
                </h2>
                {openSlots.length === 0 ? (
                  <div className="rounded-xl border border-border bg-card p-5 text-sm text-muted-foreground">
                    Every slot is claimed right now — check back if plans change.
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {openSlots.map((s) => (
                      <button
                        key={s.index}
                        type="button"
                        onClick={() => {
                          setClaimIndex(s.index);
                          setScreen("claim");
                        }}
                        className="rounded-lg border border-border bg-card p-3 text-left text-sm transition-colors hover-elevate"
                        data-testid={`button-pick-slot-${s.index}`}
                      >
                        <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{formatDateInZone(s.start, zone)}</div>
                        <div className="font-mono font-semibold">
                          {formatTimeInZone(s.start, zone)}–{formatTimeInZone(s.end, zone)}
                        </div>
                        <Badge variant="outline" className="mt-1.5 text-primary border-primary/40">
                          Open
                        </Badge>
                      </button>
                    ))}
                  </div>
                )}
              </section>
            )}

            {/* --------------------------------------------------- reminders */}
            <section className="mt-8">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
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
                      <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
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
        )}
      </div>
    </div>
  );
}
