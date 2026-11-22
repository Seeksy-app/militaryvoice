import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { PlatformIcon } from "@/components/SocialIcons";

// YouTube Live by the podcaster's own stream key (Andrew, 22 Nov 2026: "Yes, one connection"). Clips and episode
// videos go to YouTube through Upload-Post; this is only for going live: the studio's Go live and their Radio segment.
// It used to be our own Google sign-in; those connections keep working until the person saves a key here.

export interface YoutubeKeyStatus {
  saved: boolean;
  hint: string;
  legacy: { channelTitle: string; scope: "segment" | "show" } | null;
}
export const YOUTUBE_KEY_QUERY = ["/api/host/youtube-key"];

/** Where the key is, in one line: the same words here and in the studio's Go live. */
export function YoutubeKeyHowTo({ className = "" }: { className?: string }) {
  return (
    <p className={`text-[13px] leading-relaxed text-[#475467] ${className}`}>
      Where it is: <b>YouTube Studio → Create → Go live → Stream</b>. Copy the <b>stream key</b> (the default one) and turn on <b>Auto-start</b>.
    </p>
  );
}

/** The paste box and Save. `onSaved` runs once the key is stored. */
export function YoutubeKeyForm({ onSaved, compact = false, autoFocus = false }: { onSaved?: () => void; compact?: boolean; autoFocus?: boolean }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [key, setKey] = useState("");
  const save = useMutation({
    mutationFn: async () => (await (await apiRequest("PUT", "/api/host/youtube-key", { key })).json()) as YoutubeKeyStatus,
    onSuccess: (s) => {
      qc.setQueryData(YOUTUBE_KEY_QUERY, s);
      void qc.invalidateQueries({ queryKey: ["/api/host/my-studio"] });
      setKey("");
      toast({ title: "YouTube stream key saved" });
      onSaved?.();
    },
    onError: (e: Error) => toast({ title: "Couldn't save that key", description: e.message, variant: "destructive" }),
  });
  return (
    <form onSubmit={(e) => { e.preventDefault(); if (key.trim()) save.mutate(); }} data-testid="youtube-key-form">
      <div className="flex gap-2">
        <input value={key} onChange={(e) => setKey(e.target.value)} type="password" autoComplete="off" spellCheck={false} autoFocus={autoFocus}
          placeholder={compact ? "YouTube stream key" : "Paste your YouTube stream key"} aria-label="YouTube stream key"
          className="h-10 min-w-0 flex-1 rounded-lg border border-[#d0d5dd] bg-white px-3 text-sm outline-none focus:border-[#053877] focus:ring-2 focus:ring-[#053877]/15" data-testid="youtube-key-input" />
        <button type="submit" disabled={!key.trim() || save.isPending} className="flex h-10 shrink-0 items-center gap-1.5 rounded-lg bg-[#053877] px-4 text-sm font-bold text-white disabled:opacity-50" data-testid="youtube-key-save">
          {save.isPending && <Loader2 className="h-4 w-4 animate-spin" />}{compact ? "Save" : "Save key"}
        </button>
      </div>
      <YoutubeKeyHowTo className="mt-2" />
    </form>
  );
}

export function useYoutubeKey() {
  return useQuery<YoutubeKeyStatus>({ queryKey: YOUTUBE_KEY_QUERY, queryFn: async () => (await apiRequest("GET", "/api/host/youtube-key")).json() });
}

/** Integrations → Live streaming. */
export function ConnectYoutube({ row = false }: { row?: boolean } = {}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data } = useYoutubeKey();
  const [changing, setChanging] = useState(false);
  const remove = useMutation({
    mutationFn: async () => (await (await apiRequest("DELETE", "/api/host/youtube-key")).json()) as YoutubeKeyStatus,
    onSuccess: (s) => { qc.setQueryData(YOUTUBE_KEY_QUERY, s); void qc.invalidateQueries({ queryKey: ["/api/host/my-studio"] }); toast({ title: "Stream key removed" }); },
    onError: (e: Error) => toast({ title: "Couldn't remove it", description: e.message, variant: "destructive" }),
  });
  if (!data) return null;
  const pill = "flex items-center gap-1.5 rounded-full bg-[#d1fadf] px-3 py-1 text-[13px] font-bold text-[#067647]";
  const line = data.saved ? `Stream key saved ${data.hint}` : data.legacy ? `Connected as ${data.legacy.channelTitle || "your channel"}` : "Your Radio segment and your studio's Go live also go out on your channel.";
  const showForm = (!data.saved && !data.legacy) || changing;
  return (
    <section className={row ? "px-5 py-4" : "rounded-2xl border border-border bg-card p-6"} data-testid="youtube-live-row">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-white" style={{ background: "#FF0000" }}>
          <PlatformIcon platform="youtube" className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-base font-semibold text-card-foreground">YouTube Live</div>
          <p className="text-[13px] text-muted-foreground">{line}</p>
        </div>
        {data.saved && !changing && (
          <div className="flex items-center gap-1.5">
            <span className={pill}><Check className="h-3.5 w-3.5" /> Ready</span>
            <button type="button" onClick={() => setChanging(true)} className="h-8 rounded-full border border-[#d0d5dd] px-3.5 text-xs font-semibold hover:bg-[#f9fafb]" data-testid="youtube-key-change">Change</button>
            <button type="button" onClick={() => remove.mutate()} disabled={remove.isPending} className="h-8 px-2 text-xs font-semibold text-[#667085] hover:text-[#b42318]" data-testid="youtube-key-remove">Remove</button>
          </div>
        )}
        {data.legacy && !changing && <span className={pill}><Check className="h-3.5 w-3.5" /> Connected</span>}
      </div>
      <div className="pl-[56px]">
        {data.saved && !changing && <p className="mt-2 text-[13px] text-muted-foreground">It goes live under your channel's default title, set in YouTube Studio.</p>}
        {data.legacy && !changing && (
          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl bg-[#f9fafb] px-3.5 py-2.5" data-testid="youtube-switch-note">
            <p className="min-w-0 flex-1 text-[13px] text-[#475467]">This still works. We're moving YouTube to a stream key: one less sign-in.</p>
            <button type="button" onClick={() => setChanging(true)} className="shrink-0 text-[13px] font-bold text-[#053877] hover:underline" data-testid="youtube-switch-to-key">Switch to a stream key</button>
          </div>
        )}
        {showForm && (
          <div className="mt-3">
            <YoutubeKeyForm onSaved={() => setChanging(false)} autoFocus={changing} />
            {changing && <button type="button" onClick={() => setChanging(false)} className="mt-1 text-[13px] font-semibold text-[#667085] hover:text-[#344054]">Cancel</button>}
          </div>
        )}
      </div>
    </section>
  );
}
