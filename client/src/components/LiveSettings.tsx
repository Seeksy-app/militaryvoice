import { useEffect, useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, ExternalLink, Globe, Loader2, Trash2 } from "lucide-react";
import { IconTile } from "@/components/ui/icon-tile";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { BrandMark, BrandGroup } from "@/components/BrandMark";
import { ConnectYoutube } from "@/components/ConnectYoutube";
import { InfoTip } from "@/components/InfoTip";

/**
 * Integrations → Live streaming (Andrew, 22 Nov 2026: the one-place Live mockup; regrouped 24 Nov into going out and
 * coming in, mockup approved "Yes, build it").
 * - Where it goes: their MilitaryVoices live page (a switch), YouTube (their stream key), Facebook, LinkedIn and
 *   Instagram (each its own row) and any other site's key. Under it, one line on the logo in the corner (23 Nov).
 * - StreamInBlock (exported, shown under Integrations → Recordings): StreamYard, Restream or OBS send to us; it records
 *   to the Library and, unless they untick it, goes live on their page and on to the places above.
 * Posting episodes and clips to YouTube is Upload-Post, under Social media; it can't go live, hence a key here.
 */

type LivePage = { on: boolean; url: string; handle: string; photo?: string; streamInOut: boolean; live: boolean };
const LIVE_PAGE = ["/api/host/live-page"];
type StudioKeys = { streams: { id: string; name: string; on: boolean; key?: string }[] };
const MY_STUDIO = ["/api/host/my-studio"];
type StreamInState = "unused" | "receiving" | "working" | "problem";
type StreamIn = { configured: boolean; key: { url: string; streamKey: string; status: "idle" | "live" | "paused"; arriving: boolean; pausedWhy: string; problem: string; state: StreamInState; lastAt: string; lastWasTest: boolean; testUntil: string } | null; usage: { usedMin: number; capMin: number } };
const STREAM_IN = ["/api/host/stream-in"];

const FACEBOOK_RTMP = "rtmps://live-api-s.facebook.com:443/rtmp/";
const NAVY = "#053877";
const ghost = "h-8 shrink-0 rounded-full border border-[#d0d5dd] bg-white px-3.5 text-xs font-semibold text-[#344054] hover:bg-[#f9fafb] disabled:opacity-50 dark:bg-transparent dark:text-foreground";
const mvTile = <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-[13px] font-extrabold tracking-tight text-white" style={{ background: NAVY }}>MV</span>;

/** Their own page wears their own picture, the one on their SmartLink and live page (Andrew, 23 Nov: "Please make ICON
    for MilitaryVoices the Profile image"); the MV tile when they have none or it won't load. Same size as the brand tiles. */
function PageTile({ photo }: { photo?: string }) {
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [photo]);
  if (!photo || broken) return mvTile;
  return <img src={photo} alt="" className="h-10 w-10 shrink-0 rounded-xl border border-black/10 bg-white object-cover" onError={() => setBroken(true)} data-testid="live-page-photo" />;
}

function LiveRow({ icon, name, line, right, children, testId }: { icon: ReactNode; name: ReactNode; line: ReactNode; right?: ReactNode; children?: ReactNode; testId?: string }) {
  return (
    <div className="px-5 py-4" data-testid={testId}>
      <div className="flex flex-wrap items-center gap-x-3.5 gap-y-2">
        <span className="flex w-12 shrink-0 justify-center">{icon}</span>
        <div className="min-w-0 flex-1 basis-[200px]">
          <p className="text-sm font-semibold text-foreground">{name}</p>
          <p className="text-sm leading-snug text-muted-foreground">{line}</p>
        </div>
        {right && <div className="flex shrink-0 items-center gap-1.5 max-sm:pl-[62px]">{right}</div>}
      </div>
      {children && <div className="sm:pl-[62px]">{children}</div>}
    </div>
  );
}

function useLivePage() {
  return useQuery<LivePage>({ queryKey: LIVE_PAGE, queryFn: async () => (await apiRequest("GET", "/api/host/live-page")).json() });
}
function useSetLivePage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async (b: Partial<Pick<LivePage, "on" | "streamInOut">>) => (await (await apiRequest("PUT", "/api/host/live-page", b)).json()) as LivePage,
    onSuccess: (d) => { qc.setQueryData(LIVE_PAGE, d); void qc.invalidateQueries({ queryKey: MY_STUDIO }); },
    onError: (e: Error) => toast({ title: "Couldn't change that", description: e.message, variant: "destructive" }),
  });
}

/** 1. Their MilitaryVoices page: on unless they switch it off; every account has an address (their SmartLink's, else a watch address). */
function LivePageRow() {
  const { data } = useLivePage();
  const set = useSetLivePage();
  if (!data) return null;
  const line = !data.handle
    ? <>Publish your <a href="/host/dashboard/page" className="font-semibold text-[#053877] hover:underline dark:text-white">SmartLink</a> to get your live page.</>
    : <>
        <a href={data.url} target="_blank" rel="noreferrer" className="font-medium text-[#053877] hover:underline dark:text-white" data-testid="live-page-link">{data.url.replace(/^https?:\/\/(www\.)?/, "")}</a>
        {data.live ? " · live now" : ": every live show plays there."}
      </>;
  return (
    <LiveRow testId="row-live-page" icon={<PageTile photo={data.photo} />} name="Your watch page" line={line}
      right={data.handle ? <Switch checked={data.on} onCheckedChange={(on) => set.mutate({ on })} disabled={set.isPending} aria-label="Live on your watch page" data-testid="live-page-switch" /> : undefined} />
  );
}

/** Facebook and any other site's key: the same keys the studio's Go live lists, kept per studio. */
function KeysRows() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data } = useQuery<StudioKeys>({ queryKey: MY_STUDIO, queryFn: async () => (await apiRequest("GET", "/api/host/my-studio")).json() });
  const [adding, setAdding] = useState<"" | "facebook" | "other">("");
  const [form, setForm] = useState({ name: "", url: "", key: "" });
  const patch = useMutation({
    mutationFn: async (b: Record<string, unknown>) => (await apiRequest("PATCH", "/api/host/my-studio", b)).json(),
    onSuccess: (d) => { qc.setQueryData(MY_STUDIO, (old: object | undefined) => ({ ...(old ?? {}), ...d })); },
    onError: (e: Error) => toast({ title: "Couldn't save that", description: e.message, variant: "destructive" }),
  });
  const open = (kind: "facebook" | "other") => { setAdding(kind); setForm(kind === "facebook" ? { name: "Facebook", url: FACEBOOK_RTMP, key: "" } : { name: "", url: "", key: "" }); };
  const save = () => patch.mutate({ addStream: form }, { onSuccess: () => { setAdding(""); toast({ title: `${form.name || "Key"} saved` }); } });
  const streams = data?.streams ?? [];
  const input = "h-10 w-full min-w-0 rounded-lg border border-[#d0d5dd] bg-white px-3 text-sm outline-none focus:border-[#053877] focus:ring-2 focus:ring-[#053877]/15 dark:bg-transparent";
  const formBox = (
    <form className="mt-3 space-y-2" onSubmit={(e) => { e.preventDefault(); if (form.url.trim()) save(); }} data-testid="live-key-form">
      {adding === "other" && <input className={input} placeholder="Name, e.g. Twitch" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} aria-label="Name" />}
      <input className={input} placeholder="Server address (rtmp:// or rtmps://)" value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} aria-label="Server address" spellCheck={false} />
      <input className={input} placeholder="Stream key" type="password" autoComplete="off" value={form.key} onChange={(e) => setForm({ ...form, key: e.target.value })} aria-label="Stream key" spellCheck={false} data-testid="live-key-input" />
      <div className="flex items-center gap-2">
        <button type="submit" disabled={!form.url.trim() || patch.isPending} className="flex h-9 items-center gap-1.5 rounded-lg px-4 text-sm font-bold text-white disabled:opacity-50" style={{ background: NAVY }} data-testid="live-key-save">
          {patch.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Save key
        </button>
        <button type="button" onClick={() => setAdding("")} className="h-9 px-2 text-sm font-semibold text-[#667085] hover:text-[#344054]">Cancel</button>
      </div>
      {adding === "facebook" && <p className="text-[13px] text-muted-foreground">In Facebook's Live Producer, choose <b>Streaming software</b> and turn on <b>persistent stream key</b>, then copy the key here.</p>}
    </form>
  );
  return (
    <>
      <LiveRow testId="row-live-facebook" icon={<BrandMark brand="facebook" tile />} name="Facebook Live" line="Use the persistent stream key from Facebook's Live Producer."
        right={adding !== "facebook" ? <button type="button" onClick={() => open("facebook")} className={ghost} data-testid="live-add-facebook">Add a key</button> : undefined}>
        {adding === "facebook" && formBox}
      </LiveRow>
      {/* Each on its own row (Andrew, 24 Nov: "LinkedIn and Instagram: why are they together?"). Neither keeps a key, so
          there's nothing to save here: the line says where it goes on the day. */}
      <LiveRow testId="row-live-linkedin" icon={<BrandMark brand="linkedin" tile />} name="LinkedIn Live"
        line="LinkedIn makes a new key for each live. Paste it in Go live on the day." />
      <LiveRow testId="row-live-instagram" icon={<BrandMark brand="instagram" tile />} name="Instagram Live"
        line="Instagram makes a new key for each live. Paste it in Go live on the day." />
      <LiveRow testId="row-live-other" icon={<IconTile icon={Globe} />} name="Another site"
        line="Any site that gives you a lasting stream key."
        right={adding !== "other" ? <button type="button" onClick={() => open("other")} className={ghost} data-testid="live-add-other">Add a key</button> : undefined}>
        {adding === "other" && formBox}
      </LiveRow>
      {streams.length > 0 && (
        <div className="px-5 py-3" data-testid="live-keys">
          <p className="mb-1.5 text-[12px] font-bold uppercase tracking-wide text-muted-foreground sm:pl-[62px]">Your keys</p>
          <ul className="space-y-1 sm:pl-[62px]">
            {streams.map((x) => (
              <li key={x.id} className="flex items-center gap-3 rounded-xl bg-[#f9fafb] px-3.5 py-2 dark:bg-white/5" data-testid={`live-key-${x.id}`}>
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{x.name}{x.key ? <span className="ml-2 text-muted-foreground">{x.key}</span> : null}</span>
                <Switch checked={x.on} onCheckedChange={() => patch.mutate({ toggleStream: x.id })} aria-label={`${x.name} on`} />
                <button type="button" onClick={() => { if (window.confirm(`Remove the ${x.name} key?`)) patch.mutate({ removeStream: x.id }); }} className="p-1 text-[#667085] hover:text-[#b42318]" aria-label={`Remove ${x.name}`}><Trash2 className="h-4 w-4" /></button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}

// Andrew, 22 Nov: hover-overs on the StreamYard icons saying we take their episodes in for clips, reels and their page ("we do the RTMP").
const STREAM_IN_TIP = (
  <>
    <p className="font-semibold">Make your show in StreamYard, Restream or OBS?</p>
    <p className="mt-1 text-muted-foreground">Send it here too. Each episode lands in your Library for clips and reels, and plays on your MilitaryVoices page. We handle the RTMP.</p>
  </>
);

/**
 * Whether stream in works (Andrew, 22 Nov: "Is there any way for us to say 'connected'?"). StreamYard never tells us a
 * destination was saved, so the pill shows what we know from real streams: not used yet, receiving now, working (with
 * when the last one came in), or a problem in plain words.
 */
function StreamInPill({ state }: { state: StreamInState }) {
  const base = "inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-[12px] font-semibold";
  if (state === "receiving") return <span className={`${base} bg-[#ecfdf3] text-[#067647]`} data-testid="stream-in-pill"><span className="relative flex h-2 w-2"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#17b26a] opacity-60" /><span className="relative inline-flex h-2 w-2 rounded-full bg-[#17b26a]" /></span>Receiving now</span>;
  if (state === "working") return <span className={`${base} bg-[#ecfdf3] text-[#067647]`} data-testid="stream-in-pill"><Check className="h-3.5 w-3.5" />Working</span>;
  if (state === "problem") return <span className={`${base} bg-[#fef3f2] text-[#b42318]`} data-testid="stream-in-pill">Needs a look</span>;
  return <span className={`${base} bg-[#f2f4f7] text-[#475467] dark:bg-white/10 dark:text-muted-foreground`} data-testid="stream-in-pill">Not used yet</span>;
}

/** "Sun, Nov 22, 5:31 PM EST", in their own time zone. */
const whenLocal = (iso: string) => new Date(iso).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" });

/** Stream in: their StreamYard, Restream or OBS sends to us. It's a recording coming in, so it sits in Integrations →
    Recordings beside Zoom and Zapier (Andrew, 24 Nov: "that's coming in. The other ones are going out"). */
export function StreamInBlock() {
  const qc = useQueryClient();
  const { toast } = useToast();
  // Every 3 seconds while a test waits or a stream is coming in, so the pill flips within seconds; else every 30.
  const { data } = useQuery<StreamIn>({
    queryKey: STREAM_IN,
    queryFn: async () => (await apiRequest("GET", "/api/host/stream-in")).json(),
    refetchInterval: (q) => { const kk = (q.state.data as StreamIn | undefined)?.key; return kk && (kk.testUntil || kk.state === "receiving") ? 3_000 : 30_000; },
  });
  const test = useMutation({
    mutationFn: async (on: boolean) => (await (await apiRequest(on ? "POST" : "DELETE", "/api/host/stream-in/test")).json()) as StreamIn,
    onSuccess: (d) => qc.setQueryData(STREAM_IN, d),
    onError: (e: Error) => toast({ title: "Couldn't start the test", description: e.message, variant: "destructive" }),
  });
  // A test (or any stream) that just came through and ended: say so once.
  const prev = useRef<StreamInState | undefined>(undefined);
  const st = data?.key?.state;
  useEffect(() => {
    if (prev.current === "receiving" && st === "working") toast({ title: "It works", description: "Your stream came through to MilitaryVoices." });
    prev.current = st;
  }, [st, toast]);
  const page = useLivePage();
  const set = useSetLivePage();
  const [show, setShow] = useState(false);
  const make = useMutation({
    mutationFn: async () => (await (await apiRequest("POST", "/api/host/stream-in")).json()) as StreamIn,
    onSuccess: (d) => qc.setQueryData(STREAM_IN, d),
    onError: (e: Error) => toast({ title: "Couldn't make your key", description: e.message, variant: "destructive" }),
  });
  const copy = async (v: string, what: string) => { try { await navigator.clipboard.writeText(v); toast({ title: `${what} copied` }); } catch { toast({ title: "Couldn't copy", description: "Select it and copy it by hand.", variant: "destructive" }); } };
  if (!data) return null;
  const k = data.key;
  const testing = !!k?.testUntil && k.state !== "receiving";
  const keyLine = !k ? "" : k.state === "receiving"
    ? (k.lastWasTest ? "Your test is coming in. End it in StreamYard whenever you like." : "Your stream is coming in now.")
    : testing ? <>In StreamYard, go live for 30 seconds to your MilitaryVoices destination, then end it. <button type="button" onClick={() => test.mutate(false)} className="font-semibold text-[#053877] hover:underline dark:text-white" data-testid="button-stream-in-test-stop">Stop testing</button></>
    : k.lastAt && k.state !== "unused" ? <>Last stream in: <span className="whitespace-nowrap">{whenLocal(k.lastAt)}</span>{k.lastWasTest ? " (a test, in your Library as Test stream)." : "."}</>
    : "Make your show there the way you always do. Add a custom RTMP destination with these two lines.";
  const head = (
    <LiveRow testId="row-stream-in" icon={<InfoTip label="About streaming in from StreamYard, Restream or OBS" tip={STREAM_IN_TIP} testId="tip-stream-in"><BrandGroup brands={["streamyard", "restream", "obs"]} /></InfoTip>}
      name={k ? <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">StreamYard, Restream or OBS <StreamInPill state={k.state} /></span> : "StreamYard, Restream or OBS"}
      line={!data.configured ? "Streaming in isn't switched on yet." : k ? keyLine : "Make your show there the way you always do, and send it to us too."}
      right={data.configured && !k
        ? <button type="button" onClick={() => make.mutate()} disabled={make.isPending} className="flex h-8 items-center gap-1.5 rounded-full px-4 text-xs font-bold text-white disabled:opacity-60" style={{ background: NAVY }} data-testid="button-stream-in-key">{make.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Get my stream key</button>
        : k && !testing && k.state !== "receiving" && k.status !== "paused"
          ? <button type="button" onClick={() => test.mutate(true)} disabled={test.isPending} className={`${ghost} flex items-center gap-1.5`} data-testid="button-stream-in-test">{test.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Test it</button>
          : testing ? <span className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground" data-testid="stream-in-waiting"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Waiting for it</span> : undefined} />
  );
  if (!k) return head;
  const line = (label: string, value: string, shown: string, testId: string) => (
    <div className="flex items-center gap-3 rounded-xl bg-[#f9fafb] px-3.5 py-2.5 dark:bg-white/5" data-testid={testId}>
      <span className="w-[92px] shrink-0 whitespace-nowrap text-[12px] font-bold uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className="min-w-0 flex-1 truncate font-mono text-[13px]">{shown}</span>
      <button type="button" onClick={() => void copy(value, label)} className={`${ghost} flex items-center gap-1`}><Copy className="h-3.5 w-3.5" /> Copy</button>
    </div>
  );
  const out = page.data?.streamInOut ?? true;
  return (
    <>
      {head}
      <div className="space-y-2 px-5 pb-4 sm:pl-[82px]">
        {line("Server", k.url, k.url, "stream-in-server")}
        {line("Stream key", k.streamKey, show ? k.streamKey : `••••••••••••${k.streamKey.slice(-4)}`, "stream-in-key")}
        <button type="button" onClick={() => setShow((v) => !v)} className="text-[13px] font-semibold text-[#053877] hover:underline dark:text-white">{show ? "Hide the key" : "Show the key"}</button>
        {k.pausedWhy && <p className="text-[13px] font-medium text-[#b54708]">{k.pausedWhy}</p>}
        {k.problem && <p className="text-[13px] font-medium text-[#b42318]">{k.problem}</p>}
      </div>
      <div className="px-5 py-4 sm:pl-[82px]" data-testid="stream-in-when">
        <p className="mb-2 text-[13px] font-bold text-foreground">When you stream in</p>
        <label className="flex cursor-pointer items-start gap-3">
          <input type="checkbox" checked={out} onChange={(e) => set.mutate({ streamInOut: e.target.checked })} disabled={set.isPending} className="mt-0.5 h-5 w-5 shrink-0 accent-[#067647]" data-testid="stream-in-out" />
          <span className="text-sm">Live on your watch page
            <span className="block text-[13px] text-muted-foreground">And on to YouTube and the others above, if they're on.</span>
          </span>
        </label>
        <div className="mt-2 flex items-start gap-3">
          <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-[5px] bg-[#067647] text-white"><Check className="h-3.5 w-3.5" /></span>
          <span className="text-sm">Recorded to your Library
            <span className="block text-[13px] text-muted-foreground">Always. Ready for Pōstify when you stop. {data.usage.capMin ? `${Math.round(data.usage.usedMin / 60 * 10) / 10} of ${Math.round(data.usage.capMin / 60)} hours used this month.` : ""}</span>
          </span>
        </div>
        <a href="/stream-in" className="mt-3 inline-flex items-center gap-1 text-[13px] font-semibold text-[#053877] hover:underline dark:text-white">Step-by-step for StreamYard, Restream and OBS <ExternalLink className="h-3.5 w-3.5" /></a>
      </div>
    </>
  );
}

/**
 * Their show logo (Andrew, 23 Nov 2026: "let's get that logo up in the right-hand corner … It can be small"). It goes
 * top-right on Radio, events and their own Studio while they're on, and on Social's thumbnails; server/showLogo.ts.
 */
type ShowLogo = { logo: string; plate: "light" | "dark" | "none"; cover: string };
const SHOW_LOGO = ["/api/host/show-logo"];
const LOGO_TYPES = ["image/png", "image/jpeg", "image/webp", "image/svg+xml"];
const LOGO_MAX = 8 * 1024 * 1024;
function ShowLogoRow() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const file = useRef<HTMLInputElement>(null);
  const { data } = useQuery<ShowLogo>({ queryKey: SHOW_LOGO, queryFn: async () => (await apiRequest("GET", "/api/host/show-logo")).json() });
  const send = useMutation({
    mutationFn: async (f: File | null) => {
      const r = f
        ? await fetch("/api/host/show-logo", { method: "POST", body: (() => { const b = new FormData(); b.append("file", f); return b; })(), credentials: "include" })
        : await fetch("/api/host/show-logo", { method: "DELETE", credentials: "include" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.message || "That didn't save. Try again.");
      return j as ShowLogo;
    },
    onSuccess: (d, f) => { qc.setQueryData(SHOW_LOGO, d); if (f) toast({ title: "Show logo saved" }); },
    onError: (e: Error) => toast({ title: e.message, variant: "destructive" }),
  });
  const pick = (f?: File) => {
    if (!f) return;
    if (!LOGO_TYPES.includes(f.type)) return toast({ title: "That's not a PNG or JPG.", variant: "destructive" });
    if (f.size > LOGO_MAX) return toast({ title: "Under 8 MB, please.", variant: "destructive" });
    send.mutate(f);
  };
  if (!data) return null;
  const has = !!data.logo;
  const link = "font-semibold text-[#053877] hover:underline disabled:opacity-50 dark:text-white";
  // One line under the Live list (Andrew, 24 Nov: "Should we default it to the show logo?"): it already falls back to
  // their podcast cover, so the line says what shows now and offers a different logo, rather than a whole section.
  return (
    <div className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1.5 text-[13px] text-muted-foreground" data-testid="row-show-logo">
      <input ref={file} type="file" accept={LOGO_TYPES.join(",")} className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; pick(f); }} data-testid="show-logo-input" />
      {has && (
        // The logo itself, on the plate it wears live.
        <span className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-black/10 p-0.5" style={{ background: data.plate === "dark" ? "#0b1530" : "#fff" }} data-testid="show-logo-preview">
          <img src={data.logo} alt="" className="max-h-full max-w-full object-contain" data-testid="show-logo-tile" />
        </span>
      )}
      <span>{has ? "Your logo shows in the corner when you're live." : data.cover ? "Your podcast cover shows in the corner when you're live." : "The MilitaryVoices mark shows in the corner when you're live."}</span>
      <button type="button" onClick={() => file.current?.click()} disabled={send.isPending} className={`${link} inline-flex items-center gap-1`} data-testid="show-logo-upload">
        {send.isPending && send.variables && <Loader2 className="h-3.5 w-3.5 animate-spin" />} {has ? "Replace" : "Use a different logo"}
      </button>
      {has && <button type="button" onClick={() => send.mutate(null)} disabled={send.isPending} className={link} data-testid="show-logo-remove">Remove</button>}
    </div>
  );
}

/** Integrations → Live streaming: where a live show goes, and the logo it wears. Stream in is under Recordings. */
export function LiveSettings() {
  return (
    <div data-testid="live-settings">
      <div className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
        <LivePageRow />
        <ConnectYoutube row />
        <KeysRows />
      </div>
      <ShowLogoRow />
    </div>
  );
}
