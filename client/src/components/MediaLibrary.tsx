import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { Film, Image as ImageIcon, Play, Square, Search } from "lucide-react";

// Everything the producer can put on the stage: the intros, outros, sponsor
// reels and slides the podcasters uploaded for their own slots, plus anything
// pasted in on the day. This is the payoff for asking them to send it ahead.

export interface MediaItem {
  id: number;
  label: string;
  kind: "image" | "video";
  url: string;
  owner: string;
  assetKind: string;
}

interface Props {
  adminGet: <T>(path: string) => Promise<T>;
  adminSend: (method: string, path: string, body?: unknown) => Promise<Response>;
  studioId: number | null;
  playingUrl: string;
  isPlaying: boolean;
  onChanged: () => void;
  /** Narrow the list when the deck asked for one kind specifically. */
  only?: "image" | "video";
  compact?: boolean;
}

export function MediaLibrary({ adminGet, adminSend, studioId, playingUrl, isPlaying, onChanged, only, compact }: Props) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [q, setQ] = useState("");
  const [link, setLink] = useState("");

  const { data } = useQuery<MediaItem[]>({
    queryKey: ["/api/admin/media"],
    queryFn: () => adminGet<MediaItem[]>("/api/admin/media"),
  });

  const play = useMutation({
    mutationFn: async (body: Record<string, unknown>) => adminSend("POST", "/api/admin/studio/media", { ...body, studioId }),
    onSuccess: () => {
      onChanged();
      queryClient.invalidateQueries({ queryKey: ["/api/admin/media"] });
    },
    onError: (e: Error) => toast({ title: "Couldn't put that on the stage", description: e.message, variant: "destructive" }),
  });

  const items = useMemo(() => {
    const all = (data ?? []).filter((m) => (only ? m.kind === only : true));
    const needle = q.trim().toLowerCase();
    return needle
      ? all.filter((m) => `${m.label} ${m.owner} ${m.assetKind}`.toLowerCase().includes(needle))
      : all;
  }, [data, q, only]);

  return (
    <div className="flex flex-col gap-3">
      {isPlaying && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border-2 border-[#ED1C24] bg-[#ED1C24]/10 p-3">
          <Play className="h-4 w-4 shrink-0 text-[#ED1C24]" />
          <p className="min-w-0 flex-1 text-sm font-medium">On the stage right now.</p>
          <Button
            size="sm"
            className="gap-1.5 rounded-full bg-[#ED1C24] text-white hover:bg-[#c81820]"
            onClick={() => play.mutate({ action: "stop" })}
            data-testid="button-media-stop"
          >
            <Square className="h-3.5 w-3.5" /> Back to the stage
          </Button>
        </div>
      )}

      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          className="pl-9"
          placeholder="Search by name, show or kind"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          data-testid="input-media-search"
        />
      </div>

      <div className={`flex flex-col gap-2 overflow-y-auto ${compact ? "max-h-[320px]" : "max-h-[420px]"}`}>
        {items.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            {data && data.length > 0
              ? "Nothing matches that."
              : "Nothing uploaded yet. Podcasters' intros and outros land here automatically."}
          </p>
        ) : (
          items.map((m) => {
            const live = isPlaying && m.url === playingUrl;
            return (
              <div
                key={m.id}
                className={`flex items-center gap-3 rounded-xl border p-3 ${
                  live ? "border-[#ED1C24]/50 bg-[#ED1C24]/5" : "border-border bg-background"
                }`}
                data-testid={`media-${m.id}`}
              >
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#053877] text-white">
                  {m.kind === "image" ? <ImageIcon className="h-4 w-4" /> : <Film className="h-4 w-4" />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold">{m.label}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    {m.owner} · {m.assetKind}
                  </div>
                </div>
                <Button
                  size="sm"
                  variant={live ? "outline" : "default"}
                  className="h-8 gap-1.5 rounded-full px-3 text-xs"
                  disabled={play.isPending}
                  onClick={() =>
                    play.mutate(live ? { action: "stop" } : { action: "play", url: m.url, kind: m.kind, label: m.label })
                  }
                  data-testid={`button-media-play-${m.id}`}
                >
                  {live ? <Square className="h-3 w-3" /> : <Play className="h-3 w-3" />}
                  {live ? "Stop" : "On stage"}
                </Button>
              </div>
            );
          })
        )}
      </div>

      <div className="flex gap-2">
        <Input
          placeholder="…or paste a link to play right now"
          value={link}
          onChange={(e) => setLink(e.target.value)}
          data-testid="input-media-link"
        />
        <Button
          variant="outline"
          className="shrink-0 rounded-full"
          disabled={!/^https?:\/\//i.test(link.trim()) || play.isPending}
          onClick={() => {
            const url = link.trim();
            play.mutate({
              action: "play",
              url,
              kind: /\.(png|jpe?g|gif|webp|avif)(\?|$)/i.test(url) ? "image" : "video",
              label: "",
            });
            setLink("");
          }}
          data-testid="button-media-play-link"
        >
          Play
        </Button>
      </div>
    </div>
  );
}
