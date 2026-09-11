import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Bell, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

// Fan-facing "claim a slot to watch" flow: just an email, no account needed.
// Returns a short confirmation code the fan can hold onto, and also emails it
// to them via the same Resend integration used for host confirmations.
export function WatchSignupSection() {
  const [email, setEmail] = useState("");
  const [confirmationCode, setConfirmationCode] = useState<string | null>(null);
  const { toast } = useToast();

  const mutation = useMutation({
    mutationFn: async (email: string) => {
      const res = await apiRequest("POST", "/api/watch-signups", { email });
      return (await res.json()) as { confirmationCode: string };
    },
    onSuccess: (data) => {
      setConfirmationCode(data.confirmationCode);
    },
    onError: (err: Error) => {
      toast({
        title: "Couldn't sign you up",
        description: err.message.replace(/^\d+:\s*/, ""),
        variant: "destructive",
      });
    },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    mutation.mutate(email.trim());
  }

  return (
    <section className="mx-auto max-w-6xl px-4 py-8 sm:px-6" data-testid="section-watch-signup">
      <div className="overflow-hidden rounded-2xl border border-border bg-card">
        <div className="grid gap-6 p-6 sm:p-8 lg:grid-cols-[1fr_auto] lg:items-center">
          <div>
            <div className="mb-2 inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-[#F0A71F]">
              <Bell className="h-3.5 w-3.5" />
              Just watching?
            </div>
            <h2 className="text-xl font-bold tracking-tight text-foreground sm:text-2xl">
              Claim a slot to watch — no sign-up required
            </h2>
            <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted-foreground">
              Drop your email and we'll send a confirmation number so you never miss the marathon. No account, no
              password.
            </p>
          </div>

          <div className="w-full lg:w-[380px]">
            {confirmationCode ? (
              <div
                className="flex items-start gap-3 rounded-xl border border-[#F0A71F]/40 bg-[#F0A71F]/10 p-4"
                data-testid="text-watch-confirmation"
              >
                <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-[#F0A71F]" />
                <div>
                  <p className="text-sm font-medium text-foreground">You're on the list.</p>
                  <p className="mt-1 font-mono text-lg font-bold tracking-wider text-[#053877] dark:text-[#5AA9EE]">
                    {confirmationCode}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">We also emailed this to {email}.</p>
                </div>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="flex flex-col gap-2 sm:flex-row" data-testid="form-watch-signup">
                <Input
                  type="email"
                  required
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="sm:flex-1"
                  data-testid="input-watch-email"
                />
                <Button type="submit" disabled={mutation.isPending} className="rounded-full" data-testid="button-watch-submit">
                  {mutation.isPending ? "Signing up…" : "Notify me"}
                </Button>
              </form>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
