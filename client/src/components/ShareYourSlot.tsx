import { useState } from "react";
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
  const origin = typeof window === "undefined" ? "https://www.militaryvoices.ai" : window.location.origin;
  const url = `${origin}/s/${signupId}`;

  const caption =
    `I'm live on National Military Podcast Day.\n\n` +
    `${podcastName} — ${whenLabel}, as part of the Podcast Marathon on MilitaryVoice.ai.\n\n` +
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
                Instagram and TikTok have no share-by-link — copy the post above and paste it there, or tick it in your
                posting plan below.
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
                militaryvoices.ai
                <ExternalLink className="h-3 w-3" />
              </span>
            </a>
            <p className="mt-2 text-xs text-muted-foreground">
              Facebook, LinkedIn and X cache previews. If you posted this before today and it looks plain, run it
              through that platform's post inspector once.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
