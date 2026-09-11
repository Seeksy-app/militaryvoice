import { useEffect, useMemo, useState } from "react";
import { useSearch } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Mic2, Users, LogOut, Download, Radio, Mail, KeyRound, UserCircle2, ArrowLeft, Settings, Phone, Globe, Rss, Youtube, Video, Presentation, Image as ImageIcon, MessageSquare, Link2, RefreshCw } from "lucide-react";
import { NavBar } from "@/components/NavBar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { ProfileForm } from "@/components/ProfileForm";
import { apiRequest, API_BASE, resolveUploadUrl } from "@/lib/queryClient";
import type { PublicEvent, PublicSignup, ProfileRow, SocialAccount } from "@shared/schema";
import { PlatformIcon, platformLabel } from "@/components/SocialIcons";
import { detectLocalTimeZone, slotStart, slotEnd, totalSlots, formatDateInZone, formatTimeInZone } from "@/lib/schedule";

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
  email: string;
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

function toHref(v: string): string {
  return /^https?:\/\//i.test(v) ? v : `https://${v}`;
}
function linkLabel(v: string): string {
  return v.replace(/^https?:\/\//i, "").replace(/^www\./i, "").replace(/\/$/, "");
}

function LoginCard() {
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
    <div className="mx-auto mt-16 max-w-sm px-4">
      <Card>
        <CardHeader>
          <div className="mb-1 flex items-center gap-2 text-primary">
            {step === "email" ? <Mail className="h-4 w-4" /> : <KeyRound className="h-4 w-4" />}
            <CardTitle className="text-base">Podcaster sign-in</CardTitle>
          </div>
          <CardDescription>
            {step === "email"
              ? "Enter your email and we'll send you a one-time code."
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
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                data-testid="input-host-email"
              />
              <Button type="submit" disabled={requestCode.isPending || !email.trim()} data-testid="button-request-code">
                {requestCode.isPending ? "Sending…" : "Send me a code"}
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
    </div>
  );
}

export default function HostDashboard() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [screen, setScreen] = useState<"dashboard" | "editProfile" | "claim">("dashboard");
  const [claimIndex, setClaimIndex] = useState<number | null>(null);
  const zone = useMemo(detectLocalTimeZone, []);

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
  const search = useSearch();
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
      setScreen("dashboard");
    },
  });

  const claim = useMutation({
    mutationFn: async (slotIndex: number) => {
      if (!data) throw new Error("Not signed in");
      const res = await apiRequest("POST", "/api/signups", { eventId: data.event.id, slotIndex });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/signups"] });
      queryClient.invalidateQueries({ queryKey: ["/api/host/dashboard"] });
      toast({ title: "You're on the schedule", description: "This slot is now yours — we'll be in touch before air time." });
      setScreen("dashboard");
      setClaimIndex(null);
    },
    onError: (err: Error) => {
      toast({ title: "Couldn't claim that slot", description: err.message, variant: "destructive" });
    },
  });

  if (isError) {
    return (
      <div className="min-h-screen">
        <NavBar />
        <LoginCard />
      </div>
    );
  }

  const loadingProfile = isLoading || (!!data && profileLoading);
  const hasProfile = !!profile && !!profile.podcastName && !!profile.hostName && !!profile.photoUrl;

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

  return (
    <div className="min-h-screen">
      <NavBar />
      <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">Podcaster Dashboard</h1>
            {data && <p className="mt-1 text-sm text-muted-foreground">Signed in as {data.email}</p>}
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
        ) : !data ? null : !hasProfile || screen === "editProfile" ? (
          <section className="mt-8 max-w-xl">
            <h2 className="mb-1 flex items-center gap-2 text-lg font-semibold text-foreground">
              {hasProfile ? <Settings className="h-5 w-5 text-primary" /> : <UserCircle2 className="h-5 w-5 text-primary" />}
              {hasProfile ? "Profile Settings" : "Set up your podcaster profile"}
            </h2>
            <p className="mb-6 text-sm text-muted-foreground">
              {hasProfile
                ? "Update your details below — they'll apply to every slot you claim from now on."
                : "Tell us a bit about your show once, and every slot you claim from here on reuses these details — no repeating yourself."}
            </p>
            <ProfileForm
              email={data.email}
              profile={profile ?? null}
              onSaved={() => setScreen("dashboard")}
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
              {formatTimeInZone(selectedSlot.end, zone)}
            </p>

            <div className="rounded-xl border border-border bg-card p-5">
              <div className="flex items-center gap-4">
                {profile?.photoUrl && (
                  <img
                    src={resolveUploadUrl(profile.photoUrl)}
                    alt=""
                    className="h-16 w-16 shrink-0 rounded-full object-cover"
                  />
                )}
                <div>
                  <p className="font-semibold text-card-foreground">{profile?.podcastName}</p>
                  <p className="text-sm text-muted-foreground">{profile?.hostName}</p>
                </div>
              </div>
              <p className="mt-4 text-sm text-muted-foreground">
                We'll use the details from your podcaster profile for this slot. Need to change something first?{" "}
                <button
                  type="button"
                  onClick={() => setScreen("editProfile")}
                  className="text-primary underline-offset-2 hover:underline"
                >
                  Open profile settings
                </button>
                .
              </p>
              <Button
                className="mt-5"
                onClick={() => claimIndex !== null && claim.mutate(claimIndex)}
                disabled={claim.isPending}
                data-testid="button-confirm-claim"
              >
                {claim.isPending ? "Claiming…" : "Confirm & claim slot"}
              </Button>
            </div>
          </section>
        ) : (
          <>
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
                        <h2 className="truncate text-xl font-bold tracking-tight text-card-foreground sm:text-2xl">
                          {profile?.podcastName}
                        </h2>
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
                        {social.accounts.length === 0 ? (
                          <p className="text-sm text-muted-foreground">
                            Link Instagram, TikTok, YouTube, X, and more. They'll show as follow buttons on your card in the lineup.
                          </p>
                        ) : (
                          <div className="flex flex-wrap gap-1.5">
                            {social.accounts.map((a) => {
                              const inner = (
                                <>
                                  <PlatformIcon platform={a.platform} className="h-3.5 w-3.5 text-primary" />
                                  <span className="truncate">{a.username ? `@${a.username}` : a.displayName || platformLabel(a.platform)}</span>
                                </>
                              );
                              const cls =
                                "inline-flex max-w-[14rem] items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1 text-xs font-medium text-foreground";
                              return a.url ? (
                                <a key={a.platform} href={a.url} target="_blank" rel="noopener noreferrer" className={`${cls} hover-elevate`} data-testid={`chip-social-${a.platform}`}>
                                  {inner}
                                </a>
                              ) : (
                                <span key={a.platform} className={cls} data-testid={`chip-social-${a.platform}`}>
                                  {inner}
                                </span>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    )}

                    <div className="mt-4 border-t border-border pt-4">
                      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Bringing to the show</p>
                      <div className="flex flex-wrap gap-1.5">
                        {profile?.hasVideoIntro && (
                          <Badge variant="secondary" className="gap-1 font-normal"><Video className="h-3 w-3" /> Video intro</Badge>
                        )}
                        {profile?.hasVideoOutro && (
                          <Badge variant="secondary" className="gap-1 font-normal"><Video className="h-3 w-3" /> Video outro</Badge>
                        )}
                        {profile?.hasSlides && (
                          <Badge variant="secondary" className="gap-1 font-normal"><Presentation className="h-3 w-3" /> Slides</Badge>
                        )}
                        {profile?.hasImages && (
                          <Badge variant="secondary" className="gap-1 font-normal"><ImageIcon className="h-3 w-3" /> Images</Badge>
                        )}
                        {profile?.needsInterviewer && (
                          <Badge variant="outline" className="gap-1 border-primary/40 font-normal text-primary"><Users className="h-3 w-3" /> Interviewer requested</Badge>
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

            <section className="mt-8">
              <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                <Mic2 className="h-4 w-4" />
                Your slot{data.mySignups.length !== 1 ? "s" : ""}
              </h2>
              {data.mySignups.length === 0 ? (
                <div className="rounded-xl border border-border bg-card p-5 text-sm text-muted-foreground">
                  You don't have a claimed slot on this email yet — pick one below.
                </div>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2">
                  {data.mySignups.map((s) => (
                    <div key={s.id} className="rounded-xl border border-border bg-card p-4" data-testid={`card-host-signup-${s.id}`}>
                      <div className="flex items-center gap-2">
                        <Radio className="h-3.5 w-3.5 text-primary" />
                        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          Slot #{s.slotIndex + 1}
                        </span>
                      </div>
                      <p className="mt-2 font-semibold text-card-foreground">{s.podcastName}</p>
                      <p className="text-sm text-muted-foreground">{s.hostName}</p>
                    </div>
                  ))}
                </div>
              )}
            </section>

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
                      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        {formatDateInZone(s.start, zone)}
                      </div>
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
                        <th className="px-4 py-2.5 font-medium">Email</th>
                        <th className="px-4 py-2.5 font-medium">Signed up</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.contacts.map((c) => (
                        <tr key={c.id} className="border-b border-border last:border-0" data-testid={`row-contact-${c.id}`}>
                          <td className="px-4 py-2.5 text-card-foreground">{c.email}</td>
                          <td className="px-4 py-2.5 text-muted-foreground">
                            {new Date(c.createdAt).toLocaleDateString()}
                          </td>
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
