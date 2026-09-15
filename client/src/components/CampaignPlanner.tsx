import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { PlatformIcon, platformLabel, platformBackground } from "@/components/SocialIcons";
import type { SocialPlatform } from "@shared/schema";
import { CalendarCheck, Check, Loader2, Megaphone, AlertCircle } from "lucide-react";

// Six posts we've already designed for them. They tick the ones they want,
// pick the accounts, and we publish each on its date from their own account.

interface PlannedPost {
  kind: string;
  label: string;
  blurb: string;
  scheduledFor: string;
  past: boolean;
  selected: boolean;
  status: "planned" | "posting" | "posted" | "failed" | null;
  postedAt: string | null;
  error: string | null;
  caption: string;
  imageUrl: string;
}
interface Plan {
  configured: boolean;
  connected: SocialPlatform[];
  platforms: string[];
  posts: PlannedPost[];
}

function dateLabel(iso: string): string {
  return new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric" }).format(new Date(iso));
}

export function CampaignPlanner({ signupId }: { signupId: number }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const key = ["/api/host/campaign", signupId] as const;
  const { data, isLoading } = useQuery<Plan>({
    queryKey: key,
    queryFn: async () => (await apiRequest("GET", `/api/host/campaign?signupId=${signupId}`)).json(),
  });

  const [kinds, setKinds] = useState<string[]>([]);
  const [platforms, setPlatforms] = useState<string[]>([]);
  const [dirty, setDirty] = useState(false);

  // Mirror the saved plan until they start editing.
  useEffect(() => {
    if (!data || dirty) return;
    setKinds(data.posts.filter((p) => p.selected).map((p) => p.kind));
    setPlatforms(data.platforms.length ? data.platforms : data.connected);
  }, [data, dirty]);

  const save = useMutation({
    mutationFn: async () => (await apiRequest("PUT", "/api/host/campaign", { signupId, kinds, platforms })).json(),
    onSuccess: (r: { planned: number }) => {
      setDirty(false);
      queryClient.invalidateQueries({ queryKey: key });
      toast({
        title: r.planned === 0 ? "Plan cleared" : `${r.planned} post${r.planned === 1 ? "" : "s"} scheduled`,
        description: r.planned === 0 ? "Nothing will be posted." : "Anything already due goes out within the hour.",
      });
    },
    onError: (e: Error) => toast({ title: "Couldn't save the plan", description: e.message, variant: "destructive" }),
  });

  if (isLoading || !data) return null;

  const toggleKind = (k: string) => {
    setDirty(true);
    setKinds((cur) => (cur.includes(k) ? cur.filter((x) => x !== k) : [...cur, k]));
  };
  const togglePlatform = (p: string) => {
    setDirty(true);
    setPlatforms((cur) => (cur.includes(p) ? cur.filter((x) => x !== p) : [...cur, p]));
  };

  const canPost = data.configured && data.connected.length > 0;
  const picked = data.posts.filter((p) => kinds.includes(p.kind));
  const needsAccount = picked.length > 0 && platforms.length === 0;

  return (
    <section className="mt-6">
      <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.08em] text-foreground">
        <Megaphone className="h-4 w-4" /> Your posting plan
      </h2>

      <div className="overflow-hidden rounded-2xl border border-border bg-card">
        <div className="bg-[#053877] px-5 py-3.5 text-white">
          <p className="text-sm font-semibold">Six posts, already designed for you</p>
          <p className="mt-0.5 text-xs text-white/85">
            Your show, photo and time are on every one. Tick the ones you want and we post them from your accounts
            on the dates shown — nothing to download, nothing to remember.
          </p>
        </div>

        <div className="p-5">
          {/* Accounts */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <span className="text-xs font-semibold uppercase tracking-[0.08em] text-foreground">Post from</span>
            {canPost ? (
              <div className="flex flex-wrap gap-2">
                {data.connected.map((p) => {
                  const on = platforms.includes(p);
                  return (
                    <button
                      key={p}
                      type="button"
                      aria-pressed={on}
                      onClick={() => togglePlatform(p)}
                      className={`inline-flex items-center gap-2 rounded-full border-2 py-1.5 pl-1.5 pr-3.5 text-sm font-semibold transition-colors ${
                        on ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-foreground hover:border-primary/50"
                      }`}
                      data-testid={`campaign-platform-${p}`}
                    >
                      <span className="flex h-6 w-6 items-center justify-center rounded-full text-white" style={{ background: platformBackground(p) }}>
                        <PlatformIcon platform={p} className="h-3.5 w-3.5" />
                      </span>
                      {platformLabel(p)}
                      {on && <Check className="h-4 w-4" />}
                    </button>
                  );
                })}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                {data.connected.length > 0 ? "Posting from your accounts isn't switched on right now." : "No accounts connected yet."}{" "}
                <Link href="/host/dashboard?tab=integrations" className="font-medium text-primary hover:underline">
                  Connect Instagram, Facebook or LinkedIn
                </Link>{" "}
                and we can post these for you. You can still save the images below and post them yourself.
              </p>
            )}
          </div>

          {/* The six creatives */}
          <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {data.posts.map((p) => {
              const on = kinds.includes(p.kind);
              const done = p.status === "posted";
              const failed = p.status === "failed";
              return (
                <div
                  key={p.kind}
                  className={`overflow-hidden rounded-xl border-2 transition-colors ${
                    done ? "border-emerald-500/50" : on ? "border-primary" : "border-border"
                  }`}
                  data-testid={`campaign-card-${p.kind}`}
                >
                  <img src={p.imageUrl} alt={`${p.label} post`} className="block aspect-square w-full bg-[#053877] object-cover" loading="lazy" />
                  <div className="flex flex-col gap-2 p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-foreground">{p.label}</p>
                        <p className="text-xs text-muted-foreground">{p.blurb}</p>
                      </div>
                      <span
                        className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                          done
                            ? "bg-emerald-500/15 text-emerald-700"
                            : failed
                              ? "bg-destructive/10 text-destructive"
                              : p.past
                                ? "bg-[#F0A71F]/20 text-[#7a4e00]"
                                : "bg-[#053877]/[0.08] text-[#053877]"
                        }`}
                      >
                        {done ? `Posted ${dateLabel(p.postedAt!)}` : failed ? "Failed" : p.past ? "Right away" : dateLabel(p.scheduledFor)}
                      </span>
                    </div>
                    {failed && p.error && (
                      <p className="flex items-start gap-1 text-xs text-destructive">
                        <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" /> {p.error}
                      </p>
                    )}
                    <label className={`flex cursor-pointer items-center gap-2 text-sm font-medium ${done ? "text-muted-foreground" : "text-foreground"}`}>
                      <input
                        type="checkbox"
                        className="h-4 w-4 accent-[#053877]"
                        checked={on || done}
                        disabled={done || !canPost}
                        onChange={() => toggleKind(p.kind)}
                        data-testid={`campaign-pick-${p.kind}`}
                      />
                      {done ? "Already posted" : failed ? "Try again" : "Post this one"}
                    </label>
                  </div>
                </div>
              );
            })}
          </div>

          {canPost && (
            <div className="mt-5 flex flex-wrap items-center gap-4">
              <Button
                type="button"
                size="lg"
                className="gap-2 rounded-full px-6"
                disabled={!dirty || needsAccount || save.isPending}
                onClick={() => save.mutate()}
                data-testid="button-save-campaign"
              >
                {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CalendarCheck className="h-4 w-4" />}
                {save.isPending ? "Saving…" : "Save my plan"}
              </Button>
              <span className="text-sm text-muted-foreground">
                {needsAccount
                  ? "Pick at least one account to post from."
                  : picked.length === 0
                    ? "Nothing ticked — nothing gets posted."
                    : `${picked.length} post${picked.length === 1 ? "" : "s"} to ${platforms.map((p) => platformLabel(p as SocialPlatform)).join(", ")}.`}
              </span>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
