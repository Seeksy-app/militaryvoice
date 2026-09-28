import { Fragment, useState } from "react";
import { ArrowRight, Check, Eye, Handshake, Headphones, Pause, Play, Send, Sparkles, Users } from "lucide-react";
import { PlatformIcon, platformBackground, platformLabel } from "@/components/SocialIcons";
import { PageTop, SocialRow, onColor, styled } from "@/components/BioPageView";
import { useBioFont } from "@/lib/bioFont";
import { podcastWorthFor, worthFor, type Deliverable } from "@/lib/worth";
import { BRANDS_SECTIONS, DEFAULT_BRANDS, arrange, bioPalette, videoEmbed, type BioBrandsPublic, type BrandsSectionId } from "@shared/bio";
import type { SocialPlatform } from "@shared/schema";

/**
 * The Brands view (militaryvoices.ai/<handle>/brands): a media kit. The
 * numbers are ours (downloads we count or read from their host, followers
 * from their connected accounts, page views), never typed in; the words and
 * the brands they've worked with are theirs. One way to act: Sponsor this show.
 */

const compact = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M` : n >= 10_000 ? `${Math.round(n / 1000)}K` : n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(Math.round(n)));
const money = (n: number) => `$${Math.round(n).toLocaleString()}`;
const dateOf = (iso: string) => (iso ? new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "");

/**
 * The rate card: the podcast's (from downloads per episode) and their biggest
 * social accounts' (from followers, and how the audience behaves where we can
 * see it), each worked out the way Know Your Worth does.
 */
export function ratesFor(data: BioBrandsPublic): { key: string; title: string; note: string; items: Deliverable[] }[] {
  const n = data.numbers;
  const a = data.audience;
  const unit = n.unit === "streams" ? "streams" : "downloads";
  const out: { key: string; title: string; note: string; items: Deliverable[] }[] = [];
  const pod = n.perEpisode ? podcastWorthFor(n.perEpisode) : null;
  if (pod) out.push({ key: "podcast", title: data.podcast?.title ? `Podcast: ${data.podcast.title}` : "Podcast", note: `From about ${compact(n.perEpisode!)} ${unit} per episode.`, items: pod.deliverables });
  const us = a?.countries.find((c) => /^(us|usa|united states)/i.test(c.name))?.pct ?? null;
  for (const f of n.followers.slice(0, 2)) {
    const same = a && a.platform === f.platform;
    const w = worthFor({ platform: f.platform, followers: f.followers, engagementRate: same ? a!.engagementRate : null, medianViews: same ? a!.medianViews : null, realPct: same ? a!.realPct : null, usPct: same ? us : null });
    if (w) out.push({ key: f.platform, title: platformLabel(f.platform as SocialPlatform), note: `From ${compact(f.followers)} followers${same && a!.engagementRate != null ? ` and ${a!.engagementRate.toFixed(1)}% engagement` : ""}.`, items: w.deliverables });
  }
  return out;
}

export type SponsorAsk = { name: string; company: string; email: string; budget: string; message: string; website: string };

export function BioBrandsView({ data, preview = false, onSponsor, listenUrl }: {
  data: BioBrandsPublic;
  preview?: boolean;
  onSponsor?: (x: SponsorAsk) => Promise<void>;
  /** Their listener page. */
  listenUrl: string;
}) {
  const t = data.theme;
  const pal = bioPalette(t);
  const { theirs, dark, ink, sub, card, line, accent, font } = pal;
  useBioFont(t.font);
  const kit = { ...DEFAULT_BRANDS, ...data.kit };
  const n = data.numbers;
  const unit = n.unit === "streams" ? "streams" : "downloads";
  const Unit = `${unit[0].toUpperCase()}${unit.slice(1)}`;
  const rates = kit.showRates ? ratesFor(data) : [];
  const [asking, setAsking] = useState(false);
  const name = kit.name?.trim() || data.displayName || "Your name";
  const sponsorOn = kit.sponsorOn ?? true;
  const cta = data.podcast ? "Sponsor this show" : "Work with me";
  const socials = data.socials ?? [];
  // Their reel: a link plays in its own player; one they uploaded plays from our copy.
  const kv = kit.video ?? "";
  const video = kv.startsWith("r2:") ? (data.media?.video?.from === kv ? { kind: "file" as const, src: data.media.video.url, tall: false } : null) : videoEmbed(kv);
  const sample = kit.sample && data.media?.sample?.from === kit.sample ? data.media.sample : null;
  const [hearing, setHearing] = useState(false);

  const a = data.audience;
  // Just the numbers: the big figure and what it is.
  const stats = [
    n.perEpisode ? { k: "per", big: compact(n.perEpisode), label: `${Unit} per episode` } : null,
    n.last30 ? { k: "30", big: compact(n.last30), label: `${Unit}, last 30 days` } : null,
    n.reach ? { k: "reach", big: compact(n.reach), label: "Social followers" } : null,
    a?.medianViews ? { k: "views2", big: compact(a.medianViews), label: `Typical ${a.platform === "youtube" ? "video" : a.platform === "tiktok" ? "TikTok" : "Reel"} views` } : null,
    // Their strengths only: engagement and real followers show when they help (the kit is theirs to put forward).
    a?.engagementRate != null && a.engagementRate >= 1 ? { k: "eng", big: `${a.engagementRate.toFixed(1)}%`, label: `Engagement on ${platformLabel(a.platform as SocialPlatform)}` } : null,
    a?.realPct != null && a.realPct >= 60 ? { k: "real", big: `${Math.round(a.realPct)}%`, label: "Real followers" } : null,
    n.pageViews30 ? { k: "views", big: compact(n.pageViews30), label: "Page views, last 30 days" } : null,
    !n.last30 && n.total ? { k: "total", big: compact(n.total), label: `${Unit}, all time` } : null,
  ].filter(Boolean).slice(0, 6) as { k: string; big: string; label: string }[];

  const bars = (rows: { name: string; pct: number }[]) => (
    <div className="flex flex-col gap-2.5">
      {rows.map((r, i) => (
        <div key={r.name}>
          <div className="flex justify-between text-sm"><span className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full" style={{ background: HUES[i % HUES.length] }} />{r.name}</span><span className="font-semibold tabular-nums">{Math.round(r.pct)}%</span></div>
          <div className="mt-1 h-2.5 overflow-hidden rounded-full" style={{ background: line }}><div className="h-full rounded-full" style={{ width: `${Math.min(100, r.pct)}%`, background: `linear-gradient(90deg, ${HUES[i % HUES.length]}, ${HUES[i % HUES.length]}cc)` }} /></div>
        </div>
      ))}
    </div>
  );
  const chips = (xs: string[]) => <div className="flex flex-wrap gap-1.5">{xs.map((x, i) => <span key={x} className="rounded-full px-3 py-1.5 text-xs font-semibold" style={{ background: `${HUES[i % HUES.length]}24`, color: ink, border: `1px solid ${HUES[i % HUES.length]}55` }}>{x}</span>)}</div>;
  const section = (title: string, body: React.ReactNode, testid?: string) => (
    <section className="rounded-3xl p-5 text-left" style={{ background: card, border: `1px solid ${line}` }} data-testid={testid}>
      <p className="mb-3 text-xs font-bold uppercase tracking-[0.14em]" style={{ color: sub }}>{title}</p>
      {body}
    </section>
  );
  const ask = () => { setAsking(true); setTimeout(() => document.getElementById("sponsor")?.scrollIntoView({ behavior: "smooth", block: "center" }), 50); };

  // Who they are, for a brand: over their photo (white) or on the page.
  const who = (onPhoto: boolean, hideName = false) => (
    <>
      <p className="relative mx-auto mt-4 w-fit rounded-full px-3 py-1 text-[11px] font-bold uppercase tracking-[0.2em]" style={onPhoto ? { background: "rgba(0,0,0,0.25)", color: "#fff" } : { background: `${accent}22`, color: accent }}>Media kit</p>
      {!hideName && <h1 className="relative mt-1 text-balance text-[28px] font-bold leading-tight tracking-tight">{name}</h1>}
      <p className="relative mt-1 text-sm" style={{ color: onPhoto ? "rgba(255,255,255,0.75)" : sub }}>{[data.podcast ? `Host of ${data.podcast.title}` : "", data.branch].filter(Boolean).join(" · ")}</p>
      {kit.pitch && <p className="relative mx-auto mt-3 max-w-md whitespace-pre-line text-[15px] leading-relaxed" style={{ color: onPhoto ? "rgba(255,255,255,0.9)" : ink }}>{styled(kit.pitch)}</p>}
      <SocialRow socials={socials} onPhoto={onPhoto} preview={preview} />
      {sponsorOn && (
        <button type="button" onClick={ask} className="relative mt-5 inline-flex items-center gap-2 rounded-full bg-[#F0A71F] px-6 py-3 text-sm font-bold text-[#1a1200] shadow-lg transition-transform hover:scale-[1.03]" data-testid="brands-cta-top">
          <Handshake className="h-4 w-4" /> {cta}
        </button>
      )}
    </>
  );

  const parts: Record<BrandsSectionId, React.ReactNode> = {
    video: video && (
      <section className="overflow-hidden rounded-3xl" style={{ background: "#000", border: `1px solid ${line}` }} data-testid="brands-video">
        {video.kind === "file"
          ? <video src={video.src} controls playsInline preload="metadata" className="max-h-[640px] w-full bg-black" />
          : <iframe src={video.src} title="Video" loading="lazy" className={`w-full ${video.tall ? "h-[620px]" : "aspect-video"}`} style={{ border: 0 }} allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowFullScreen />}
      </section>
    ),
    sample: sample && (
      <section className="rounded-3xl p-4 text-left" style={{ background: card, border: `1px solid ${line}` }} data-testid="brands-sample">
        <div className="flex items-center gap-3">
          <button type="button" onClick={() => !preview && setHearing(!hearing)} aria-label={hearing ? "Pause the sample" : "Play the sample"} className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full shadow" style={{ background: accent, color: onColor(accent) }}>{hearing ? <Pause className="h-5 w-5 fill-current" /> : <Play className="h-5 w-5 translate-x-px fill-current" />}</button>
          <span className="min-w-0 flex-1"><span className="block text-[11px] font-bold uppercase tracking-[0.12em]" style={{ color: accent }}>Hear a sample</span><span className="line-clamp-2 block text-sm font-semibold leading-snug">{sample.title}</span></span>
        </div>
        {hearing && <audio src={sample.audio} autoPlay controls preload="none" className="mt-3 w-full" onEnded={() => setHearing(false)} />}
      </section>
    ),
    stats: stats.length > 0 && (
      <section className="rounded-3xl p-1 text-left" style={{ background: card, border: `1px solid ${line}` }} data-testid="brands-stats">
        <div className="grid grid-cols-2">
          {stats.map((x, i) => (
            <div key={x.k} className="px-4 py-3.5" style={{ borderTop: i > 1 ? `1px solid ${line}` : undefined, borderLeft: i % 2 ? `1px solid ${line}` : undefined }}>
              <p className="text-[26px] font-bold leading-none tabular-nums" style={{ color: i === 0 ? accent : ink }}>{x.big}</p>
              <p className="mt-1 text-xs" style={{ color: sub }}>{x.label}</p>
            </div>
          ))}
        </div>
        <p className="flex items-center justify-center gap-1 pb-2 pt-1 text-[11px]" style={{ color: sub }}><Check className="h-3 w-3" /> Measured by MilitaryVoices{n.source ? `, from ${n.source}` : ""}</p>
      </section>
    ),
    reach: n.followers.length > 0 && section("Social reach", (
      <div className="flex flex-col">
        {n.followers.map((f, i) => (
          <div key={f.platform} className="flex items-center gap-3 py-2.5" style={i ? { borderTop: `1px solid ${line}` } : {}}>
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white" style={{ background: platformBackground(f.platform as SocialPlatform) }}><PlatformIcon platform={f.platform as SocialPlatform} className="h-[18px] w-[18px]" /></span>
            <span className="min-w-0 flex-1"><span className="block text-sm font-semibold">{platformLabel(f.platform as SocialPlatform)}</span>{f.username && !/^\d+$/.test(f.username) && <span className="block truncate text-xs" style={{ color: sub }}>@{f.username.replace(/^@/, "")}</span>}</span>
            <span className="text-base font-bold tabular-nums">{compact(f.followers)}</span>
          </div>
        ))}
      </div>
    )),
    audience: (kit.audience || a) && section("Who listens", (
      <div className="flex flex-col gap-5">
        {kit.audience && <p className="whitespace-pre-line text-[15px] leading-relaxed">{styled(kit.audience)}</p>}
        {a && (a.femalePct != null || a.malePct != null) && (
          <div>
            <div className="flex h-4 overflow-hidden rounded-full"><div style={{ width: `${a.malePct ?? 0}%`, background: MEN }} /><div style={{ width: `${a.femalePct ?? 0}%`, background: WOMEN }} /></div>
            <div className="mt-2 flex justify-between text-xs" style={{ color: sub }}>
              <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full" style={{ background: MEN }} /><b style={{ color: ink }}>{Math.round(a.malePct ?? 0)}%</b> men</span>
              <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full" style={{ background: WOMEN }} /><b style={{ color: ink }}>{Math.round(a.femalePct ?? 0)}%</b> women</span>
            </div>
          </div>
        )}
        {a && a.ages.length > 0 && <div><p className="mb-2 text-xs font-semibold" style={{ color: sub }}>Ages</p>{bars(a.ages.filter((x) => x.pct >= 1).map((x) => ({ ...x, name: x.name.replace(/-$/, "+") })))}</div>}
        {a && a.countries.length > 0 && <div><p className="mb-2 text-xs font-semibold" style={{ color: sub }}>Top countries</p>{bars(a.countries.slice(0, 4))}</div>}
        {a && a.states.length > 0 && <div><p className="mb-2 text-xs font-semibold" style={{ color: sub }}>Top US states</p>{bars(a.states.slice(0, 4))}</div>}
        {a && a.interests.length > 0 && <div><p className="mb-2 text-xs font-semibold" style={{ color: sub }}>What they're into</p>{chips(a.interests)}</div>}
        {a && a.affinity.length > 0 && <div><p className="mb-2 text-xs font-semibold" style={{ color: sub }}>Brands they follow</p>{chips(a.affinity)}</div>}
        {a && <p className="text-[11px] leading-snug" style={{ color: sub }}>Audience of @{a.handle} on {platformLabel(a.platform as SocialPlatform)}, measured independently{a.asOf ? ` as of ${new Date(a.asOf).toLocaleDateString(undefined, { month: "short", year: "numeric" })}` : ""}.</p>}
      </div>
    ), "brands-audience"),
    rates: rates.length > 0 && section("Sponsorship rates", (
      <div className="flex flex-col gap-4">
        {rates.map((g) => (
          <div key={g.key}>
            <p className="flex items-center gap-2 text-sm font-bold">
              {g.key === "podcast" ? <Headphones className="h-4 w-4" style={{ color: accent }} /> : <span className="flex h-6 w-6 items-center justify-center rounded-full text-white" style={{ background: platformBackground(g.key as SocialPlatform) }}><PlatformIcon platform={g.key as SocialPlatform} className="h-3.5 w-3.5" /></span>}
              {g.title}
            </p>
            {g.items.map((d, i) => (
              <div key={d.key} className="flex items-start gap-3 py-2.5" style={i ? { borderTop: `1px solid ${line}` } : {}}>
                <span className="min-w-0 flex-1"><span className="block text-sm font-semibold">{d.label}</span><span className="block text-xs leading-snug" style={{ color: sub }}>{d.hint.replace(/, read by you/, ", read by the host").replace(/read by you/, "read by the host")}</span></span>
                <span className="shrink-0 text-right text-base font-bold tabular-nums">{Math.round(d.low) === Math.round(d.high) ? money(d.mid) : `${money(d.low)}–${money(d.high)}`}</span>
              </div>
            ))}
            <p className="text-[11px] leading-snug" style={{ color: sub }}>{g.note}</p>
          </div>
        ))}
        <p className="text-[11px] leading-snug" style={{ color: sub }}>At 2025–26 market rates. The final price is agreed with {name}.</p>
      </div>
    )),
    partners: (kit.partners.length > 0 || (a?.pastSponsors.length ?? 0) > 0) && section("Brands I've worked with", (
      <div className="flex flex-col gap-3">
        {kit.partners.some((p) => p.logo) && (
          <div className="grid grid-cols-3 gap-2.5">
            {kit.partners.filter((p) => p.logo).map((p) => {
              const tile = (
                <span className="flex flex-col items-center gap-1.5 rounded-2xl p-3 text-center" style={{ background: dark ? "rgba(255,255,255,0.05)" : "#f7f8fb", border: `1px solid ${line}` }}>
                  <span className="flex h-12 w-12 items-center justify-center overflow-hidden rounded-xl bg-white p-1.5 shadow-sm"><img src={p.logo} alt="" className="max-h-full max-w-full object-contain" /></span>
                  <span className="line-clamp-1 text-xs font-semibold">{p.name || p.url.replace(/^https?:\/\/(www\.)?/, "").split("/")[0]}</span>
                </span>
              );
              return p.url && !preview ? <a key={p.id} href={p.url} target="_blank" rel="noreferrer">{tile}</a> : <span key={p.id}>{tile}</span>;
            })}
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          {kit.partners.filter((p) => !p.logo).map((p) => {
            const chip = <span className="inline-flex items-center gap-1.5 rounded-full px-3.5 py-2 text-sm font-semibold" style={{ border: `1px solid ${line}`, background: dark ? "rgba(255,255,255,0.04)" : "#f7f8fb" }}><Sparkles className="h-3.5 w-3.5" style={{ color: accent }} />{p.name || p.url.replace(/^https?:\/\/(www\.)?/, "")}</span>;
            return p.url && !preview ? <a key={p.id} href={p.url} target="_blank" rel="noreferrer">{chip}</a> : <span key={p.id}>{chip}</span>;
          })}
          {(a?.pastSponsors ?? []).filter((h) => !kit.partners.some((p) => p.name.toLowerCase().replace(/\W/g, "") === h.toLowerCase().replace(/\W/g, ""))).map((h) => (
            <span key={h} className="inline-flex items-center gap-1.5 rounded-full px-3.5 py-2 text-sm font-semibold" style={{ border: `1px solid ${line}`, background: dark ? "rgba(255,255,255,0.04)" : "#f7f8fb" }}>@{h.replace(/^@/, "")}</span>
          ))}
        </div>
      </div>
    ), "brands-partners"),
    episodes: data.podcast && data.podcast.latest.length > 0 && section("Latest episodes", (
      <div className="flex flex-col">
        {data.podcast.latest.map((e, i) => (
          <div key={i} className="flex items-center gap-3 py-2.5" style={i ? { borderTop: `1px solid ${line}` } : {}}>
            <span className="h-12 w-12 shrink-0 rounded-xl" style={{ background: e.artworkUrl ? `center/cover url(${e.artworkUrl})` : data.avatarUrl ? `center/cover url(${data.avatarUrl})` : `linear-gradient(135deg, ${theirs}, #000741)` }} />
            <span className="min-w-0 flex-1"><span className="line-clamp-2 block text-sm font-semibold leading-snug">{e.title}</span><span className="text-xs" style={{ color: sub }}>{dateOf(e.publishedAt)}</span></span>
          </div>
        ))}
        <a href={preview ? undefined : listenUrl} className="mt-2 inline-flex items-center gap-1 text-sm font-semibold" style={{ color: accent }}>Listen to the show <ArrowRight className="h-4 w-4" /></a>
      </div>
    )),
    sponsor: sponsorOn && <SponsorBox cta={cta} name={name} open={asking} setOpen={setAsking} preview={preview} onSponsor={onSponsor} ink={ink} sub={sub} card={card} line={line} dark={dark} />,
  };
  const order = arrange(BRANDS_SECTIONS, kit.order).filter((id) => !kit.hidden.includes(id));
  const photo = kit.photo || data.avatarUrl;

  return (
    <div style={{ background: pal.background, color: ink, fontFamily: font, minHeight: "100%" }} className="pb-10" data-testid="bio-brands">
      {kit.layout ? (
        // One of the page's layouts, with the kit's own photo (a cutout only when it's the page's photo).
        <PageTop t={{ ...t, layout: kit.layout, hideName: false }} avatar={photo} hero={kit.photo ? "" : data.heroUrl ?? ""} cutoutUrl={kit.photo ? "" : data.cutoutUrl} name={name} handle={data.handle}>
          {(onPhoto, hideName) => <div className={onPhoto ? "text-white" : ""}>{who(onPhoto, hideName)}</div>}
        </PageTop>
      ) : (
        // The kit's own top: a band in their colour.
        <div className="relative overflow-hidden px-5 pb-8 pt-10 text-center text-white" style={{ background: `linear-gradient(145deg, ${theirs} 0%, #000741 85%)` }}>
          <span className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full border border-white/10" aria-hidden />
          <span className="pointer-events-none absolute -right-4 -top-4 h-56 w-56 rounded-full border border-white/10" aria-hidden />
          {photo && <img src={photo} alt="" className="relative mx-auto h-24 w-24 rounded-full object-cover ring-4 ring-white/25" />}
          {who(true)}
        </div>
      )}

      <div className="mx-auto flex max-w-[560px] flex-col gap-4 px-4 pt-5">
        {order.map((id) => parts[id] ? <Fragment key={id}>{parts[id]}</Fragment> : null)}
        <p className="mt-2 text-center text-xs" style={{ color: sub }}><a href={preview ? undefined : "https://www.militaryvoices.ai"} className="hover:underline">Media kit by MilitaryVoices.ai</a></p>
      </div>
    </div>
  );
}

/** Colours for the audience charts. */
const HUES = ["#F0A71F", "#3B82F6", "#10B981", "#EC4899", "#8B5CF6", "#F97316", "#06B6D4", "#EF4444"];
const MEN = "#3B82F6";
const WOMEN = "#EC4899";

/** Sponsor this show: a brand's note goes to our partnerships team, who help the podcaster close it. */
function SponsorBox({ cta, name, open, setOpen, preview, onSponsor, ink, sub, card, line, dark }: { cta: string; name: string; open: boolean; setOpen: (v: boolean) => void; preview: boolean; onSponsor?: (x: SponsorAsk) => Promise<void>; ink: string; sub: string; card: string; line: string; dark: boolean }) {
  const [f, setF] = useState<SponsorAsk>({ name: "", company: "", email: "", budget: "", message: "", website: "" });
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [err, setErr] = useState("");
  const field = { background: "transparent", border: `1px solid ${line}`, color: ink, borderRadius: 12 };
  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    if (preview || !onSponsor) return;
    if (!f.name.trim() || !f.email.trim()) { setErr("Add your name and email."); return; }
    setState("sending"); setErr("");
    try { await onSponsor(f); setState("sent"); } catch (x) { setState("idle"); setErr((x as Error).message); }
  };
  return (
    <section id="sponsor" className="overflow-hidden rounded-3xl text-left" style={{ background: card, border: `1px solid ${line}` }} data-testid="brands-sponsor">
      <div className="p-5" style={{ background: "linear-gradient(135deg, rgba(240,167,31,0.18), rgba(5,56,119,0.12))" }}>
        <p className="flex items-center gap-2 text-lg font-bold"><Handshake className="h-5 w-5 text-[#F0A71F]" /> {cta === "Work with me" ? `Work with ${name}` : `Sponsor ${name}`}</p>
        <p className="mt-1 text-sm" style={{ color: sub }}>Tell us what you have in mind. Our partnerships team replies within one business day.</p>
      </div>
      <div className="p-5 pt-4">
        {state === "sent" ? (
          <p className="flex items-center gap-2 text-sm font-semibold"><Check className="h-4 w-4 text-emerald-500" /> Thanks. We'll be in touch within one business day.</p>
        ) : !open ? (
          <button type="button" onClick={() => setOpen(true)} className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-[#F0A71F] px-5 py-3 text-sm font-bold text-[#1a1200]" data-testid="brands-cta">Start a conversation <ArrowRight className="h-4 w-4" /></button>
        ) : (
          <form onSubmit={send} className="flex flex-col gap-2">
            <div className="grid grid-cols-2 gap-2">
              <input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Your name" autoComplete="name" className="h-11 min-w-0 px-3 text-sm outline-none" style={field} />
              <input value={f.company} onChange={(e) => setF({ ...f, company: e.target.value })} placeholder="Company" autoComplete="organization" className="h-11 min-w-0 px-3 text-sm outline-none" style={field} />
            </div>
            <input value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} type="email" placeholder="Work email" autoComplete="email" className="h-11 px-3 text-sm outline-none" style={field} />
            <select value={f.budget} onChange={(e) => setF({ ...f, budget: e.target.value })} className="h-11 px-3 text-sm outline-none" style={{ ...field, background: dark ? "#151b2f" : "#ffffff" }}>
              <option value="">Budget (optional)</option>
              <option>Under $500</option>
              <option>$500–$2,000</option>
              <option>$2,000–$10,000</option>
              <option>$10,000+</option>
            </select>
            <textarea value={f.message} onChange={(e) => setF({ ...f, message: e.target.value })} rows={3} maxLength={2000} placeholder="What would you like to do? (an ad read, a series, an event…)" className="resize-none px-3 py-2 text-sm outline-none" style={field} />
            <input value={f.website} onChange={(e) => setF({ ...f, website: e.target.value })} tabIndex={-1} autoComplete="off" aria-hidden className="hidden" name="website" />
            {err && <p className="text-xs text-red-500">{err}</p>}
            <button type="submit" disabled={state === "sending"} className="mt-1 inline-flex items-center justify-center gap-2 rounded-full bg-[#F0A71F] px-5 py-3 text-sm font-bold text-[#1a1200] disabled:opacity-60"><Send className="h-4 w-4" /> {state === "sending" ? "Sending…" : "Send"}</button>
          </form>
        )}
      </div>
    </section>
  );
}
