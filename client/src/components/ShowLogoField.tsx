import { useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

// "Your show logo" (Andrew, 23 Nov 2026): one per account. It goes small in the top-right corner while they're live
// (Radio, events, their own Studio) and on Social's custom thumbnails. Without one, the corner uses their cover art.
// API: server/showLogo.ts. Self-contained, so it can sit wherever Show details wants it.

type ShowLogo = { logo: string; plate: "light" | "dark" | "none"; cover: string };
const KEY = ["/api/host/show-logo"];

export default function ShowLogoField() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const file = useRef<HTMLInputElement>(null);
  const q = useQuery<ShowLogo>({
    queryKey: KEY,
    queryFn: async () => {
      const r = await fetch("/api/host/show-logo", { credentials: "include" });
      if (!r.ok) throw new Error("Couldn't load your show logo.");
      return r.json();
    },
  });
  const send = useMutation({
    mutationFn: async (f: File | null) => {
      let r: Response;
      if (f) {
        const body = new FormData();
        body.append("file", f);
        r = await fetch("/api/host/show-logo", { method: "POST", body, credentials: "include" });
      } else {
        r = await fetch("/api/host/show-logo", { method: "DELETE", credentials: "include" });
      }
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.message || "That didn't save. Try again.");
      return j as ShowLogo;
    },
    onSuccess: (d, f) => {
      qc.setQueryData(KEY, d);
      toast({ title: f ? "Show logo saved" : "Show logo removed", description: f ? "It goes in the top corner when you're live." : d.cover ? "Your cover art goes in the corner instead." : undefined });
    },
    onError: (e: Error) => toast({ title: e.message, variant: "destructive" }),
  });

  const d = q.data;
  const shown = d?.logo || "";
  // No logo yet: the corner shows their cover art, so the preview does too (faded, with a line that says so).
  const fallback = !shown ? d?.cover || "" : "";
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4" data-testid="show-logo-field">
      {/* How it reads in the corner, over dark video and light video. */}
      <div className="flex shrink-0 self-start overflow-hidden rounded-xl ring-1 ring-black/10 sm:self-center" aria-hidden>
        {(["#0b1530", "#eef2f7"] as const).map((bg) => (
          <div key={bg} className="flex h-16 w-24 items-center justify-center p-2" style={{ background: bg }}>
            {shown ? (
              <span
                className="flex h-full max-w-full items-center rounded-md"
                style={d?.plate === "light" || d?.plate === "dark" ? { padding: "4px 6px", background: d.plate === "dark" ? "rgba(4,16,43,0.66)" : "rgba(255,255,255,0.9)" } : undefined}
              >
                <img src={shown} alt="" className="h-full w-auto max-w-full object-contain" />
              </span>
            ) : fallback ? (
              <img src={fallback} alt="" className="h-full w-auto rounded-md object-contain opacity-80" />
            ) : (
              <span className={`text-[11px] font-medium ${bg === "#0b1530" ? "text-white/50" : "text-slate-400"}`}>No logo</span>
            )}
          </div>
        ))}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-foreground">Your show logo</p>
        <p className="text-[13px] leading-snug text-muted-foreground text-pretty">A PNG with a clear background, square or wide. It goes small in the top corner when you're live.{fallback ? " Until you add one, your cover art goes\u00a0there." : ""}</p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <input
          ref={file}
          type="file"
          accept="image/png,image/svg+xml,image/webp,image/jpeg"
          className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) send.mutate(f); }}
          data-testid="show-logo-input"
        />
        <Button type="button" size="sm" onClick={() => file.current?.click()} disabled={send.isPending || q.isLoading} data-testid="show-logo-upload">
          {send.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
          {shown ? "Replace" : "Upload"}
        </Button>
        {shown && (
          <Button type="button" size="sm" variant="ghost" onClick={() => send.mutate(null)} disabled={send.isPending} data-testid="show-logo-remove">
            Remove
          </Button>
        )}
      </div>
    </div>
  );
}
