import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Mic2, Users, LogOut, Download, Radio, Mail, KeyRound } from "lucide-react";
import { NavBar } from "@/components/NavBar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { SignupDialog } from "@/components/SignupDialog";
import { apiRequest, API_BASE } from "@/lib/queryClient";
import type { PublicEvent, PublicSignup } from "@shared/schema";
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

interface HostDashboardData {
  email: string;
  event: PublicEvent;
  signups: PublicSignup[];
  mySignups: HostSignup[];
  contacts: HostContact[];
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
  const queryClient = useQueryClient();
  const [claimIndex, setClaimIndex] = useState<number | null>(null);
  const zone = useMemo(detectLocalTimeZone, []);

  const { data, isLoading, isError } = useQuery<HostDashboardData>({
    queryKey: ["/api/host/dashboard"],
    retry: false,
  });

  const logout = useMutation({
    mutationFn: async () => apiRequest("POST", "/api/host/logout"),
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: ["/api/host/dashboard"] });
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

  const slots = data
    ? Array.from({ length: totalSlots(data.event.durationHours, data.event.slotMinutes) }, (_, i) => {
        const start = slotStart(data.event.startAtUtc, data.event.slotMinutes, i);
        const end = slotEnd(data.event.startAtUtc, data.event.slotMinutes, i);
        const signup = data.signups.find((s) => s.slotIndex === i && s.status !== "cancelled");
        return { index: i, start, end, signup };
      })
    : [];
  const openSlots = slots.filter((s) => !s.signup);
  const selected = slots.find((s) => s.index === claimIndex);

  return (
    <div className="min-h-screen">
      <NavBar />
      <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">Host dashboard</h1>
            {data && <p className="mt-1 text-sm text-muted-foreground">Signed in as {data.email}</p>}
          </div>
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
        </div>

        {isLoading ? (
          <div className="mt-8 space-y-4">
            <Skeleton className="h-24 w-full rounded-xl" />
            <Skeleton className="h-48 w-full rounded-xl" />
          </div>
        ) : (
          <>
            <section className="mt-8">
              <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                <Mic2 className="h-4 w-4" />
                Your slot{data && data.mySignups.length !== 1 ? "s" : ""}
              </h2>
              {!data || data.mySignups.length === 0 ? (
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

            {data && (
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
                        onClick={() => setClaimIndex(s.index)}
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
            )}

            <section className="mt-8">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                  <Users className="h-4 w-4" />
                  Fans who want a reminder ({data?.contacts.length ?? 0})
                </h2>
                {(data?.contacts.length ?? 0) > 0 && (
                  <a href={`${API_BASE}/api/host/export.csv`} data-testid="link-host-export-csv">
                    <Button variant="outline" size="sm" className="gap-1.5 rounded-full">
                      <Download className="h-3.5 w-3.5" />
                      Export CSV
                    </Button>
                  </a>
                )}
              </div>

              {!data || data.contacts.length === 0 ? (
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

      {data && (
        <SignupDialog
          open={claimIndex !== null}
          onOpenChange={(open) => !open && setClaimIndex(null)}
          slotIndex={claimIndex}
          start={selected?.start ?? null}
          end={selected?.end ?? null}
          viewZone={zone}
          eventId={data.event.id}
          lockedEmail={data.email}
        />
      )}
    </div>
  );
}
