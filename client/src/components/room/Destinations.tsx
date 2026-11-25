import { useEffect, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Loader2, Plus, Radio, X } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { BrandMark, type Brand } from "@/components/BrandMark";
import { YoutubeKeyForm, useYoutubeKey, youtubeConnectHref } from "@/components/ConnectYoutube";

/**
 * Where the show goes, up front (Andrew, 25 Nov: "Go, build both", mockup MaJfCHRpsF8LhQxZmHUBpm): the
 * destinations they've set up sit beside Record as small brand circles, each one click on or off, and "+" opens
 * Add a destination, a grid of what we can really push to today. Everything but our own page and YouTube is a
 * stream key we haven't proved end to end, and says so ("Stream key").
 */

/** The part of /api/host/my-studio this needs. */
export type DestStudio = {
  youtube: boolean; youtubeOn: boolean; youtubeKey?: string;
  livePage?: { on: boolean; url: string };
  streams: { id: string; name: string; on: boolean }[];
};

const NAVY = "#053877";
const KEY = ["/api/host/my-studio"];
const say = (e: unknown) => ((e as Error).message ?? "").replace(/^\d+:\s*/, "").replace(/^\{"message":"|"\}$/g, "") || "Try again in a moment.";

/** A saved key's site, from the name it was saved under (ours are the brand's name; older ones were typed). */
export function brandOf(name: string): Brand | null {
  const n = name.toLowerCase();
  if (n.includes("facebook")) return "facebook";
  if (n.includes("linkedin")) return "linkedin";
  if (n.includes("twitch")) return "twitch";
  if (n.includes("kick")) return "kick";
  if (n.includes("youtube")) return "youtube";
  if (n === "x" || n.includes("twitter")) return "x";
  return null;
}

/** On, off: true when anything is picked to go live to. */
export const anyDestinationOn = (s: DestStudio) => !!s.livePage?.on || (s.youtube && s.youtubeOn) || s.streams.some((x) => x.on);

function useDestActions() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [busy, setBusy] = useState("");
  const set = (s: unknown) => qc.setQueryData(KEY, s);
  const run = async (id: string, fn: () => Promise<void>, fail: string) => {
    setBusy(id);
    try { await fn(); return true; } catch (e) { toast({ title: fail, description: say(e), variant: "destructive" }); return false; } finally { setBusy(""); }
  };
  const patch = (id: string, body: Record<string, unknown>, fail = "Couldn't change that") =>
    run(id, async () => { set(await (await apiRequest("PATCH", "/api/host/my-studio", body)).json()); }, fail);
  /** Their MilitaryVoices live page: the same switch as Integrations → Live and Go live. */
  const page = (on: boolean) => run("page", async () => {
    await apiRequest("PUT", "/api/host/live-page", { on });
    set(await (await apiRequest("GET", "/api/host/my-studio")).json());
    void qc.invalidateQueries({ queryKey: ["/api/host/live-page"] });
  }, "Couldn't change your page");
  return { busy, patch, page };
}

/** One destination as a circle: on = a navy ring and a green dot; off = grey. */
function Circle({ label, on, disabled, onClick, children, testId }: { label: string; on: boolean; disabled: boolean; onClick: () => void; children: ReactNode; testId: string }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} aria-pressed={on} aria-label={`${label}, ${on ? "on" : "off"}${disabled ? "" : `. Click to turn ${on ? "off" : "on"}`}`} title={`${label} · ${on ? "on" : "off"}`}
      className={`relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white transition disabled:cursor-not-allowed ${on ? "ring-2 ring-[#053877] ring-offset-2" : "opacity-55 grayscale ring-1 ring-[#d0d5dd] hover:opacity-80 hover:grayscale-0"}`} data-testid={testId}>
      {children}
      {on && <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-white bg-[#12b76a]" />}
    </button>
  );
}

/** The top bar's "Going to" group, beside Record. While live it locks: changes wait for the next show. */
export function DestinationBar({ studio, live, onAdd }: { studio: DestStudio; live: boolean; onAdd: () => void }) {
  const { busy, patch, page } = useDestActions();
  const lock = live || busy !== "";
  const ytOn = studio.youtube && studio.youtubeOn;
  return (
    <div role="group" aria-label="Where the show goes" className="hidden h-[42px] items-center gap-2.5 rounded-xl border border-[#e4e7ec] bg-white pl-1.5 pr-1.5 lg:flex xl:pl-3" title={live ? "You're live. Change these after the show." : undefined} data-testid="dest-bar">
      <span className="hidden text-xs font-bold text-[#475467] xl:inline">{live ? "Live on" : "Going to"}</span>
      {studio.livePage?.url && (
        <Circle label="Your MilitaryVoices page" on={!!studio.livePage.on} disabled={lock} onClick={() => void page(!studio.livePage!.on)} testId="dest-page">
          <span className="flex h-full w-full items-center justify-center rounded-full text-[10px] font-extrabold tracking-tight text-white" style={{ background: NAVY }}>MV</span>
        </Circle>
      )}
      {studio.youtube && (
        <Circle label="YouTube" on={ytOn} disabled={lock} onClick={() => void patch("yt", { youtubeOn: !studio.youtubeOn })} testId="dest-youtube">
          <BrandMark brand="youtube" tile className="h-4 w-4" tileClassName="h-8 w-8 rounded-full" title="" />
        </Circle>
      )}
      {studio.streams.map((s) => {
        const b = brandOf(s.name);
        return (
          <Circle key={s.id} label={s.name} on={s.on} disabled={lock} onClick={() => void patch(s.id, { toggleStream: s.id })} testId={`dest-stream-${s.id}`}>
            {b ? <BrandMark brand={b} tile className="h-4 w-4" tileClassName="h-8 w-8 rounded-full" title="" /> : <Radio className="h-4 w-4 text-[#344054]" aria-hidden />}
          </Circle>
        );
      })}
      {!live && (
        <button type="button" onClick={onAdd} aria-label="Add a destination" title="Add a destination" className="flex h-8 w-8 items-center justify-center rounded-full border-[1.5px] border-dashed border-[#98a2b3] bg-white text-[#475467] hover:border-[#053877] hover:text-[#053877]" data-testid="dest-add">
          <Plus className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}

type KeySite = "facebook" | "linkedin" | "twitch" | "kick" | "x" | "other";
type SiteInfo = { name: string; brand: Brand | null; hint: string; server: string; link?: { href: string; text: string }; steps: ReactNode[] };
/** The plain-word steps per site. A filled-in server is one that's the same for everyone; the rest give their own. */
const SITES: Record<KeySite, SiteInfo> = {
  facebook: {
    name: "Facebook", brand: "facebook", hint: "Page, profile or group", server: "rtmps://live-api-s.facebook.com:443/rtmp/",
    link: { href: "https://www.facebook.com/live/producer", text: "Open it" },
    steps: [<>In Facebook, open <b>Live Producer</b> and choose <b>Streaming software</b>.</>, <>Copy the <b>Stream key</b>. Tick "Use a persistent stream key" so it works every week.</>, <>Paste it below. We've filled in Facebook's server for you.</>],
  },
  linkedin: {
    name: "LinkedIn", brand: "linkedin", hint: "Needs LinkedIn Live turned on for you", server: "",
    steps: [<>In LinkedIn, create a <b>Live event</b> and choose <b>Streaming software</b>. It needs LinkedIn Live turned on for your account.</>, <>Copy the <b>Stream URL</b> and the <b>Stream key</b>.</>, <>Paste both below.</>],
  },
  twitch: {
    name: "Twitch", brand: "twitch", hint: "Your channel", server: "rtmp://live.twitch.tv/app",
    link: { href: "https://dashboard.twitch.tv/settings/stream", text: "Open it" },
    steps: [<>In Twitch, open <b>Creator Dashboard › Settings › Stream</b>.</>, <>Copy your <b>Primary Stream key</b>.</>, <>Paste it below. We've filled in Twitch's server for you.</>],
  },
  kick: {
    name: "Kick", brand: "kick", hint: "Your channel", server: "",
    steps: [<>In Kick, open <b>Creator Dashboard › Settings › Stream URL & Key</b>.</>, <>Copy the <b>Stream URL</b> and the <b>Stream key</b>.</>, <>Paste both below.</>],
  },
  x: {
    name: "X", brand: "x", hint: "Needs X's Media Studio Producer", server: "",
    steps: [<>In X, open <b>Media Studio › Producer</b> and add a source. It needs Producer access on your account.</>, <>Copy the <b>RTMP URL</b> and the <b>Stream key</b>.</>, <>Paste both below.</>],
  },
  other: {
    name: "Somewhere else", brand: null, hint: "Any site that gives you a server address and key", server: "",
    steps: [<>On that site, find its <b>streaming software</b> (or "RTMP") settings.</>, <>Copy the <b>server address</b> and the <b>stream key</b>.</>, <>Name it and paste both below.</>],
  },
};

function Dialog({ onClose, children, testId }: { onClose: () => void; children: ReactNode; testId: string }) {
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); }; window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, [onClose]);
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-[rgba(16,24,40,0.45)] p-4" onClick={onClose}>
      <div role="dialog" aria-modal className="relative max-h-[calc(100dvh-32px)] w-full max-w-[720px] overflow-y-auto rounded-[20px] bg-white p-6 text-[#101828] shadow-[0_24px_64px_rgba(16,24,40,0.3)]" onClick={(e) => e.stopPropagation()} data-testid={testId}>
        <button type="button" onClick={onClose} aria-label="Close" className="absolute right-4 top-4 flex h-10 w-10 items-center justify-center rounded-full text-[#667085] hover:bg-[#f2f4f7]"><X className="h-5 w-5" /></button>
        {children}
      </div>
    </div>
  );
}

const tile = "flex min-h-[76px] items-center gap-3 rounded-2xl px-3.5 py-3 text-left";
const tag = <span className="whitespace-nowrap rounded-full bg-[#f2f4f7] px-2 py-1 text-[11px] font-bold text-[#475467]">Stream key</span>;
// The brand's tile keeps black marks (X) black on white in dark mode too.
const mark = (b: Brand | null) => (b ? <BrandMark brand={b} tile className="h-5 w-5" tileClassName="h-10 w-10 rounded-full" title="" /> : (
  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-black/10 bg-white"><Radio className="h-5 w-5 text-[#344054]" aria-hidden /></span>
));

/** Add a destination: the grid, then one site's plain steps. */
export function AddDestinationSheet({ studio, onClose }: { studio: DestStudio; onClose: () => void }) {
  const [site, setSite] = useState<KeySite | "youtube" | null>(null);
  return (
    <Dialog onClose={onClose} testId="dest-sheet">
      {site === "youtube" ? <YoutubeStep studio={studio} onBack={() => setSite(null)} onDone={onClose} />
        : site ? <KeyStep site={site} onBack={() => setSite(null)} onDone={onClose} />
        : <Grid studio={studio} onPick={setSite} />}
    </Dialog>
  );
}

function Grid({ studio, onPick }: { studio: DestStudio; onPick: (s: KeySite | "youtube") => void }) {
  const { busy, patch, page } = useDestActions();
  const pageOn = !!studio.livePage?.on;
  const ytOn = studio.youtube && studio.youtubeOn;
  const onTag = (on: boolean) => <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${on ? "bg-[#d1fadf] text-[#067647]" : "bg-[#f2f4f7] text-[#475467]"}`}>{on ? "On" : "Off"}</span>;
  return (
    <>
      <h2 className="pr-12 text-[22px] font-extrabold tracking-tight [text-wrap:balance]">Where should your show go?</h2>
      <p className="mt-1.5 text-sm text-[#475467]">Pick one. It joins the circles beside Record, and you can switch it on or off any time.</p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {studio.livePage?.url && (
          <button type="button" onClick={() => void page(!pageOn)} disabled={busy !== ""} aria-pressed={pageOn} className={`${tile} ${pageOn ? "border-2 border-[#053877] bg-[#f5f8fd]" : "border border-[#e4e7ec] hover:bg-[#f9fafb]"}`} data-testid="dest-tile-page">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[13px] font-extrabold text-white" style={{ background: NAVY }}>MV</span>
            <span className="min-w-0 flex-1"><span className="block text-[15px] font-bold">Your MilitaryVoices page</span><span className="block text-xs text-[#475467]">Nothing to set up. Click to switch it {pageOn ? "off" : "on"}.</span></span>
            {busy === "page" ? <Loader2 className="h-4 w-4 animate-spin" /> : onTag(pageOn)}
          </button>
        )}
        <button type="button" onClick={() => (studio.youtube ? void patch("yt", { youtubeOn: !studio.youtubeOn }) : onPick("youtube"))} disabled={busy !== ""} aria-pressed={studio.youtube ? ytOn : undefined}
          className={`${tile} ${ytOn ? "border-2 border-[#053877] bg-[#f5f8fd]" : "border border-[#e4e7ec] hover:bg-[#f9fafb]"}`} data-testid="dest-tile-youtube">
          {mark("youtube")}
          <span className="min-w-0 flex-1"><span className="block text-[15px] font-bold">YouTube</span><span className="block text-xs text-[#475467]">{studio.youtube ? (studio.youtubeKey ? `Your stream key ${studio.youtubeKey}` : "Your channel · connected") : "Paste your stream key once, then it's one click."}</span></span>
          {studio.youtube ? (busy === "yt" ? <Loader2 className="h-4 w-4 animate-spin" /> : onTag(ytOn)) : null}
        </button>
        {(Object.keys(SITES) as KeySite[]).map((k) => {
          const s = SITES[k];
          return (
            <button key={k} type="button" onClick={() => onPick(k)} className={`${tile} ${k === "other" ? "border border-dashed border-[#98a2b3]" : "border border-[#e4e7ec]"} hover:bg-[#f9fafb]`} data-testid={`dest-tile-${k}`}>
              {mark(s.brand)}
              <span className="min-w-0 flex-1"><span className="block text-[15px] font-bold">{s.name}</span><span className="block text-xs text-[#475467]">{s.hint}</span></span>
              {tag}
            </button>
          );
        })}
      </div>
      {studio.streams.length > 0 && (
        <div className="mt-5" data-testid="dest-saved">
          <p className="text-xs font-bold uppercase tracking-[0.06em] text-[#667085]">Saved</p>
          <ul className="mt-2 divide-y divide-[#eef0f4] rounded-2xl border border-[#e4e7ec]">
            {studio.streams.map((x) => (
              <li key={x.id} className="flex items-center gap-3 px-3.5 py-2.5">
                {mark(brandOf(x.name))}
                <span className="min-w-0 flex-1 truncate text-sm font-semibold">{x.name}</span>
                <button type="button" onClick={() => void patch(x.id, { toggleStream: x.id })} disabled={busy !== ""} aria-pressed={x.on} className="disabled:opacity-60">{onTag(x.on)}</button>
                <button type="button" onClick={() => { if (window.confirm(`Remove ${x.name}? You'd paste its key again to add it back.`)) void patch(x.id, { removeStream: x.id }); }} className="text-xs font-semibold text-[#667085] hover:text-[#b42318]">Remove</button>
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="mt-4 text-xs leading-relaxed text-[#667085]">"Stream key" means you copy two lines from that site and paste them here. We'll walk you through it. Each one you switch on goes live with you at the same time.</p>
    </>
  );
}

function Head({ brand, title, onBack }: { brand: Brand | null; title: string; onBack: () => void }) {
  return (
    <div className="flex items-center gap-3 pr-12">
      <button type="button" onClick={onBack} aria-label="Back to all destinations" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] border border-[#e4e7ec] text-[#475467] hover:bg-[#f9fafb]" data-testid="dest-back"><ArrowLeft className="h-4 w-4" /></button>
      {mark(brand)}
      <h2 className="text-xl font-extrabold">{title}</h2>
    </div>
  );
}

function Steps({ steps, link }: { steps: ReactNode[]; link?: { href: string; text: string } }) {
  return (
    <ol className="mt-5 space-y-2.5">
      {steps.map((s, i) => (
        <li key={i} className="flex items-start gap-3">
          <span className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full bg-[#eef3fb] text-[13px] font-extrabold text-[#053877]">{i + 1}</span>
          <p className="pt-0.5 text-sm leading-relaxed">{s}{i === 0 && link && <> <a href={link.href} target="_blank" rel="noreferrer" className="font-semibold text-[#053877] underline underline-offset-2">{link.text}</a></>}</p>
        </li>
      ))}
    </ol>
  );
}

const field = "h-11 w-full rounded-[10px] border border-[#d0d5dd] px-3 text-sm outline-none focus:border-[#053877] focus:ring-2 focus:ring-[#053877]/15";

function KeyStep({ site, onBack, onDone }: { site: KeySite; onBack: () => void; onDone: () => void }) {
  const s = SITES[site];
  const { busy, patch } = useDestActions();
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [url, setUrl] = useState(s.server);
  const [key, setKey] = useState("");
  const label = site === "other" ? name.trim() || "this site" : s.name;
  const save = async () => {
    const ok = await patch("add", { addStream: { name: site === "other" ? name.trim() || "Custom" : s.name, url: url.trim(), key: key.trim() } }, "Couldn't add it");
    if (ok) { toast({ title: `${label} added`, description: "It's on, beside Record. Click its circle to switch it off." }); onDone(); }
  };
  return (
    <form onSubmit={(e) => { e.preventDefault(); void save(); }} data-testid={`dest-key-${site}`}>
      <Head brand={s.brand} title={site === "other" ? "Add another site" : `Add ${s.name}`} onBack={onBack} />
      <Steps steps={s.steps} link={s.link} />
      <div className="mt-5 space-y-3.5">
        {site === "other" && (
          <label className="block text-[13px] font-semibold text-[#344054]">Name it
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} placeholder="e.g. Rumble" className={`${field} mt-1.5`} required data-testid="dest-name" />
          </label>
        )}
        <label className="block text-[13px] font-semibold text-[#344054]">Server address
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Starts rtmp:// or rtmps://" className={`${field} mt-1.5 ${s.server && url === s.server ? "bg-[#f9fafb] text-[#475467]" : ""}`} required autoComplete="off" spellCheck={false} data-testid="dest-url" />
        </label>
        <label className="block text-[13px] font-semibold text-[#344054]">Stream key
          <input value={key} onChange={(e) => setKey(e.target.value)} type="password" placeholder="Paste it here" className={`${field} mt-1.5`} required autoComplete="off" data-testid="dest-key" />
          <span className="mt-1 block text-xs font-normal text-[#667085]">Kept private. Only used to send your show there.</span>
        </label>
      </div>
      <button type="submit" disabled={busy !== "" || !url.trim() || !key.trim()} className="mt-5 flex h-12 w-full items-center justify-center gap-2 rounded-xl text-[15px] font-bold text-white disabled:opacity-50" style={{ background: NAVY }} data-testid="dest-save">
        {busy === "add" && <Loader2 className="h-4 w-4 animate-spin" />}Add {site === "other" ? "it" : s.name}
      </button>
    </form>
  );
}

function YoutubeStep({ studio, onBack, onDone }: { studio: DestStudio; onBack: () => void; onDone: () => void }) {
  // Connect YouTube as the main way in for admins while Google verifies the app; everyone else pastes a key.
  const canConnect = !!useYoutubeKey().data?.canConnect;
  const { patch } = useDestActions();
  return (
    <div data-testid="dest-youtube-step">
      <Head brand="youtube" title="Add YouTube" onBack={onBack} />
      {canConnect && (
        <a href={youtubeConnectHref("studio")} className="mt-5 flex h-12 items-center justify-center rounded-xl text-[15px] font-bold text-white" style={{ background: NAVY }} data-testid="dest-youtube-connect">Connect YouTube</a>
      )}
      <div className="mt-5"><YoutubeKeyForm onSaved={() => { void (studio.youtubeOn ? Promise.resolve(true) : patch("yt", { youtubeOn: true })).then(onDone); }} /></div>
    </div>
  );
}
