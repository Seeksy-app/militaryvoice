import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { PlatformIcon, platformLabel, platformBackground } from "@/components/SocialIcons";
import type { SocialAccount } from "@shared/schema";
import { Loader2, Send, Square, RectangleVertical } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Copy, Check, Share2, ExternalLink } from "lucide-react";

// What a podcaster posts to bring their own audience. The link unfurls with
// their artwork and their time and lands on their card, so it does the
// persuading — nobody writes a good post about a URL that shows nothing.

function CopyRow({ label, value, testId, multiline = false }: { label: string; value: string; testId: string; multiline?: boolean }) {
  const { toast } = useToast();
  const [done, setDone] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setDone(true);
      setTimeout(() => setDone(false), 1800);
    } catch {
      toast({ title: "Couldn't copy", description: "Select the text and copy it by hand.", variant: "destructive" });
    }
  }

  return (
    <div>
      <Label className="text-xs font-semibold uppercase tracking-[0.08em] text-foreground">{label}</Label>
      <div className={`mt-1 flex gap-2 ${multiline ? "items-start" : "items-center"}`}>
        {multiline ? (
          <Textarea readOnly rows={5} value={value} className="text-sm leading-snug" data-testid={testId} />
        ) : (
          <Input readOnly value={value} className="font-mono text-xs" onFocus={(e) => e.currentTarget.select()} data-testid={testId} />
        )}
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="shrink-0 gap-1.5"
          onClick={copy}
          data-testid={`${testId}-copy`}
        >
          {done ? <Check className="h-3.5 w-3.5 text-primary" /> : <Copy className="h-3.5 w-3.5" />}
          {done ? "Copied" : "Copy"}
        </Button>
      </div>
    </div>
  );
}

export function ShareYourSlot({
  signupId,
  podcastName,
  whenLabel,
}: {
  signupId: number;
  podcastName: string;
  whenLabel: string;
}) {
  const { toast } = useToast();
  const origin = typeof window === "undefined" ? "https://www.militaryvoice.ai" : window.location.origin;
  const url = `${origin}/s/${signupId}`;

  // Post it for them: they pick accounts, we send the card we already made.
  const { data: social } = useQuery<{ configured: boolean; accounts: SocialAccount[] }>({
    queryKey: ["/api/host/social"],
    retry: false,
  });
  // Only the networks Upload-Post can post a still to; YouTube wants video.
  const PHOTO_PLATFORMS = ["instagram", "tiktok", "x", "linkedin", "facebook", "threads"];
  const connected = (social?.accounts ?? []).filter((a) => PHOTO_PLATFORMS.includes(a.platform));
  const [picked, setPicked] = useState<string[]>([]);
  const [variant, setVariant] = useState<"square" | "story">("square");

  const publish = useMutation({
    mutationFn: async () =>
      (await apiRequest("POST", "/api/host/share/publish", { platforms: picked, size: variant, caption })).json(),
    onSuccess: () => {
      setPicked([]);
      toast({
        title: "Sent to your accounts",
        description: "It can take a minute to appear. Check the post before you share it on.",
      });
    },
    onError: (err: Error) => toast({ title: "Couldn't post that", description: err.message, variant: "destructive" }),
  });

  const caption =
    `I'm live on National Military Podcast Day.\n\n` +
    `${podcastName} — ${whenLabel}, as part of the 24 Hour Podcastathon on MilitaryVoice.ai.\n\n` +
    `Set a reminder and tune in: ${url}`;

  const targets = [
    {
      key: "x",
      label: "X",
      href: `https://x.com/intent/tweet?text=${encodeURIComponent(caption)}`,
    },
    {
      key: "linkedin",
      label: "LinkedIn",
      // LinkedIn ignores prefilled text now; it reads the page's own tags.
      href: `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(url)}`,
    },
    {
      key: "facebook",
      label: "Facebook",
      href: `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`,
    },
  ];

  return (
    <section className="mt-6">
      <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.08em] text-foreground">
        <Share2 className="h-4 w-4" /> Share your slot
      </h2>

      <div className="overflow-hidden rounded-2xl border border-border bg-card">
        <div className="bg-[#053877] px-5 py-3.5 text-white">
          <p className="text-sm font-semibold">Bring your own audience</p>
          <p className="mt-0.5 text-xs text-white/85">
            This link shows your artwork and your time wherever you post it, and opens straight to your card on the
            lineup.
          </p>
        </div>

        <div className="grid gap-6 p-5 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="flex min-w-0 flex-col gap-4">
            <CopyRow label="Your share link" value={url} testId="input-share-link" />
            <CopyRow label="Ready-made post" value={caption} testId="input-share-caption" multiline />

            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.08em] text-foreground">Post it</p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {targets.map((t) => (
                  <a
                    key={t.key}
                    href={t.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-full bg-[#053877] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#06498f]"
                    data-testid={`button-share-${t.key}`}
                  >
                    <Share2 className="h-3.5 w-3.5" /> {t.label}
                  </a>
                ))}
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                Instagram and TikTok have no share-by-link — copy the post above and paste it there, or have us post
                it for you below.
              </p>
            </div>
          </div>

          {/* The card itself, because nobody trusts a link they can't see. */}
          <div className="lg:border-l lg:border-border lg:pl-6">
            <p className="text-xs font-semibold uppercase tracking-[0.08em] text-foreground">How it looks</p>
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 block overflow-hidden rounded-xl border border-border transition-colors hover:border-primary/40"
              data-testid="link-preview-share"
            >
              <img
                src={`/og/slot/${signupId}.jpg`}
                alt="Your link preview"
                width={1200}
                height={630}
                className="block w-full"
                loading="lazy"
              />
              <span className="flex items-center justify-between gap-2 bg-card px-3 py-2 text-xs text-muted-foreground">
                militaryvoice.ai
                <ExternalLink className="h-3 w-3" />
              </span>
            </a>
            <p className="mt-2 text-xs text-muted-foreground">
              Facebook, LinkedIn and X cache previews. If you posted this before today and it looks plain, run it
              through that platform's post inspector once.
            </p>
          </div>
        </div>

        {connected.length > 0 && (
          <div className="border-t border-border bg-[#053877]/[0.035] px-5 py-6">
            <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_240px]">
              <div className="min-w-0">
                <h3 className="text-base font-semibold text-foreground">Or let us post it for you</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  Pick the accounts, pick a shape, and we post the card with your ready-made caption. Nothing to
                  download or paste.
                </p>

                <div className="mt-5 grid gap-y-5 sm:grid-cols-[96px_minmax(0,1fr)] sm:items-center sm:gap-x-4">
                  <span className="text-xs font-semibold uppercase tracking-[0.08em] text-foreground">Accounts</span>
                  <div className="flex flex-wrap gap-2">
                    {connected.map((a) => {
                      const on = picked.includes(a.platform);
                      return (
                        <button
                          key={a.platform}
                          type="button"
                          aria-pressed={on}
                          onClick={() =>
                            setPicked((p) => (on ? p.filter((x) => x !== a.platform) : [...p, a.platform]))
                          }
                          className={`inline-flex items-center gap-2 rounded-full border-2 py-2 pl-2 pr-4 text-sm font-semibold transition-colors ${
                            on
                              ? "border-primary bg-primary text-primary-foreground"
                              : "border-border bg-card text-foreground hover:border-primary/50"
                          }`}
                          data-testid={`pick-platform-${a.platform}`}
                        >
                          <span
                            className="flex h-6 w-6 items-center justify-center rounded-full text-white"
                            style={{ background: platformBackground(a.platform) }}
                          >
                            <PlatformIcon platform={a.platform} className="h-3.5 w-3.5" />
                          </span>
                          {platformLabel(a.platform)}
                          {on && <Check className="h-4 w-4" />}
                        </button>
                      );
                    })}
                  </div>

                  <span className="text-xs font-semibold uppercase tracking-[0.08em] text-foreground">Shape</span>
                  <div className="inline-flex w-fit rounded-full border border-border bg-card p-1" role="radiogroup">
                    {(
                      [
                        { v: "square", label: "Square", hint: "feed posts", Icon: Square },
                        { v: "story", label: "Tall", hint: "stories & reels", Icon: RectangleVertical },
                      ] as const
                    ).map(({ v, label, hint, Icon }) => (
                      <button
                        key={v}
                        type="button"
                        role="radio"
                        aria-checked={variant === v}
                        onClick={() => setVariant(v)}
                        className={`inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-sm font-semibold transition-colors ${
                          variant === v ? "bg-[#053877] text-white" : "text-foreground hover:bg-[#053877]/[0.06]"
                        }`}
                        data-testid={`pick-size-${v}`}
                      >
                        <Icon className="h-4 w-4" />
                        {label}
                        <span className={`text-xs font-normal ${variant === v ? "text-white/75" : "text-muted-foreground"}`}>
                          {hint}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="mt-6 flex flex-wrap items-center gap-4">
                  <Button
                    type="button"
                    size="lg"
                    className="gap-2 rounded-full px-6"
                    disabled={picked.length === 0 || publish.isPending}
                    onClick={() => publish.mutate()}
                    data-testid="button-publish-card"
                  >
                    {publish.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                    {publish.isPending ? "Posting…" : "Post it for me"}
                  </Button>
                  <span className="text-sm text-muted-foreground">
                    {picked.length === 0
                      ? "Choose at least one account."
                      : `Goes to ${picked.map((p) => platformLabel(p as SocialAccount["platform"])).join(" and ")}.`}
                  </span>
                </div>
              </div>

              {/* The exact image that goes out, at a size you can actually read. */}
              <div className="flex flex-col items-center lg:items-start">
                <p className="self-start text-xs font-semibold uppercase tracking-[0.08em] text-foreground">What goes out</p>
                <div className="mt-2 flex h-[240px] w-full items-center justify-center rounded-xl border border-border bg-card">
                  <img
                    key={variant}
                    src={`/og/slot/${signupId}.jpg?size=${variant}`}
                    alt={`Your ${variant === "square" ? "square" : "tall"} card`}
                    className={`rounded-lg shadow-md ${variant === "square" ? "h-[208px] w-[208px]" : "h-[208px] w-[117px]"}`}
                  />
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
