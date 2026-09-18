import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import type { ClipRow } from "@shared/schema";
import { Scissors, Download, Copy, Play, Info } from "lucide-react";

// What the studio cut out of a show while the next one was going out.
//
// The point of the panel is that nothing here was asked for. A podcaster
// finishes their half hour, goes to bed, and in the morning there are four
// posts with the words already in them. So the first thing it says is what
// they are, and the second is how to use them — not a file browser.

const SHAPES = [
  { key: "verticalUrl" as const, label: "Vertical", hint: "Reels, TikTok, Shorts" },
  { key: "squareUrl" as const, label: "Square", hint: "Feed posts" },
  { key: "url" as const, label: "Wide", hint: "YouTube, LinkedIn" },
];

function stamp(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function MyClips() {
  const { toast } = useToast();
  const [open, setOpen] = useState<number | null>(null);

  const { data: clips, isLoading } = useQuery<ClipRow[]>({
    queryKey: ["/api/host/clips"],
    queryFn: async () => (await apiRequest("GET", "/api/host/clips")).json(),
  });

  if (isLoading) return <p className="text-sm text-muted-foreground">Looking for your clips…</p>;

  if (!clips || clips.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-border bg-muted/20 p-5">
        <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <Scissors className="h-4 w-4 text-primary" /> No clips yet
        </p>
        <p className="mt-1 max-w-xl text-sm text-muted-foreground">
          After your slot, the studio reads back what was said, picks the moments that stand up on their own, and cuts
          each one three ways with the words in a subtitle file. They land here — usually within the hour, and you
          don't have to ask.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {clips.map((c) => {
        const expanded = open === c.id;
        return (
          <div key={c.id} className="overflow-hidden rounded-2xl border border-border bg-card" data-testid={`clip-${c.id}`}>
            <div className="flex flex-wrap items-start gap-4 p-4">
              <div className="min-w-0 flex-1">
                <p className="font-semibold leading-tight text-card-foreground">{c.title}</p>
                <p className="mt-0.5 text-xs tabular-nums text-muted-foreground">
                  {stamp(c.startSec)}–{stamp(c.endSec)} · {c.endSec - c.startSec}s
                </p>
                {c.caption && <p className="mt-2 max-w-2xl text-sm text-muted-foreground">{c.caption}</p>}
              </div>

              <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                {SHAPES.filter((s) => c[s.key]).map((s) => (
                  <a
                    key={s.key}
                    href={c[s.key]}
                    target="_blank"
                    rel="noreferrer"
                    title={s.hint}
                    className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs font-medium transition-colors hover:bg-[#053877]/[0.06]"
                    data-testid={`clip-${c.id}-${s.key}`}
                  >
                    <Download className="h-3 w-3" /> {s.label}
                  </a>
                ))}
                {c.caption && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-8 gap-1.5 rounded-full px-2.5 text-xs"
                    onClick={() =>
                      navigator.clipboard.writeText(c.caption).then(
                        () => toast({ title: "Caption copied" }),
                        () => {},
                      )
                    }
                  >
                    <Copy className="h-3 w-3" /> Caption
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8 gap-1.5 rounded-full px-2.5 text-xs"
                  onClick={() => setOpen(expanded ? null : c.id)}
                  data-testid={`clip-${c.id}-open`}
                >
                  <Play className="h-3 w-3" /> {expanded ? "Close" : "Watch"}
                </Button>
              </div>
            </div>

            {expanded && (
              <div className="border-t border-border bg-muted/20 p-4">
                <video
                  key={c.id}
                  src={c.verticalUrl || c.url || c.squareUrl}
                  controls
                  playsInline
                  className="mx-auto max-h-[60vh] w-auto rounded-xl bg-black"
                />
                {/* Said out loud, not buried: a podcaster should be able to
                    disagree with a pick, and they can only do that if they can
                    see what it was picked for. */}
                {c.reason && (
                  <p className="mx-auto mt-3 flex max-w-xl items-start gap-2 text-xs text-muted-foreground">
                    <Info className="mt-0.5 h-3 w-3 shrink-0" />
                    <span>{c.reason}</span>
                  </p>
                )}
                {c.subtitlesUrl && (
                  <p className="mt-3 text-center text-xs">
                    <a href={c.subtitlesUrl} target="_blank" rel="noreferrer" className="text-primary underline-offset-2 hover:underline">
                      Download the subtitles (.srt)
                    </a>
                  </p>
                )}
                {c.transcript && (
                  <p className="mx-auto mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground">{c.transcript}</p>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
