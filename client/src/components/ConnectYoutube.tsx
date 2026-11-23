import { useEffect, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Check, Loader2, Sparkles } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { BrandMark } from "@/components/BrandMark";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { showGuide } from "@/components/Guide";
import { useGuideFace } from "@/components/LoriGuide";

// YouTube Live by the podcaster's own stream key (Andrew, 22 Nov 2026: "Yes, one connection"). Clips and episode
// videos go to YouTube through Upload-Post; this is only for going live: the studio's Go live and their Radio segment.
// It used to be our own Google sign-in; those connections keep working until the person saves a key here.

export interface YoutubeKeyStatus {
  saved: boolean;
  hint: string;
  legacy: { channelTitle: string; scope: "segment" | "show" } | null;
  /** Connect YouTube (Google) is offered: admins while Google verifies the app, everyone once it's approved. */
  canConnect?: boolean;
}

/** Google's answer after Connect YouTube, as a toast, once (the callback adds ?youtube=…). */
export function useYoutubeConnectResult() {
  const { toast } = useToast();
  const qc = useQueryClient();
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const r = q.get("youtube");
    if (!r) return;
    q.delete("youtube");
    window.history.replaceState(null, "", `${window.location.pathname}${q.size ? `?${q}` : ""}${window.location.hash}`);
    void qc.invalidateQueries({ queryKey: YOUTUBE_KEY_QUERY });
    void qc.invalidateQueries({ queryKey: ["/api/host/my-studio"] });
    if (r === "connected") toast({ title: "YouTube connected", description: "Your shows go live on your channel." });
    else if (r === "noChannel") toast({ title: "That Google account has no YouTube channel", description: "Try again and pick the account that owns your channel.", variant: "destructive" });
    else toast({ title: "YouTube didn't connect", description: "Try again, or paste a stream key instead.", variant: "destructive" });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
}

/** The one-click way in: Google's sign-in, then back to where they started. */
export const youtubeConnectHref = (then: "integrations" | "studio" = "integrations") => `/api/host/youtube/start?then=${then}`;
export const YOUTUBE_KEY_QUERY = ["/api/host/youtube-key"];

/** Where the key is, in one line, with the whole walkthrough behind it: the same words here and in Go live. */
export function YoutubeKeyHowTo({ className = "" }: { className?: string }) {
  return (
    <p className={`text-[13px] leading-relaxed text-[#475467] ${className}`}>
      Where it is: <b>YouTube Studio → Create → Go live → Stream</b>. Copy the <b>stream key</b> (the default one) and turn on <b>Auto-start</b>.{" "}
      <YoutubeKeyHelp />
    </p>
  );
}

// Andrew, 22 Nov 2026: "we definitely are gonna have to put an explainer on there … if we can get Frank to do it, then we
// can get anybody to do it." The one-liner above is the summary; this is the part people actually get stuck on. Nothing
// here is a second way of doing the job — it points at the same paste box.
const KEY_STEPS: { lead: string; rest: ReactNode }[] = [
  { lead: "Open YouTube Studio", rest: <>in another tab — <span className="whitespace-nowrap">youtube.com/dashboard</span>.</> },
  { lead: "Top right, press Create,", rest: <>then <b>Go live</b>.</> },
  { lead: "On the left, choose Stream.", rest: <>Under <b>Stream settings</b> you’ll see <b>Stream key</b>. Press <b>Copy</b>.</> },
  { lead: "Come back here,", rest: <>paste it, and press <b>Save key</b>.</> },
];

/** Where the walkthrough points once the sheet is out of the way: our own two controls, never YouTube’s. */
const KEY_GUIDE = [
  { title: "Your stream key", at: [{ sel: '[data-testid="youtube-key-input"]', text: "Paste the key you copied from YouTube Studio in here. We keep it sealed." }] },
  { at: [{ sel: '[data-testid="youtube-key-save"]', text: "Press Save key, and you’re done. Next time you’re on air, your channel goes live with you." }] },
];

/** "Show me how": the four steps, the toggle everybody misses, and the one thing that bites a first-timer. */
export function YoutubeKeyHelp() {
  const [open, setOpen] = useState(false);
  const { data } = useYoutubeKey();
  const who = useGuideFace();
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <button type="button" className="font-semibold text-[#053877] underline decoration-[#98a2b3] underline-offset-2 dark:text-white" data-testid="youtube-key-help">Show me how</button>
      </SheetTrigger>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader className="text-left">
          <SheetTitle>Find your YouTube stream key</SheetTitle>
          <SheetDescription>One paste, once. It takes about a minute.</SheetDescription>
        </SheetHeader>
        <ol className="mt-5 space-y-3.5" data-testid="youtube-key-steps">
          {KEY_STEPS.map((s, i) => (
            <li key={s.lead} className="flex gap-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#053877] text-[12px] font-bold text-white">{i + 1}</span>
              <p className="text-sm leading-relaxed text-foreground"><b>{s.lead}</b> {s.rest}</p>
            </li>
          ))}
        </ol>
        <div className="mt-5 rounded-xl bg-[#f9fafb] p-3.5 dark:bg-white/5">
          <p className="text-sm font-semibold text-foreground">While you’re in Stream settings</p>
          <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">Turn on <b>Auto-start</b> and <b>Auto-stop</b>. That’s what lets your channel go live by itself when we put you on air.</p>
        </div>
        <p className="mt-4 text-[13px] leading-relaxed text-muted-foreground">
          Your show goes out under your channel’s default title. Set that once in YouTube Studio and you never think about it again.
          {data?.canConnect && <> Or <a href={youtubeConnectHref("integrations")} className="font-semibold text-[#053877] hover:underline dark:text-white" data-testid="youtube-key-help-connect">connect with Google</a> instead, one click, and every show gets its own title.</>}
        </p>
        <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-[#fec84b] bg-[#fffcf5] p-3.5 dark:bg-[#fec84b]/5" data-testid="youtube-key-first-time">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[#dc6803]" />
          <p className="text-[13px] leading-relaxed text-[#475467] dark:text-muted-foreground">
            <b>Never been live on YouTube?</b> It has to be switched on for your channel first: in <b>Go live</b>, verify your phone, and YouTube then waits 24 hours. Do it today and you’re ready tomorrow — don’t find out on show day.
          </p>
        </div>
        <button type="button" onClick={() => { setOpen(false); showGuide(KEY_GUIDE, undefined, who ?? undefined); }}
          className="mt-5 flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-[#053877] text-sm font-bold text-white" data-testid="youtube-key-walkthrough">
          <Sparkles className="h-4 w-4" /> {who ? `Have ${who.name} show me` : "Show me on this page"}
        </button>
      </SheetContent>
    </Sheet>
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

/** Integrations → Live: YouTube. */
export function ConnectYoutube({ row = false }: { row?: boolean } = {}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data } = useYoutubeKey();
  const [changing, setChanging] = useState(false);
  useYoutubeConnectResult();
  const refresh = (s?: YoutubeKeyStatus) => {
    if (s) qc.setQueryData(YOUTUBE_KEY_QUERY, s); else void qc.invalidateQueries({ queryKey: YOUTUBE_KEY_QUERY });
    void qc.invalidateQueries({ queryKey: ["/api/host/my-studio"] });
    void qc.invalidateQueries({ queryKey: ["/api/host/youtube"] });
  };
  const remove = useMutation({
    mutationFn: async () => (await (await apiRequest("DELETE", "/api/host/youtube-key")).json()) as YoutubeKeyStatus,
    onSuccess: (s) => { refresh(s); toast({ title: "Stream key removed" }); },
    onError: (e: Error) => toast({ title: "Couldn't remove it", description: e.message, variant: "destructive" }),
  });
  const disconnect = useMutation({
    mutationFn: async () => { await apiRequest("DELETE", "/api/host/youtube"); },
    onSuccess: () => { refresh(); toast({ title: "YouTube disconnected" }); },
    onError: (e: Error) => toast({ title: "Couldn't disconnect", description: e.message, variant: "destructive" }),
  });
  if (!data) return null;
  const connect = !!data.canConnect;
  const pill = "flex items-center gap-1.5 rounded-full bg-[#d1fadf] px-3 py-1 text-[13px] font-bold text-[#067647]";
  const ghost = "h-8 rounded-full border border-[#d0d5dd] bg-white px-3.5 text-xs font-semibold hover:bg-[#f9fafb]";
  const channel = data.legacy?.channelTitle || "your channel";
  const line = data.saved
    ? `Stream key saved ${data.hint}`
    : data.legacy
      ? `Connected as ${channel}. Each show goes live on your channel under its own title.`
      : connect ? "One click with your Google account. Your shows go live on your channel, titled after the show." : "Your Radio segment and your studio's Go live also go out on your channel.";
  // With Connect offered, the key box is the small backup: it opens from "or paste a stream key".
  const showForm = connect ? changing : (!data.saved && !data.legacy) || changing;
  return (
    <section className={row ? "px-5 py-4" : "rounded-2xl border border-border bg-card p-6"} data-testid="youtube-live-row">
      {/* As a row in Live, it lines up with the rows around it: the same icon column, gap and title size. */}
      <div className={`flex flex-wrap items-center ${row ? "gap-x-3.5 gap-y-2" : "gap-3"}`}>
        {row ? <span className="flex w-12 shrink-0 justify-center"><BrandMark brand="youtube" tile /></span> : <BrandMark brand="youtube" tile />}
        <div className="min-w-0 flex-1 basis-[180px]">
          <div className={`${row ? "text-sm" : "text-base"} font-semibold text-card-foreground`}>YouTube Live</div>
          <p className="text-[13px] text-muted-foreground">{line}</p>
        </div>
        {data.saved && !changing && (
          <div className="flex items-center gap-1.5">
            <span className={pill}><Check className="h-3.5 w-3.5" /> Ready</span>
            <button type="button" onClick={() => setChanging(true)} className={ghost} data-testid="youtube-key-change">Change</button>
            <button type="button" onClick={() => remove.mutate()} disabled={remove.isPending} className="h-8 px-2 text-xs font-semibold text-[#667085] hover:text-[#b42318]" data-testid="youtube-key-remove">Remove</button>
          </div>
        )}
        {data.legacy && !changing && (
          <div className="flex items-center gap-1.5">
            <span className={pill}><Check className="h-3.5 w-3.5" /> Connected</span>
            <button type="button" onClick={() => disconnect.mutate()} disabled={disconnect.isPending} className={ghost} data-testid="youtube-disconnect">Disconnect</button>
          </div>
        )}
        {connect && !data.saved && !data.legacy && !changing && (
          <div className="flex flex-col items-end gap-1">
            <a href={youtubeConnectHref("integrations")} className="flex h-9 items-center rounded-full bg-[#053877] px-5 text-[13px] font-bold text-white shadow-sm hover:bg-[#042c5e]" data-testid="youtube-connect">Connect YouTube</a>
            <button type="button" onClick={() => setChanging(true)} className="text-[13px] font-semibold text-[#053877] underline decoration-[#98a2b3] underline-offset-2" data-testid="youtube-paste-key">or paste a stream key</button>
          </div>
        )}
      </div>
      <div className={row ? "sm:pl-[62px]" : "pl-[56px]"}>
        {data.saved && !changing && (
          <p className="mt-2 text-[13px] text-muted-foreground">
            It goes live under your channel's default title, set in YouTube Studio.
            {connect && <> <a href={youtubeConnectHref("integrations")} className="font-semibold text-[#053877] hover:underline" data-testid="youtube-connect-instead">Connect YouTube instead</a>, so each show gets its own title.</>}
          </p>
        )}
        {data.legacy && !changing && !connect && (
          <button type="button" onClick={() => setChanging(true)} className="mt-1.5 text-[13px] font-semibold text-[#053877] underline decoration-[#98a2b3] underline-offset-2" data-testid="youtube-switch-to-key">or use a stream key instead</button>
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
