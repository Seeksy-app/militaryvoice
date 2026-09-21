import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Info, Mic2, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";
import { formatTimeInZone } from "@/lib/schedule";

interface Block {
  index: number;
  startAtUtc: string;
  endAtUtc: string;
  mine: boolean;
  yourShow: boolean;
  takenBy: { firstName: string; podcastName: string } | null;
}
interface Board { blockMinutes: number; blocks: Block[] }

/**
 * What co-hosting is, in the podcaster's own words before ours.
 *
 * Draft wording: the organisers will replace this with theirs. It says what
 * the hour involves, that a script comes with it, and the one rule.
 */
const WHAT_IT_MEANS =
  "An hour on the main stage with Alex, our producer, or with Riccoh, in the minutes between shows — " +
  "you introduce what's coming up, talk about the day, and keep it moving. " +
  "We'll send you a short script you can use or go your own way. " +
  "Take as many hours as you like — one person per hour, and not the hour your own show is on.";

/**
 * The broadcast day in hours, for a podcaster to take one.
 *
 * Everything the board knows is shown: who has each hour, which is theirs,
 * and which they cannot have. "Taken" on its own invites "by whom", so the
 * name is there.
 */
export function CohostSlots({ eventId, zone }: { eventId: number; zone: string }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const key = ["/api/host/cohost-slots", eventId];
  const { data, isLoading } = useQuery<Board>({
    queryKey: key,
    queryFn: async () => {
      const r = await fetch(`/api/host/cohost-slots/${eventId}`, { credentials: "include" });
      if (!r.ok) throw new Error("Could not load the co-host hours.");
      return r.json();
    },
  });

  const change = useMutation({
    mutationFn: async (v: { blockIndex: number; release: boolean }) => {
      const r = v.release
        ? await fetch(`/api/host/cohost-slots/${eventId}/${v.blockIndex}`, { method: "DELETE", credentials: "include" })
        : await fetch(`/api/host/cohost-slots/${eventId}`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            credentials: "include",
            body: JSON.stringify({ blockIndex: v.blockIndex }),
          });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(body?.message || "That didn't go through.");
      return body as Board;
    },
    onSuccess: (board, v) => {
      queryClient.setQueryData(key, board);
      toast({ title: v.release ? "Hour released" : "You're co-hosting ✓", description: v.release ? undefined : "We'll send you the script a few days before." });
    },
    onError: (err) => {
      toast({ title: "Not this time", description: (err as Error).message, variant: "destructive" });
      queryClient.invalidateQueries({ queryKey: key });
    },
  });

  const mine = data?.blocks.filter((b) => b.mine).length ?? 0;
  const open = data?.blocks.filter((b) => !b.takenBy && !b.mine).length ?? 0;

  return (
    <TooltipProvider delayDuration={150}>
      {/* The same amber as the green-room callout above it: this is the one
          thing on the page we are asking them to do, and it should not read
          like another settings block. */}
      <div className="rounded-2xl border-2 border-[#F0A71F] bg-[#F0A71F]/[0.07] p-4 sm:p-5" data-testid="cohost-card">
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <Mic2 className="h-5 w-5 text-[#7a5200]" />
        <p className="text-base font-bold tracking-tight text-foreground">Co-host Available Slots</p>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label="What does co-hosting mean?"
              className="rounded-full p-0.5 text-muted-foreground hover:text-foreground"
              data-testid="cohost-info"
            >
              <Info className="h-4 w-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-xs text-xs leading-relaxed">{WHAT_IT_MEANS}</TooltipContent>
        </Tooltip>
        {data && (
          <span className="text-xs text-muted-foreground">
            {mine > 0 ? `You have ${mine} hour${mine === 1 ? "" : "s"} · ` : ""}{open} of {data.blocks.length} still open
          </span>
        )}
      </div>
      {/* Hover is not a thing on a phone, so the sentences that matter are
          on the page as well as in the tooltip. */}
      <p className="mb-3 text-sm text-foreground/80">
        Take an hour — <strong>or several</strong> — on the main stage with Alex or Riccoh between shows. One person per hour,
        first come first served. Tap the info icon for what it involves.
      </p>

      {isLoading || !data ? (
        <Skeleton className="h-40 w-full rounded-xl" />
      ) : (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          {data.blocks.map((b) => {
            const st = new Date(b.startAtUtc);
            const en = new Date(b.endAtUtc);
            const time = `${formatTimeInZone(st, zone)}–${formatTimeInZone(en, zone)}`;
            const busy = change.isPending && change.variables?.blockIndex === b.index;
            if (b.mine) {
              return (
                <div key={b.index} className="flex flex-col gap-1.5 rounded-xl border-2 border-primary bg-background px-3 py-2.5" data-testid={`cohost-block-${b.index}`}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="tabular-nums text-sm font-semibold">{time}</span>
                    <Check className="h-4 w-4 text-primary" />
                  </div>
                  <span className="text-xs font-medium text-primary">You're co-hosting</span>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => change.mutate({ blockIndex: b.index, release: true })}
                    className="inline-flex items-center gap-1 self-start text-[11px] text-muted-foreground hover:text-destructive"
                    data-testid={`cohost-release-${b.index}`}
                  >
                    <X className="h-3 w-3" /> Give it back
                  </button>
                </div>
              );
            }
            if (b.yourShow) {
              return (
                <div key={b.index} className="flex flex-col gap-1 rounded-xl border border-dashed border-border bg-muted/30 px-3 py-2.5 text-muted-foreground" data-testid={`cohost-block-${b.index}`}>
                  <span className="tabular-nums text-sm font-semibold">{time}</span>
                  <span className="inline-flex items-center gap-1 text-xs"><Mic2 className="h-3 w-3" /> Your show is on</span>
                </div>
              );
            }
            if (b.takenBy) {
              return (
                <div key={b.index} className="flex flex-col gap-1 rounded-xl border border-border bg-muted/30 px-3 py-2.5" data-testid={`cohost-block-${b.index}`}>
                  <span className="tabular-nums text-sm font-semibold text-muted-foreground">{time}</span>
                  <span className="truncate text-xs text-muted-foreground">
                    {b.takenBy.firstName}{b.takenBy.podcastName ? ` · ${b.takenBy.podcastName}` : ""}
                  </span>
                </div>
              );
            }
            return (
              <div key={b.index} className="flex flex-col gap-1.5 rounded-xl border border-border bg-background px-3 py-2.5" data-testid={`cohost-block-${b.index}`}>
                <span className="tabular-nums text-sm font-semibold">{time}</span>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 self-start rounded-full px-3 text-xs"
                  disabled={busy}
                  onClick={() => change.mutate({ blockIndex: b.index, release: false })}
                  data-testid={`cohost-take-${b.index}`}
                >
                  {busy ? "…" : "Take this hour"}
                </Button>
              </div>
            );
          })}
        </div>
      )}
      </div>
    </TooltipProvider>
  );
}
