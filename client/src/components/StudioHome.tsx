import { useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, Loader2, Radio } from "lucide-react";
import { BrandMark, type Brand } from "@/components/BrandMark";
import { Switch } from "@/components/ui/switch";
import { YoutubeKeyForm, useYoutubeKey, youtubeConnectHref } from "@/components/ConnectYoutube";
import { SavedStudios, useSetups } from "@/components/room/Setups";
import { SITES, brandOf, useDestActions, type KeySite } from "@/components/room/Destinations";
import { apiRequest } from "@/lib/queryClient";
import { TEMPLATES, type TemplateId } from "@shared/studioTemplates";

type Studio = {
  id: number; name: string; showTitle?: string; inviteLink: string;
  recording: { since: string } | null; live: { since: string; watchUrl: string } | null;
  youtube: boolean; youtubeOn: boolean; youtubeKey?: string;
  livePage?: { on: boolean; url: string };
  streams: { id: string; name: string; key: string; on: boolean }[];
  v3?: boolean;
};
const KEY = ["/api/host/my-studio"];
const NAVY = "#053877";
const say = (e: unknown) => ((e as Error).message ?? "").replace(/^\d+:\s*/, "").replace(/^\{"message":"|"\}$/g, "") || "Try again in a moment.";
const bare = (url: string) => url.replace(/^https?:\/\//, "");

type Tab = "new" | "saved" | "invite" | "live";

/**
 * The dashboard's Studio page (Andrew, 27 Nov: the Studio home mockup, version A, top tabs: "1"; exports/studio-home-mockup).
 * Studio in the menu lands here. The show's logo and name sit beside "Studio", Enter my studio top right, and four tabs:
 * Open new studio (a layout, today's studio kept first), Saved studios, Invite, and Where you go live (on/off switches,
 * with Add another place inline). It opens on Saved studios.
 */
export function StudioHome() {
  const q = useQuery<Studio>({ queryKey: KEY, queryFn: async () => (await apiRequest("GET", "/api/host/my-studio")).json() });
  const setups = useSetups(null);
  const hosting = useQuery<{ shows: { show: { artworkUrl?: string } }[] }>({ queryKey: ["/api/host/hosting"], queryFn: async () => (await apiRequest("GET", "/api/host/hosting")).json(), staleTime: 60_000, retry: false });
  const [tab, setTab] = useState<Tab>("saved");
  if (q.isLoading || !q.data) return <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  const s = q.data;
  const title = s.showTitle || s.name;
  const art = hosting.data?.shows?.find((x) => x.show.artworkUrl)?.show.artworkUrl;
  const initials = title.split(/\s+/).filter((w) => /^[A-Za-z0-9]/.test(w)).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("") || "MV";
  const locked = !!(s.live || s.recording);
  const onCount = (s.livePage?.url && s.livePage.on ? 1 : 0) + (s.youtube && s.youtubeOn ? 1 : 0) + s.streams.filter((x) => x.on).length;
  const saved = setups.data?.setups.length;
  // On a phone the labels get shorter so all four fit across without scrolling.
  const tabs: { key: Tab; label: string; short: string; count?: string }[] = [
    { key: "new", label: "Open new studio", short: "New studio" },
    { key: "saved", label: "Saved studios", short: "Saved", count: saved === undefined ? undefined : String(saved) },
    { key: "invite", label: "Invite", short: "Invite" },
    { key: "live", label: "Where you go live", short: "Go live", count: `${onCount} on` },
  ];

  return (
    <div className="w-full min-w-0 space-y-3.5" data-testid="studio-home">
      <header className="flex items-center gap-3">
        {art
          ? <img src={art} alt="" className="h-11 w-11 shrink-0 rounded-[10px] object-cover" />
          : <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[10px] border-2 border-[#F0A71F] bg-[#0b1b3a] text-[13px] font-extrabold text-white" aria-hidden>{initials}</span>}
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 text-[22px] font-bold leading-tight tracking-tight">
            Studio
            {s.live ? <span className="rounded-full bg-[#fee4e2] px-2 py-0.5 text-[11.5px] font-bold text-[#b42318]">Live</span> : s.recording ? <span className="rounded-full bg-[#fee4e2] px-2 py-0.5 text-[11.5px] font-bold text-[#b42318]">Recording</span> : null}
          </h1>
          <p className="truncate text-[13px] text-muted-foreground" data-testid="studio-show-name">{title}</p>
        </div>
        <a href="/my-studio" className="ml-auto inline-flex h-10 shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-full bg-[#F0A71F] px-4 text-sm font-bold text-[#1a1200] hover:bg-[#f5b94a] sm:px-5" data-testid="studio-enter">
          <Radio className="h-[18px] w-[18px]" aria-hidden />{locked ? "Back to my studio" : "Enter my studio"}
        </a>
      </header>

      <nav role="tablist" aria-label="Studio" className="flex gap-0.5 overflow-x-auto border-b border-border [scrollbar-width:none] sm:gap-1 [&::-webkit-scrollbar]:hidden" data-testid="studio-tabs">
        {tabs.map((t) => (
          <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} onClick={() => setTab(t.key)}
            className={`-mb-px flex shrink-0 items-center gap-1 whitespace-nowrap border-b-2 px-2 py-2.5 text-[13px] font-semibold sm:gap-1.5 sm:px-3 sm:text-sm ${tab === t.key ? "border-[#053877] text-foreground dark:border-white" : "border-transparent text-muted-foreground hover:text-foreground"}`} data-testid={`studio-tab-${t.key}`}>
            <span className="sm:hidden">{t.short}</span><span className="hidden sm:inline">{t.label}</span>{t.count !== undefined && <span className="rounded-full bg-muted px-1.5 text-[11.5px] font-medium text-muted-foreground">{t.count}</span>}
          </button>
        ))}
      </nav>

      {tab === "new" && <OpenNew s={s} locked={locked} />}
      {tab === "saved" && <SavedStudios locked={locked} />}
      {tab === "invite" && <Invite s={s} />}
      {tab === "live" && <WhereLive s={s} />}
    </div>
  );
}

const card = "rounded-[14px] border border-border bg-card";
const Label = ({ children }: { children: ReactNode }) => <p className="mb-1.5 text-xs font-semibold uppercase tracking-[0.06em] text-muted-foreground">{children}</p>;
const Note = ({ children }: { children: ReactNode }) => <p className="text-[12.5px] text-muted-foreground">{children}</p>;
const Err = ({ children }: { children: ReactNode }) => <p className="rounded-xl bg-[#fef3f2] px-4 py-2.5 text-sm font-medium text-[#b42318]" role="alert">{children}</p>;
const LinkBtn = ({ children, ...p }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
  <button type="button" {...p} className={`flex h-8 shrink-0 items-center gap-1 px-1.5 text-sm font-bold text-[#053877] hover:underline disabled:opacity-50 disabled:no-underline dark:text-white ${p.className ?? ""}`}>{children}</button>
);
const navyBtn = "inline-flex h-10 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-full px-4 text-sm font-bold text-white disabled:opacity-50";

/* ── Open new studio: a layout's scenes; the server keeps today's studio first as "Before <date>" ── */

function OpenNew({ s, locked }: { s: Studio; locked: boolean }) {
  const [busy, setBusy] = useState<TemplateId | "">("");
  const [error, setError] = useState("");
  const open = async (id: TemplateId) => {
    setBusy(id); setError("");
    try { await apiRequest("POST", "/api/host/my-studio/setups/fresh", { template: id, v3: !!s.v3 }); window.location.href = "/my-studio"; }
    catch (e) { setError(say(e)); setBusy(""); }
  };
  return (
    <section className="space-y-2.5" data-testid="studio-open-new">
      {error && <Err>{error}</Err>}
      <div className={card}>
        {TEMPLATES.map((t) => {
          const n = t.scenes(!!s.v3).length;
          return (
            <div key={t.id} className="flex items-center gap-3 border-b border-border px-4 py-2.5 last:border-b-0">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">{t.name} <span className="font-normal text-muted-foreground">· {n} scene{n === 1 ? "" : "s"}</span></p>
                <p className="text-[12.5px] text-muted-foreground">{t.line}</p>
              </div>
              <LinkBtn onClick={() => void open(t.id)} disabled={locked || !!busy} title={locked ? "You're live or recording. Change scenes inside your studio." : undefined} data-testid={`studio-new-${t.id}`}>
                {busy === t.id && <Loader2 className="h-3.5 w-3.5 animate-spin" />}Open
              </LinkBtn>
            </div>
          );
        })}
      </div>
      <Note>Your logo, style and clips come with you. Today's studio is saved first, so nothing is lost.</Note>
    </section>
  );
}

/* ── Invite ── */

function Invite({ s }: { s: Studio }) {
  const qc = useQueryClient();
  const [copied, setCopied] = useState(false);
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const renew = async () => {
    setBusy(true); setError("");
    try { qc.setQueryData(KEY, await (await apiRequest("PATCH", "/api/host/my-studio", { newInvite: true })).json()); setAsking(false); }
    catch (e) { setError(say(e)); }
    finally { setBusy(false); }
  };
  return (
    <section className={`${card} max-w-[720px] p-4`} data-testid="studio-invite">
      <p className="text-sm text-muted-foreground">Send this link. Guests type their name and come straight in: no account needed.</p>
      <div className="mt-3 flex gap-2">
        <input readOnly value={bare(s.inviteLink)} aria-label="Guest link" onFocus={(e) => e.currentTarget.select()} className="h-10 min-w-0 flex-1 rounded-[10px] border border-border bg-background px-3 font-mono text-xs" />
        <button type="button" onClick={() => void navigator.clipboard.writeText(s.inviteLink).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 2000); })} className={navyBtn} style={{ background: NAVY }} data-testid="studio-copy-invite">
          {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}{copied ? "Copied" : "Copy link"}
        </button>
      </div>
      {error && <p className="mt-2 text-[12.5px] font-medium text-[#b42318]">{error}</p>}
      {asking ? (
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px]">
          <span>Make a new link? The old one stops working.</span>
          <LinkBtn onClick={() => void renew()} disabled={busy} data-testid="studio-new-link-yes">{busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}Make a new link</LinkBtn>
          <button type="button" onClick={() => setAsking(false)} className="text-sm font-semibold text-muted-foreground hover:text-foreground">Cancel</button>
        </div>
      ) : (
        <p className="mt-3 text-[12.5px] text-muted-foreground"><button type="button" onClick={() => setAsking(true)} className="font-semibold text-foreground hover:underline" data-testid="studio-new-link">New link</button> · the old one stops working</p>
      )}
    </section>
  );
}

/* ── Where you go live: every place with its switch, and Add another place inline ── */

const Mark = ({ brand }: { brand: Brand | null }) => brand
  ? <BrandMark brand={brand} tile className="h-4 w-4" tileClassName="h-8 w-8 rounded-lg" title="" />
  : <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border bg-white"><Radio className="h-4 w-4 text-[#344054]" aria-hidden /></span>;
const toggle = "data-[state=checked]:bg-[#053877] dark:data-[state=checked]:bg-[#4f8fe0]";

function Place({ mark, name, line, on, disabled, onToggle, extra, testId }: { mark: ReactNode; name: string; line: string; on: boolean; disabled: boolean; onToggle: () => void; extra?: ReactNode; testId: string }) {
  return (
    <div className="flex items-center gap-3 border-b border-border px-3.5 py-2.5 last:border-b-0 sm:px-4" data-testid={testId}>
      {mark}
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">{name}</p>
        <p className="text-[12.5px] text-muted-foreground [overflow-wrap:anywhere]">{line}</p>
      </div>
      {extra}
      <Switch checked={on} onCheckedChange={onToggle} disabled={disabled} aria-label={`${name}: ${on ? "on" : "off"}`} className={toggle} />
    </div>
  );
}

type Adding = KeySite | "youtube" | null;

function WhereLive({ s }: { s: Studio }) {
  const { busy, patch, page } = useDestActions();
  const [adding, setAdding] = useState<Adding>(null);
  const [removing, setRemoving] = useState("");
  const lock = !!s.live || busy !== "";
  const hasFacebook = s.streams.some((x) => brandOf(x.name) === "facebook");
  const chips: { key: Exclude<Adding, null>; label: string; brand: Brand | null }[] = [
    ...(!s.youtube ? [{ key: "youtube" as const, label: "YouTube", brand: "youtube" as Brand }] : []),
    { key: "linkedin", label: "LinkedIn", brand: "linkedin" },
    { key: "twitch", label: "Twitch", brand: "twitch" },
    { key: "kick", label: "Kick", brand: "kick" },
    { key: "x", label: "X", brand: "x" },
    { key: "facebook", label: hasFacebook ? "Another Facebook page" : "Facebook", brand: "facebook" },
    { key: "other", label: "Somewhere else", brand: null },
  ];
  const any = !!s.livePage?.url || s.youtube || s.streams.length > 0;
  return (
    <section className="space-y-3.5" data-testid="studio-where-live">
      <div>
        <Label>Go live goes to every place switched on</Label>
        {s.live && <p className="mb-2 text-[12.5px] text-muted-foreground">You're live. Change these after the show.</p>}
        <div className={card}>
          {s.livePage?.url && (
            <Place mark={<span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[11px] font-extrabold text-white" style={{ background: NAVY }}>MV</span>}
              name="MilitaryVoices.ai" line={`Your live page: ${bare(s.livePage.url)}`} on={!!s.livePage.on} disabled={lock} onToggle={() => void page(!s.livePage!.on)} testId="studio-dest-page" />
          )}
          {s.youtube && (
            <Place mark={<Mark brand="youtube" />} name="YouTube" line={s.youtubeKey ? `Stream key ${s.youtubeKey}` : "Your channel · connected"}
              on={s.youtubeOn} disabled={lock} onToggle={() => void patch("yt", { youtubeOn: !s.youtubeOn })} testId="studio-dest-youtube" />
          )}
          {s.streams.map((x) => (
            <Place key={x.id} mark={<Mark brand={brandOf(x.name)} />} name={x.name}
              line={`Stream key ${x.key || "in the address"}${x.on ? "" : " · off, Go live skips it"}`}
              on={x.on} disabled={lock} onToggle={() => void patch(x.id, { toggleStream: x.id })} testId={`studio-dest-${x.id}`}
              extra={removing === x.id ? (
                <span className="flex shrink-0 items-center gap-2 text-[13px]">
                  <button type="button" onClick={() => { setRemoving(""); void patch(x.id, { removeStream: x.id }, "Couldn't remove it"); }} disabled={lock} className="font-bold text-[#b42318] hover:underline">Remove</button>
                  <button type="button" onClick={() => setRemoving("")} className="font-semibold text-muted-foreground hover:text-foreground">Keep</button>
                </span>
              ) : (
                <button type="button" onClick={() => setRemoving(x.id)} disabled={lock} className="shrink-0 text-[13px] font-semibold text-muted-foreground hover:text-[#b42318] disabled:opacity-50" data-testid={`studio-dest-remove-${x.id}`}>Remove</button>
              )} />
          ))}
          {!any && <p className="px-4 py-3.5 text-sm text-muted-foreground">Nowhere yet. Add a place below and Go live goes there.</p>}
        </div>
      </div>

      {!s.live && (
        <div>
          <Label>Add another place</Label>
          <div className={card}>
            <div className="flex flex-wrap gap-2 p-3 sm:px-4">
              {chips.map((c) => (
                <button key={c.key} type="button" onClick={() => setAdding(adding === c.key ? null : c.key)} aria-pressed={adding === c.key}
                  className={`inline-flex h-[38px] items-center gap-2 rounded-[10px] border bg-card pl-1.5 pr-3 text-[13.5px] font-semibold ${adding === c.key ? "border-[#053877] shadow-[0_0_0_2px_rgba(5,56,119,0.15)] dark:border-white" : "border-border hover:bg-muted"}`} data-testid={`studio-add-${c.key}`}>
                  {c.brand ? <BrandMark brand={c.brand} tile className="h-3.5 w-3.5" tileClassName="h-6 w-6 rounded-md" title="" /> : <span className="flex h-6 w-6 items-center justify-center rounded-md border border-border bg-white"><Radio className="h-3.5 w-3.5 text-[#344054]" aria-hidden /></span>}
                  {c.label}
                </button>
              ))}
            </div>
            {adding === "youtube" ? <AddYoutube s={s} onDone={() => setAdding(null)} /> : adding ? <AddKey key={adding} site={adding} onDone={() => setAdding(null)} /> : null}
          </div>
        </div>
      )}
    </section>
  );
}

const field = "h-10 w-full rounded-[9px] border border-[#d0d5dd] bg-white px-3 text-sm text-[#101828] outline-none focus:border-[#053877] focus:ring-2 focus:ring-[#053877]/15";

function Steps({ site }: { site: KeySite }) {
  const info = SITES[site];
  return (
    <ol className="space-y-1 text-[12.5px] text-muted-foreground">
      {info.steps.map((x, i) => <li key={i}><span className="font-semibold text-foreground">{i + 1}.</span> {x}{i === 0 && info.link && <> <a href={info.link.href} target="_blank" rel="noreferrer" className="font-semibold text-[#053877] underline underline-offset-2 dark:text-white">{info.link.text}</a></>}</li>)}
    </ol>
  );
}

function AddKey({ site, onDone }: { site: KeySite; onDone: () => void }) {
  const info = SITES[site];
  const { busy, patch } = useDestActions();
  const [name, setName] = useState("");
  const [url, setUrl] = useState(info.server);
  const [key, setKey] = useState("");
  const cta = site === "other" ? "Add it" : `Add ${info.name}`;
  const save = async () => {
    const ok = await patch("add", { addStream: { name: site === "other" ? name.trim() || "Custom" : info.name, url: url.trim(), key: key.trim() } }, "Couldn't add it");
    if (ok) onDone();
  };
  return (
    <form onSubmit={(e) => { e.preventDefault(); void save(); }} className="space-y-3 rounded-b-[14px] border-t border-border bg-muted/40 p-3 sm:px-4" data-testid={`studio-add-form-${site}`}>
      <Steps site={site} />
      <div className={`grid items-end gap-2 ${site === "other" ? "sm:grid-cols-[160px_1fr_1fr_auto]" : "sm:grid-cols-[1fr_1fr_auto]"}`}>
        {site === "other" && (
          <label className="block text-xs font-semibold text-muted-foreground">Name it
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} placeholder="The site's name" className={`${field} mt-1`} required />
          </label>
        )}
        <label className="block text-xs font-semibold text-muted-foreground">Server address
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="rtmps://…" className={`${field} mt-1`} required autoComplete="off" spellCheck={false} data-testid="studio-add-url" />
        </label>
        <label className="block text-xs font-semibold text-muted-foreground">Stream key
          <input value={key} onChange={(e) => setKey(e.target.value)} type="password" placeholder="Paste it here" className={`${field} mt-1`} required autoComplete="off" data-testid="studio-add-key" />
        </label>
        <div className="flex gap-1">
          <button type="submit" disabled={busy !== "" || !url.trim() || !key.trim()} className={navyBtn} style={{ background: NAVY }} data-testid="studio-add-save">{busy === "add" && <Loader2 className="h-4 w-4 animate-spin" />}{cta}</button>
          <button type="button" onClick={onDone} className="h-10 px-3 text-sm font-semibold text-muted-foreground hover:text-foreground">Cancel</button>
        </div>
      </div>
      <p className="text-[12px] text-muted-foreground">The key is kept private and only used to send your show there. It goes on as soon as it's added.</p>
    </form>
  );
}

function AddYoutube({ s, onDone }: { s: Studio; onDone: () => void }) {
  // Connect YouTube is the main way in for the accounts Google lets through; everyone else pastes a key.
  const canConnect = !!useYoutubeKey().data?.canConnect;
  const { patch } = useDestActions();
  return (
    <div className="space-y-3 rounded-b-[14px] border-t border-border bg-muted/40 p-3 sm:px-4" data-testid="studio-add-form-youtube">
      {canConnect && <a href={youtubeConnectHref("studio")} className={`${navyBtn} w-full sm:w-auto`} style={{ background: NAVY }}>Connect YouTube</a>}
      <YoutubeKeyForm compact onSaved={() => { void (s.youtubeOn ? Promise.resolve(true) : patch("yt", { youtubeOn: true })).then(onDone); }} />
    </div>
  );
}
