import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { Film, Image as ImageIcon, Play, Square, Search, Trash2, GripVertical } from "lucide-react";

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

  // Delete, and drag to reorder. Reordering needs the whole list in view, so
  // it is off while a search or a kind filter narrows it.
  const remove = useMutation({
    mutationFn: async (id: number) => {
      const res = await adminSend("DELETE", `/api/admin/media/${id}`);
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.message ?? "Couldn't delete that.");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/media"] });
      onChanged();
    },
    onError: (e: Error) => toast({ title: "Couldn't delete that", description: e.message, variant: "destructive" }),
  });
  const [dragId, setDragId] = useState<number | null>(null);
  const [overId, setOverId] = useState<number | null>(null);
  const canDrag = !q.trim() && !only;
  const moveTo = (from: number, to: number) => {
    const list = [...(data ?? [])];
    const a = list.findIndex((m) => m.id === from);
    const b = list.findIndex((m) => m.id === to);
    if (a < 0 || b < 0 || a === b) return;
    const [moved] = list.splice(a, 1);
    list.splice(b, 0, moved);
    queryClient.setQueryData(["/api/admin/media"], list);
    void adminSend("POST", "/api/admin/media/order", { ids: list.map((m) => m.id) }).catch(() =>
      toast({ title: "Couldn't save the new order", variant: "destructive" }),
    );
  };

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
                draggable={canDrag}
                onDragStart={(e) => { setDragId(m.id); e.dataTransfer.effectAllowed = "move"; }}
                onDragOver={(e) => { if (dragId != null) { e.preventDefault(); setOverId(m.id); } }}
                onDragLeave={() => setOverId((o) => (o === m.id ? null : o))}
                onDrop={(e) => { e.preventDefault(); if (dragId != null) moveTo(dragId, m.id); setDragId(null); setOverId(null); }}
                onDragEnd={() => { setDragId(null); setOverId(null); }}
                className={`flex items-center gap-2.5 rounded-xl border p-2.5 transition-colors ${
                  live ? "border-[#ED1C24]/50 bg-[#ED1C24]/5" : overId === m.id && dragId !== m.id ? "border-[#053877] bg-[#053877]/[0.06]" : "border-border bg-background"
                } ${dragId === m.id ? "opacity-40" : ""}`}
                data-testid={`media-${m.id}`}
              >
                {canDrag && (
                  <GripVertical className="h-4 w-4 shrink-0 cursor-grab text-muted-foreground active:cursor-grabbing" aria-label="Drag to reorder" />
                )}
                <Thumb item={m} />
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
                <button
                  type="button"
                  className="shrink-0 rounded-lg p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-40"
                  disabled={live || remove.isPending}
                  title={live ? "Take it off the stage first" : "Delete from the library"}
                  aria-label={`Delete ${m.label}`}
                  onClick={() => { if (window.confirm(`Delete "${m.label}" from the media library? This can't be undone.`)) remove.mutate(m.id); }}
                  data-testid={`button-media-delete-${m.id}`}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
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

/** A small picture of the file: the image itself, or a video's opening frame. */
function Thumb({ item }: { item: MediaItem }) {
  const [broken, setBroken] = useState(false);
  const box = "relative h-12 w-20 shrink-0 overflow-hidden rounded-lg bg-[#053877] text-white";
  if (broken) {
    return (
      <div className={`${box} flex items-center justify-center`}>
        {item.kind === "image" ? <ImageIcon className="h-4 w-4" /> : <Film className="h-4 w-4" />}
      </div>
    );
  }
  return (
    <div className={box}>
      {item.kind === "image" ? (
        <img src={item.url} alt="" loading="lazy" onError={() => setBroken(true)} className="h-full w-full object-cover" />
      ) : (
        <>
          {/* #t=1 asks for the frame a second in, past any fade from black. */}
          <video src={`${item.url}#t=1`} preload="metadata" muted playsInline onError={() => setBroken(true)} className="h-full w-full object-cover" />
          <span className="absolute bottom-0.5 right-0.5 flex h-4 w-4 items-center justify-center rounded bg-black/60"><Play className="h-2.5 w-2.5 fill-white" /></span>
        </>
      )}
    </div>
  );
}
