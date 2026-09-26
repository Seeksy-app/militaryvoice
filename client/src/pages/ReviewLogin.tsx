import { useState } from "react";
import { NavBar } from "@/components/NavBar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiRequest } from "@/lib/queryClient";

/** Sign-in for app-marketplace reviewers: the review account's email and password. Podcasters sign in with an emailed code instead. */
export default function ReviewLogin() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const go = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const r = await apiRequest("POST", "/api/review/login", { email, password });
      const j = (await r.json()) as { to: string };
      window.location.href = j.to;
    } catch (err) {
      setError((err as Error).message.replace(/^\d+:\s*/, "").replace(/^\{"message":"|"\}$/g, ""));
      setBusy(false);
    }
  };
  return (
    <div className="min-h-screen bg-background">
      <NavBar />
      <main className="mx-auto w-full max-w-md px-4 py-16">
        <h1 className="text-2xl font-bold tracking-tight">Reviewer sign-in</h1>
        <p className="mt-2 text-sm text-muted-foreground">For app-marketplace reviewers. Use the test account email and password from the submission. Podcasters sign in from their dashboard with an emailed code.</p>
        <form onSubmit={go} className="mt-6 flex flex-col gap-4 rounded-2xl border border-border bg-card p-6">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="review-email">Email</Label>
            <Input id="review-email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required data-testid="input-review-email" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="review-password">Password</Label>
            <Input id="review-password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required data-testid="input-review-password" />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" disabled={busy} className="rounded-full" data-testid="button-review-login">{busy ? "Signing in…" : "Sign in"}</Button>
        </form>
      </main>
    </div>
  );
}
