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
          <Textarea readOnly rows={4} value={value} className="text-sm" data-testid={testId} />
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
  const origin = typeof window === "undefined" ? "https://www.militaryvoice.ai" : window.location.origin;
  const url = `${origin}/s/${signupId}`;

  const caption =
    `I'm live on National Military Podcast Day.\n\n` +
    `${podcastName} — ${whenLabel}, as part of the 24 Hour Podcastathon on MilitaryVoice.ai.\n\n` +
    `Set a reminder and tune in: ${url}`;

  async function nativeShare() {
    if (navigator.share) {
      await navigator.share({ title: podcastName, text: caption, url }).catch(() => {});
    } else {
      await navigator.clipboard.writeText(caption).catch(() => {});
    }
  }

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

        <div className="flex flex-col gap-5 p-5">
          <CopyRow label="Your share link" value={url} testId="input-share-link" />
          <CopyRow label="Ready-made post" value={caption} testId="input-share-caption" multiline />

          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" className="gap-1.5 rounded-full" onClick={nativeShare} data-testid="button-share-slot">
              <Share2 className="h-4 w-4" /> Share
            </Button>
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3.5 py-2 text-sm font-medium hover:bg-[#053877]/[0.04]"
              data-testid="link-preview-share"
            >
              Preview it <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </div>

          <p className="text-xs text-muted-foreground">
            Facebook, LinkedIn and X cache link previews. If you posted this link before today and it looks plain,
            re-share it or run it through that platform's post inspector once.
          </p>
        </div>
      </div>
    </section>
  );
}
