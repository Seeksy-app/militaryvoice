import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Mic2, Users, LogOut, Download, Radio } from "lucide-react";
import { NavBar } from "@/components/NavBar";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { apiRequest, API_BASE } from "@/lib/queryClient";

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
  signups: HostSignup[];
  contacts: HostContact[];
}

export default function HostDashboard() {
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();

  const { data, isLoading, isError } = useQuery<HostDashboardData>({
    queryKey: ["/api/host/dashboard"],
    retry: false,
  });

  const logout = useMutation({
    mutationFn: async () => apiRequest("POST", "/api/host/logout"),
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: ["/api/host/dashboard"] });
      navigate("/host/login");
    },
  });

  if (isError) {
    return (
      <div className="min-h-screen">
        <NavBar />
        <div className="mx-auto max-w-md px-4 py-16 text-center sm:px-6">
          <p className="text-sm text-muted-foreground">Your session expired or you're not signed in.</p>
          <Button className="mt-4 rounded-full" onClick={() => navigate("/host/login")} data-testid="button-back-to-login">
            Sign in again
          </Button>
        </div>
      </div>
    );
  }

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
                Your slot{data && data.signups.length !== 1 ? "s" : ""}
              </h2>
              {!data || data.signups.length === 0 ? (
                <div className="rounded-xl border border-border bg-card p-5 text-sm text-muted-foreground">
                  You don't have a claimed slot on this email yet.
                </div>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2">
                  {data.signups.map((s) => (
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
    </div>
  );
}
