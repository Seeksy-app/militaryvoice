import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Mail, CheckCircle2, AlertCircle } from "lucide-react";
import { NavBar } from "@/components/NavBar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiRequest } from "@/lib/queryClient";

// Podcaster ("host") sign-in: enter the email you claimed your slot with,
// we email a one-time link. No password to manage. `expired` is passed by
// the /host/login-expired route when the server redirects here because a
// magic link was stale, reused, or invalid.
export default function HostLogin({ expired = false }: { expired?: boolean }) {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);

  const mutation = useMutation({
    mutationFn: async (email: string) => {
      await apiRequest("POST", "/api/host/request-link", { email });
    },
    onSuccess: () => setSent(true),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    mutation.mutate(email.trim());
  }

  return (
    <div className="min-h-screen">
      <NavBar />
      <div className="mx-auto flex max-w-md flex-col px-4 py-16 sm:px-6">
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Podcaster sign-in</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Enter the email you used to claim your slot. We'll send you a one-time sign-in link.
        </p>

        {expired && !sent && (
          <div
            className="mt-5 flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
            data-testid="text-link-expired"
          >
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            That sign-in link expired or was already used. Request a new one below.
          </div>
        )}

        {sent ? (
          <div
            className="mt-6 flex items-start gap-3 rounded-xl border border-primary/30 bg-accent p-4"
            data-testid="text-link-sent"
          >
            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
            <div>
              <p className="text-sm font-medium text-accent-foreground">Check your email</p>
              <p className="mt-1 text-sm text-muted-foreground">
                If {email} has a slot on file, a sign-in link is on its way. It works once and expires in 15
                minutes.
              </p>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="mt-6 space-y-4" data-testid="form-host-login">
            <div className="space-y-1.5">
              <Label htmlFor="host-email">Email</Label>
              <div className="relative">
                <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="host-email"
                  type="email"
                  required
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="pl-9"
                  data-testid="input-host-email"
                />
              </div>
            </div>
            <Button type="submit" disabled={mutation.isPending} className="w-full rounded-full" data-testid="button-host-request-link">
              {mutation.isPending ? "Sending…" : "Email me a sign-in link"}
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}
