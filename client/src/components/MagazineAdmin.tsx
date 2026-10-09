import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BookOpen, Camera, Check, EyeOff, ExternalLink, ImageIcon, Loader2, Mail, Megaphone, Plus, Printer, Sparkles, Trash2, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { adminSend, adminUpload } from "@/lib/adminApi";
import { fitForUpload } from "@/lib/cropImage";
import { CoverCollage, type CoverStyle, type Face } from "@/pages/Magazine";

type Show = { signupId: number; number: number; time: string; podcastName: string; hostName: string; headshot: string; printQuality: boolean; art: string; blurb: string; quote: string; onTheDay?: string; link: string; audio?: string; about?: string; aboutOwn?: string; links?: { title: string; url: string }[] };
type Ad = { id: number; sponsorId: number; name: string; headline: string; body: string; site: string; logo: string; artwork: string };
type Mag = { event: { name: string }; published: boolean; welcome: string; shows: Show[]; leftOut?: { signupId: number; podcastName: string; hostName: string }[]; cover?: { photo: string; style?: string }; ads?: Ad[]; segments?: { done: number; working: number; failed: number }; distributed?: { at: string; sent: number } | null; award?: Award | null };
type Award = { signupId: number; title: string; name: string; show: string; citation: string; quote: string; photo: string; plaque: string };

/**
 * The keepsake magazine, from admin: SI drafts every page, a person reads and
 * edits each one, then it's published (the digital magazine opens to everyone)
 * and printed (Print / save as PDF gives the US Letter file for the printer).
 */
export function MagazineAdmin({ eventId, slug }: { eventId: number; slug: string }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const key = ["/api/magazine", slug];
  const q = useQuery<Mag>({ queryKey: key, queryFn: async () => (await fetch(`/api/magazine/${encodeURIComponent(slug)}`, { credentials: "include" })).json() });
  const [drafting, setDrafting] = useState(false);
  const [saving, setSaving] = useState<number | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: key });
  // Their photo, put in for them: the same web and print copies the headshot page makes.
  const changePhoto = async (s: Show, f: File) => {
    setSaving(s.signupId);
    try {
      const fd = new FormData();
      fd.append("photo", await fitForUpload(f), f.name);
      const r = (await (await adminUpload(`/api/admin/signups/${s.signupId}/photo`, fd)).json()) as { width: number; height: number };
      await refresh();
      const small = Math.min(r.width, r.height) > 0 && Math.max(r.width, r.height) < 2000;
      toast({ title: `${s.hostName}'s photo is in`, description: small ? `It's ${r.width} × ${r.height}: sharp online, a little soft on the printed page. Ask them for the original file if they have it.` : "On their page, the cover and their SmartLink." });
    } catch (e) {
      toast({ title: "Couldn't change the photo", description: (e as Error).message, variant: "destructive" });
    } finally {
      setSaving(null);
    }
  };
  const [asked, setAsked] = useState<Set<number>>(new Set());
  const askPhoto = async (s: Show) => {
    setSaving(s.signupId);
    try {
      const r = (await (await adminSend("POST", `/api/admin/signups/${s.signupId}/ask-photo`)).json()) as { to: string };
      setAsked((a) => new Set(a).add(s.signupId));
      toast({ title: `Asked ${s.hostName} for a photo`, description: `Sent to ${r.to} with their own upload link.` });
    } catch (e) {
      toast({ title: "Couldn't send", description: (e as Error).message, variant: "destructive" });
    } finally {
      setSaving(null);
    }
  };
  const leaveOut = async (signupId: number, hidden: boolean, name: string) => {
    setSaving(signupId);
    try {
      await adminSend("PUT", `/api/admin/magazine/${eventId}/pages/${signupId}`, { hidden });
      await refresh();
      toast({ title: hidden ? `${name} is out of the magazine` : `${name} is back in the magazine` });
    } catch (e) {
      toast({ title: "Couldn't change that", description: (e as Error).message, variant: "destructive" });
    } finally {
      setSaving(null);
    }
  };
  // "On the day" and a quote for every show, from the transcript of their live segment.
  const [filling, setFilling] = useState(false);
  const fromTheDay = async () => {
    setFilling(true);
    try {
      const r = (await (await adminSend("POST", `/api/admin/magazine/${eventId}/from-the-day`, {})).json()) as { done: string[]; skipped: { show: string; why: string }[] };
      toast({ title: `${r.done.length} pages now say what they talked about on the day`, description: r.skipped.length ? `Not done: ${r.skipped.map((x) => `${x.show} (${x.why})`).join("; ")}` : "Read each one and change anything." });
      refresh();
    } catch (e) {
      toast({ title: "Couldn't fill from the day", description: (e as Error).message, variant: "destructive" });
    }
    setFilling(false);
  };
  const draft = async (all = false) => {
    setDrafting(true);
    try {
      const r = (await (await adminSend("POST", `/api/admin/magazine/${eventId}/draft${all ? "?all=1" : ""}`)).json()) as { drafted: number; failed: string[] };
      toast({ title: `SI drafted ${r.drafted} page${r.drafted === 1 ? "" : "s"}`, description: r.failed.length ? `Couldn't draft: ${r.failed.join(", ")}` : "Read each one and change anything." });
      await refresh();
    } catch (e) {
      toast({ title: "Drafting failed", description: (e as Error).message, variant: "destructive" });
    } finally {
      setDrafting(false);
    }
  };
  const save = async (signupId: number, patch: { blurb?: string; quote?: string; audio?: string; about?: string; links?: string; onTheDay?: string }) => {
    setSaving(signupId);
    try { await adminSend("PUT", `/api/admin/magazine/${eventId}/pages/${signupId}`, patch); await refresh(); }
    catch (e) { toast({ title: "Couldn't save", description: (e as Error).message, variant: "destructive" }); }
    finally { setSaving(null); }
  };
  const publish = async (on: boolean) => {
    await adminSend("POST", `/api/admin/magazine/${eventId}/publish`, { published: on });
    await refresh();
    toast({ title: on ? "The magazine is out" : "Back to admins only", description: on ? "Anyone with the link can read it now." : undefined });
  };

  if (q.isLoading || !q.data?.shows) return <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  const m = q.data;
  const drafted = m.shows.filter((s) => s.blurb).length;
  const url = `/magazine/${encodeURIComponent(slug)}`;

  return (
    <div className="space-y-6" data-testid="magazine-admin">
      <div className="flex flex-wrap items-start justify-between gap-4 rounded-2xl border border-border bg-card p-5 shadow-sm">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-xl font-bold tracking-tight"><BookOpen className="h-5 w-5 text-[#053877]" /> Keepsake magazine</h2>
          <p className="mt-1 text-sm text-muted-foreground">A cover, Riccoh's welcome, the lineup, a page for every show and the sponsors. US Letter for print; the same pages online.</p>
          <p className="mt-2 text-sm"><span className="font-semibold">{drafted} of {m.shows.length}</span> pages written</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={() => void draft(false)} disabled={drafting} className="gap-1.5 rounded-full bg-[#053877] text-white hover:bg-[#0a4a99]" data-testid="magazine-draft">
            {drafting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />} {drafting ? "Writing…" : drafted ? "Draft the rest with SI" : "Draft every page with SI"}
          </Button>
          <Button variant="outline" onClick={() => void fromTheDay()} disabled={filling} className="gap-1.5 rounded-full" data-testid="magazine-from-the-day">
            {filling ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />} {filling ? "Reading the day…" : "Fill from the day"}
          </Button>
          <Button asChild variant="outline" className="gap-1.5 rounded-full"><a href={url} target="_blank" rel="noreferrer"><ExternalLink className="h-4 w-4" /> Open</a></Button>
          <Button asChild variant="outline" className="gap-1.5 rounded-full"><a href={`${url}?print=1`} target="_blank" rel="noreferrer"><Printer className="h-4 w-4" /> Print / PDF</a></Button>
          <DistributeButton eventId={eventId} distributed={m.distributed ?? null} onDone={refresh} />
          <label className="flex items-center gap-2 rounded-full border border-border px-3 py-1.5 text-sm font-medium">
            <Switch checked={m.published} onCheckedChange={(v) => void publish(v)} data-testid="magazine-publish" />
            {m.published ? <span className="font-semibold text-[#15834f]">Published</span> : <span className="text-muted-foreground">Admins only</span>}
          </label>
        </div>
      </div>

      <SegmentsPanel eventId={eventId} seg={m.segments} total={m.shows.length} onChanged={refresh} />
      <CoverPanel eventId={eventId} photo={m.cover?.photo ?? ""} style={m.cover?.style || (m.cover?.photo ? "photo" : "glass")} slug={slug} faces={m.shows.map((x) => ({ id: x.signupId, src: x.headshot || x.art, who: x.hostName.trim().toLowerCase() })).filter((f, i, all) => f.src && all.findIndex((y) => y.src === f.src || y.who === f.who) === i)} onChanged={refresh} />
      <AdsPanel eventId={eventId} ads={m.ads ?? []} onChanged={refresh} />
      <AwardPanel eventId={eventId} award={m.award ?? null} shows={m.shows} onChanged={refresh} />
      <PressPanel />
      <StatsPanel eventId={eventId} />

      <section className="rounded-2xl border border-border bg-card p-5">
        <h3 className="font-semibold">Riccoh's welcome</h3>
        <Textarea defaultValue={m.welcome} key={`w-${m.welcome.length}`} rows={7} className="mt-2" placeholder="SI writes it with the rest, in Riccoh's voice." onBlur={(e) => { if (e.target.value !== m.welcome) void save(0, { blurb: e.target.value }); }} data-testid="magazine-welcome" />
      </section>

      <ul className="space-y-3">
        {m.shows.map((s) => (
          <li key={s.signupId} className="flex gap-4 rounded-2xl border border-border bg-card p-4" data-testid={`magazine-page-${s.signupId}`}>
            <div className="relative h-24 w-20 shrink-0 overflow-hidden rounded-lg bg-muted">
              {s.headshot && <img src={s.headshot} alt="" className="h-full w-full object-cover" />}
            </div>
            <div className="min-w-0 flex-1 space-y-2">
              <p className="text-sm"><span className="font-semibold">{s.number}. {s.podcastName}</span> <span className="text-muted-foreground">· {s.hostName} · {s.time}</span>{saving === s.signupId && <Loader2 className="ml-2 inline h-3.5 w-3.5 animate-spin" />}</p>
              <Textarea defaultValue={s.blurb} key={`b-${s.signupId}-${s.blurb.length}`} rows={3} placeholder="Their paragraph: SI drafts it, you edit it." onBlur={(e) => { if (e.target.value !== s.blurb) void save(s.signupId, { blurb: e.target.value }); }} />
              <div className="flex flex-wrap gap-2 pt-0.5">
                <label className={`inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-full border border-input bg-background px-3 text-sm font-medium hover:bg-muted ${saving === s.signupId ? "pointer-events-none opacity-50" : ""}`} data-testid={`magazine-photo-${s.signupId}`}>
                  <Camera className="h-3.5 w-3.5" /> Change photo
                  <input type="file" accept="image/*" className="sr-only" aria-label={`Change ${s.hostName}'s photo`} data-testid={`magazine-photo-input-${s.signupId}`} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void changePhoto(s, f); }} />
                </label>
                <Button type="button" variant="outline" size="sm" className="h-8 gap-1.5 rounded-full" disabled={saving === s.signupId || asked.has(s.signupId)} onClick={() => void askPhoto(s)} data-testid={`magazine-ask-photo-${s.signupId}`}>{asked.has(s.signupId) ? <><Check className="h-3.5 w-3.5" /> Asked</> : <><Mail className="h-3.5 w-3.5" /> Ask for a photo</>}</Button>
                <Button type="button" variant="ghost" size="sm" className="h-8 gap-1.5 rounded-full text-muted-foreground" disabled={saving === s.signupId} onClick={() => void leaveOut(s.signupId, true, s.podcastName)} data-testid={`magazine-leave-out-${s.signupId}`}><EyeOff className="h-3.5 w-3.5" /> Leave out</Button>
              </div>
              <Textarea defaultValue={s.aboutOwn || s.about || ""} key={`ab-${s.signupId}-${(s.aboutOwn || s.about || "").length}`} rows={2} placeholder="About them, in their words: their service, what they're known for. Empty uses their SmartLink bio." onBlur={(e) => { if (e.target.value.trim() !== (s.aboutOwn || s.about || "").trim()) void save(s.signupId, { about: e.target.value }); }} data-testid={`magazine-about-${s.signupId}`} />
              <Textarea defaultValue={(s.links ?? []).map((l) => `${l.title} | ${l.url}`).join("\n")} key={`l-${s.signupId}-${(s.links ?? []).length}`} rows={2} placeholder={"Watch and listen links, one a line: Title | https://… (up to 4). They replace the episodes from their feed."} className="text-sm" onBlur={(e) => { const now = (s.links ?? []).map((l) => `${l.title} | ${l.url}`).join("\n"); if (e.target.value.trim() !== now.trim()) void save(s.signupId, { links: e.target.value }); }} data-testid={`magazine-links-${s.signupId}`} />
              <input defaultValue={s.audio ?? ""} key={`a-${s.signupId}-${s.audio ?? ""}`} placeholder="Their segment from the day: a link to the audio (after Oct 5). Until then the page plays their latest episode." className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm" onBlur={(e) => { if (e.target.value.trim() !== (s.audio ?? "")) void save(s.signupId, { audio: e.target.value.trim() }); }} data-testid={`magazine-audio-${s.signupId}`} />
              <Textarea defaultValue={s.onTheDay ?? ""} key={`d-${s.signupId}-${(s.onTheDay ?? "").length}`} rows={2} placeholder="On the day: what they talked about live (Fill from the day writes this from their segment)." onBlur={(e) => { if (e.target.value.trim() !== (s.onTheDay ?? "").trim()) void save(s.signupId, { onTheDay: e.target.value }); }} data-testid={`magazine-onday-${s.signupId}`} />
              <input defaultValue={s.quote} key={`q-${s.signupId}-${s.quote.length}`} placeholder="Pull quote: their own words only, from an episode (optional)" className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm" onBlur={(e) => { if (e.target.value !== s.quote) void save(s.signupId, { quote: e.target.value }); }} />
            </div>
            {s.blurb && <Check className="mt-1 h-4 w-4 shrink-0 text-emerald-600" aria-label="Written" />}
          </li>
        ))}
      </ul>

      {!!m.leftOut?.length && (
        <section className="rounded-2xl border border-dashed border-border p-4">
          <h3 className="text-sm font-semibold">Left out of the magazine</h3>
          <ul className="mt-2 space-y-1.5">
            {m.leftOut.map((s) => (
              <li key={s.signupId} className="flex items-center justify-between gap-3 text-sm">
                <span className="min-w-0 truncate">{s.podcastName} <span className="text-muted-foreground">· {s.hostName}</span></span>
                <Button type="button" variant="outline" size="sm" className="h-8 shrink-0 gap-1.5 rounded-full" disabled={saving === s.signupId} onClick={() => void leaveOut(s.signupId, false, s.podcastName)}><Undo2 className="h-3.5 w-3.5" /> Put back</Button>
              </li>
            ))}
          </ul>
        </section>
      )}

    </div>
  );
}

/** The cover: a photo of our choosing, or (none set) every podcaster's face. */
const COVER_STYLES = [
  { v: "letters", label: "VOICES", hint: "A giant word cut from everyone's photos" },
  { v: "glass", label: "Glass mosaic", hint: "Every face as a gloss tile, the wall tilted" },
  { v: "medallion", label: "Medallion", hint: "The day's badge, ringed by every face" },
  { v: "prints", label: "Glossy prints", hint: "Photo prints scattered on the page" },
  { v: "photo", label: "One photo", hint: "A single photo, full page" },
] as const;

function CoverPanel({ eventId, photo, style, slug, faces, onChanged }: { eventId: number; photo: string; style: string; slug: string; faces: Face[]; onChanged: () => unknown }) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const put = async (f: File) => {
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("photo", f, f.name);
      const r = (await (await adminUpload(`/api/admin/magazine/${eventId}/cover`, fd)).json()) as { width: number; height: number };
      await onChanged();
      const small = r.height > 0 && r.height < 2400;
      toast({ title: "The cover photo is in", description: small ? `It's ${r.width} × ${r.height}: fine online, soft on the printed cover (2550 × 3300 is ideal).` : "Open the magazine to see it." });
    } catch (e) { toast({ title: "Couldn't use that photo", description: (e as Error).message, variant: "destructive" }); }
    finally { setBusy(false); }
  };
  const clear = async () => { setBusy(true); try { await adminSend("DELETE", `/api/admin/magazine/${eventId}/cover`); await onChanged(); } finally { setBusy(false); } };
  const pick = async (v: string) => { setBusy(true); try { await adminSend("PUT", `/api/admin/magazine/${eventId}/cover-style`, { style: v }); await onChanged(); } finally { setBusy(false); } };
  return (
    <section className="flex flex-wrap items-center gap-4 rounded-2xl border border-border bg-card p-5" data-testid="magazine-cover">
      {/* The cover as it is: the chosen style drawn small (the page is 816 × 1056). */}
      <div className="relative h-[112px] w-[86px] shrink-0 overflow-hidden rounded-md bg-[#000741] shadow-sm" data-testid="magazine-cover-thumb">
        {style === "photo" ? (photo && <img src={photo} alt="" className="h-full w-full object-cover" />) : (
          <div className="absolute left-0 top-0 origin-top-left" style={{ width: 816, height: 1056, transform: `scale(${86 / 816})` }}>
            <CoverCollage faces={faces} style={style as CoverStyle} />
          </div>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <h3 className="font-semibold">Cover</h3>
        <p className="mt-0.5 text-sm text-muted-foreground">Every podcaster's face, four ways, or one photo for the whole cover.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {COVER_STYLES.filter((c) => c.v !== "photo" || photo).map((c) => (
            <button key={c.v} type="button" disabled={busy} title={c.hint} onClick={() => void pick(c.v)} className={`rounded-full border px-3 py-1.5 text-sm font-medium ${style === c.v ? "border-[#053877] bg-[#053877] text-white" : "border-input hover:bg-muted"}`} data-testid={`magazine-cover-${c.v}`}>{c.label}</button>
          ))}
          <a href={`/magazine/${encodeURIComponent(slug)}`} target="_blank" rel="noreferrer" className="px-2 py-1.5 text-sm font-medium text-[#053877] hover:underline">See it</a>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <label className={`inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-full border border-input bg-background px-4 text-sm font-medium hover:bg-muted ${busy ? "pointer-events-none opacity-50" : ""}`}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImageIcon className="h-4 w-4" />} {photo ? "Change cover photo" : "Use a cover photo"}
          <input type="file" accept="image/*" className="sr-only" aria-label="Cover photo" data-testid="magazine-cover-input" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void put(f); }} />
        </label>
        {photo && <Button type="button" variant="ghost" size="sm" className="rounded-full text-muted-foreground" disabled={busy} onClick={() => void clear()}>Back to the faces</Button>}
      </div>
    </section>
  );
}

/** Full-page ads: a sponsor's (their logo, a counted link) or anyone's. Their artwork, or a page we set. */
function AdsPanel({ eventId, ads, onChanged }: { eventId: number; ads: Ad[]; onChanged: () => unknown }) {
  const { toast } = useToast();
  const sponsors = useQuery<{ id: number; name: string; logoUrl: string; url: string }[]>({ queryKey: ["/api/sponsors"], queryFn: async () => (await fetch("/api/sponsors")).json() });
  const [pick, setPick] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState<number | "new" | null>(null);
  const run = async (key: number | "new", fn: () => Promise<unknown>, done?: string) => {
    setBusy(key);
    try { await fn(); await onChanged(); if (done) toast({ title: done }); }
    catch (e) { toast({ title: "Couldn't do that", description: (e as Error).message, variant: "destructive" }); }
    finally { setBusy(null); }
  };
  const add = () => run("new", async () => {
    const fd = new FormData();
    if (pick && pick !== "other") fd.append("sponsorId", pick);
    else fd.append("name", name.trim());
    await adminUpload(`/api/admin/magazine/${eventId}/ads`, fd);
    setPick(""); setName("");
  }, "Ad page added");
  const patch = (id: number, body: Record<string, string>) => run(id, () => adminSend("PUT", `/api/admin/magazine/ads/${id}`, body));
  const artwork = (id: number, f: File) => run(id, async () => {
    const fd = new FormData();
    fd.append("artwork", f, f.name);
    const r = (await (await adminUpload(`/api/admin/magazine/ads/${id}/artwork`, fd)).json()) as { width: number; height: number };
    if (r.height && r.height < 2400) toast({ title: "Their ad is in", description: `It's ${r.width} × ${r.height}: soft in print. Ask them for 2550 × 3300 (8.5 × 11 in at 300 dpi).` });
  });
  return (
    <section className="rounded-2xl border border-border bg-card p-5" data-testid="magazine-ads">
      <h3 className="flex items-center gap-2 font-semibold"><Megaphone className="h-4 w-4 text-[#053877]" /> Ad pages</h3>
      <p className="mt-0.5 text-sm text-muted-foreground">A full page each. The first faces Riccoh's welcome; the rest are spread through the show pages. Put in their finished ad (8.5 × 11 in), or we set one from their logo, a headline, a line or two and a QR to their site.</p>
      <ul className="mt-4 space-y-3">
        {ads.map((a) => (
          <li key={a.id} className="flex gap-4 rounded-xl border border-border p-3" data-testid={`magazine-ad-${a.id}`}>
            <div className="flex h-28 w-[86px] shrink-0 items-center justify-center overflow-hidden rounded-md bg-[#000741] p-1.5">
              {a.artwork ? <img src={a.artwork} alt="" className="h-full w-full object-cover" /> : a.logo ? <img src={a.logo} alt="" className="max-h-full max-w-full object-contain" /> : <span className="text-center text-[10px] font-bold text-white">{a.name}</span>}
            </div>
            <div className="min-w-0 flex-1 space-y-2">
              <p className="text-sm font-semibold">{a.name}{busy === a.id && <Loader2 className="ml-2 inline h-3.5 w-3.5 animate-spin" />}</p>
              {a.artwork ? (
                <p className="text-sm text-muted-foreground">Their own ad, printed edge to edge.</p>
              ) : (
                <>
                  <input defaultValue={a.headline} key={`h-${a.id}-${a.headline}`} placeholder="Headline" className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm font-semibold" onBlur={(e) => { if (e.target.value !== a.headline) void patch(a.id, { headline: e.target.value }); }} />
                  <Textarea defaultValue={a.body} key={`b-${a.id}-${a.body.length}`} rows={2} placeholder="A line or two" onBlur={(e) => { if (e.target.value !== a.body) void patch(a.id, { body: e.target.value }); }} />
                  <input defaultValue={a.site} key={`u-${a.id}-${a.site}`} placeholder="Their website (the QR goes here)" className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm" onBlur={(e) => { if (e.target.value !== a.site) void patch(a.id, { url: e.target.value }); }} />
                </>
              )}
              <div className="flex flex-wrap gap-2">
                <label className={`inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-full border border-input bg-background px-3 text-sm font-medium hover:bg-muted ${busy === a.id ? "pointer-events-none opacity-50" : ""}`}>
                  <ImageIcon className="h-3.5 w-3.5" /> {a.artwork ? "Replace their ad" : "Use their own ad"}
                  <input type="file" accept="image/*" className="sr-only" aria-label={`${a.name} ad artwork`} data-testid={`magazine-ad-art-${a.id}`} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void artwork(a.id, f); }} />
                </label>
                {a.artwork && <Button type="button" variant="ghost" size="sm" className="h-8 rounded-full text-muted-foreground" onClick={() => void patch(a.id, { artwork: "" })}>Set it from their logo instead</Button>}
                {!a.artwork && !a.sponsorId && (
                  <label className={`inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-full border border-input bg-background px-3 text-sm font-medium hover:bg-muted ${busy === a.id ? "pointer-events-none opacity-50" : ""}`}>
                    <ImageIcon className="h-3.5 w-3.5" /> {a.logo ? "Change logo" : "Add their logo"}
                    <input type="file" accept="image/*" className="sr-only" aria-label={`${a.name} logo`} data-testid={`magazine-ad-logo-${a.id}`} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void run(a.id, () => { const fd = new FormData(); fd.append("logo", f, f.name); return adminUpload(`/api/admin/magazine/ads/${a.id}/logo`, fd); }); }} />
                  </label>
                )}
                <Button type="button" variant="ghost" size="sm" className="h-8 gap-1.5 rounded-full text-muted-foreground" onClick={() => void run(a.id, () => adminSend("DELETE", `/api/admin/magazine/ads/${a.id}`), `${a.name} is out of the magazine`)}><Trash2 className="h-3.5 w-3.5" /> Remove</Button>
              </div>
            </div>
          </li>
        ))}
      </ul>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <select value={pick} onChange={(e) => setPick(e.target.value)} className="h-9 rounded-md border border-input bg-background px-3 text-sm" aria-label="Advertiser" data-testid="magazine-ad-pick">
          <option value="">Add an ad page for…</option>
          {(sponsors.data ?? []).map((sp) => <option key={sp.id} value={String(sp.id)}>{sp.name}</option>)}
          <option value="other">Someone else</option>
        </select>
        {pick === "other" && <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Advertiser's name" className="h-9 rounded-md border border-input bg-background px-3 text-sm" data-testid="magazine-ad-name" />}
        <Button type="button" size="sm" className="h-9 gap-1.5 rounded-full bg-[#053877] text-white hover:bg-[#0a4a99]" disabled={!pick || (pick === "other" && !name.trim()) || busy === "new"} onClick={() => void add()} data-testid="magazine-ad-add">
          {busy === "new" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Add
        </Button>
      </div>
    </section>
  );
}

/** Each show's segment from the day, cut from the broadcast recording, for the players in the digital magazine. */
function SegmentsPanel({ eventId, seg, total, onChanged }: { eventId: number; seg?: { done: number; working: number; failed: number }; total: number; onChanged: () => unknown }) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const cut = async () => {
    setBusy(true);
    try {
      const r = (await (await adminSend("POST", `/api/admin/magazine/${eventId}/segments`)).json()) as { queued: number; kept: number; notRecorded: string[] };
      await onChanged();
      toast({ title: r.queued ? `Cutting ${r.queued} segment${r.queued === 1 ? "" : "s"}` : "Nothing new to cut", description: r.notRecorded.length ? `No recording covers: ${r.notRecorded.join(", ")}` : "Each one is a few minutes on the worker." });
    } catch (e) { toast({ title: "Couldn't start", description: (e as Error).message, variant: "destructive" }); }
    finally { setBusy(false); }
  };
  const s = seg ?? { done: 0, working: 0, failed: 0 };
  return (
    <section className="flex flex-wrap items-center gap-4 rounded-2xl border border-border bg-card p-5" data-testid="magazine-segments">
      <div className="min-w-0 flex-1">
        <h3 className="font-semibold">Their segments from the day</h3>
        <p className="mt-0.5 text-sm text-muted-foreground">
          {s.done || s.working || s.failed
            ? `${s.done} of ${total} cut${s.working ? `, ${s.working} cutting` : ""}${s.failed ? `, ${s.failed} couldn't be cut` : ""}. Each page plays its show's segment once it's cut.`
            : "When the day's recording finishes, every show's minutes are cut from it on their own, and each page plays its segment instead of their latest episode."}
        </p>
      </div>
      <Button type="button" variant="outline" className="gap-1.5 rounded-full" disabled={busy} onClick={() => void cut()} data-testid="magazine-cut-segments">
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />} Cut them now
      </Button>
    </section>
  );
}

/** Publish and email every podcaster their page, from Riccoh. A test to yourself first; never twice by accident. */
function DistributeButton({ eventId, distributed, onDone }: { eventId: number; distributed: { at: string; sent: number } | null; onDone: () => unknown }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<"" | "test" | "send">("");
  const go = async (test: boolean) => {
    setBusy(test ? "test" : "send");
    try {
      const r = (await (await adminSend("POST", `/api/admin/magazine/${eventId}/distribute`, test ? { test: true } : distributed ? { again: true } : {})).json()) as { to?: string; recipients?: number; sent?: number; failed?: string[] };
      if (test) toast({ title: "Test sent", description: `To ${r.to}. The real one goes to ${r.recipients} podcasters.` });
      else {
        setOpen(false);
        await onDone();
        toast({ title: `Sent to ${r.sent} podcasters`, description: r.failed?.length ? `Didn't go to: ${r.failed.join(", ")}` : "The magazine is published, and each of them has a link to their own page." });
      }
    } catch (e) {
      toast({ title: "Couldn't send", description: (e as Error).message, variant: "destructive" });
    } finally {
      setBusy("");
    }
  };
  return (
    <>
      <Button onClick={() => setOpen(true)} className="gap-1.5 rounded-full bg-[#F0A71F] font-semibold text-[#1a1200] hover:bg-[#f5b944]" data-testid="magazine-distribute">
        <Mail className="h-4 w-4" /> {distributed ? `Sent to ${distributed.sent}` : "Distribute"}
      </Button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => !busy && setOpen(false)}>
          <div className="w-full max-w-md rounded-2xl bg-card p-6 shadow-2xl" onClick={(e) => e.stopPropagation()} data-testid="magazine-distribute-dialog">
            <h3 className="text-lg font-bold">{distributed ? "Send the magazine again?" : "Send the magazine to every podcaster?"}</h3>
            <p className="mt-2 text-sm text-muted-foreground">
              {distributed
                ? `It went to ${distributed.sent} podcasters on ${new Date(distributed.at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}. Sending again emails all of them a second time.`
                : "This publishes the magazine and emails each podcaster (and co-host) from Riccoh, with a link straight to their own page."}
            </p>
            <div className="mt-5 flex flex-wrap justify-end gap-2">
              <Button variant="outline" className="rounded-full" disabled={!!busy} onClick={() => void go(true)} data-testid="magazine-distribute-test">{busy === "test" ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Send me a test first</Button>
              <Button className="gap-1.5 rounded-full bg-[#053877] text-white hover:bg-[#0a4a99]" disabled={!!busy} onClick={() => void go(false)} data-testid="magazine-distribute-send">{busy === "send" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />} {distributed ? "Send again" : "Publish and send"}</Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/** The award page: who won, the award, their photo, and the citation (SI drafts it from their segment; edit freely). */
function AwardPanel({ eventId, award, shows, onChanged }: { eventId: number; award: Award | null; shows: Show[]; onChanged: () => void }) {
  const { toast } = useToast();
  const [signupId, setSignupId] = useState<number>(award?.signupId || shows.find((x) => /oswalt/i.test(x.hostName))?.signupId || 0);
  const [title, setTitle] = useState(award?.title || "Excellence in Storytelling");
  const [photo, setPhoto] = useState(award?.photo || "");
  const [citation, setCitation] = useState(award?.citation || "");
  const [quote, setQuote] = useState(award?.quote || "");
  const [busy, setBusy] = useState(false);
  const post = async (draft: boolean) => {
    setBusy(true);
    try {
      const r = (await (await adminSend("POST", `/api/admin/magazine/${eventId}/award`, { signupId, title, photo, ...(draft ? {} : { citation, quote }) })).json()) as { citation: string; quote: string };
      setCitation(r.citation); setQuote(r.quote);
      toast({ title: draft ? "Citation drafted" : "Award page saved", description: draft ? "Read it and change anything, then Save." : undefined });
      onChanged();
    } catch (e) {
      toast({ title: "Couldn't save the award page", description: (e as Error).message, variant: "destructive" });
    }
    setBusy(false);
  };
  return (
    <section className="rounded-2xl border border-border bg-card p-5" data-testid="magazine-award">
      <h3 className="text-base font-semibold">Award page</h3>
      <p className="mt-1 text-sm text-muted-foreground">A page of its own, after the faces: their photo, the plaque, and why they won.</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <select value={signupId} onChange={(e) => setSignupId(Number(e.target.value))} className="h-9 rounded-md border border-input bg-background px-2 text-sm" data-testid="award-who">
          <option value={0}>Who won?</option>
          {shows.map((x) => <option key={x.signupId} value={x.signupId}>{x.hostName} · {x.podcastName}</option>)}
        </select>
        <input value={title} onChange={(e) => setTitle(e.target.value)} className="h-9 rounded-md border border-input bg-background px-3 text-sm" placeholder="Excellence in Storytelling" />
        <input value={photo} onChange={(e) => setPhoto(e.target.value)} className="h-9 rounded-md border border-input bg-background px-3 text-sm sm:col-span-2" placeholder="Photo link (empty uses their magazine photo)" data-testid="award-photo" />
        <Textarea value={citation} onChange={(e) => setCitation(e.target.value)} rows={4} className="sm:col-span-2" placeholder="Why they won. Press Draft to have SI write it from their segment." data-testid="award-citation" />
        <input value={quote} onChange={(e) => setQuote(e.target.value)} className="h-9 rounded-md border border-input bg-background px-3 text-sm sm:col-span-2" placeholder="Their words (optional)" />
      </div>
      <div className="mt-3 flex gap-2">
        <Button variant="outline" size="sm" className="gap-1.5 rounded-full" disabled={busy || !signupId} onClick={() => void post(true)} data-testid="award-draft"><Sparkles className="h-3.5 w-3.5" /> Draft with SI</Button>
        <Button size="sm" className="rounded-full" disabled={busy || !signupId || !citation.trim()} onClick={() => void post(false)} data-testid="award-save">Save</Button>
      </div>
    </section>
  );
}

/** The PodcastOne release page (8 Oct): paste LiveOne's text as they sent it; empty shows our summary. */
function PressPanel() {
  const { toast } = useToast();
  const q = useQuery<{ body: string }>({ queryKey: ["/api/press/podcast-one"], queryFn: async () => (await fetch("/api/press/podcast-one")).json() });
  const save = async (body: string) => {
    try {
      await adminSend("PUT", "/api/admin/press/podcast-one", { body });
      await q.refetch();
      toast({ title: body.trim() ? "The release is on the page" : "Back to our summary" });
    } catch (e) {
      toast({ title: "Couldn't save", description: (e as Error).message, variant: "destructive" });
    }
  };
  return (
    <section className="rounded-2xl border border-border bg-card p-5" data-testid="magazine-press">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold">PodcastOne press release page</h3>
        <Button asChild variant="outline" size="sm" className="gap-1.5 rounded-full"><a href="/podcast-one-press-release" target="_blank" rel="noreferrer"><ExternalLink className="h-4 w-4" /> Open</a></Button>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">The news page's QR code lands here. Paste the release text LiveOne sent, a blank line between paragraphs. Empty shows our summary and a link to the newswire.</p>
      {q.data && <Textarea defaultValue={q.data.body} rows={6} className="mt-2 text-sm" placeholder="Paste the release here" onBlur={(e) => { if (e.target.value.trim() !== q.data!.body.trim()) void save(e.target.value); }} data-testid="press-body" />}
    </section>
  );
}

/** The magazine's numbers (9 Oct): plays, picture and link clicks, and QR scans, page by page. */
type StatItem = { k: string; l: string };
type Stats = { manifest: { at: string; pages: { p: string; n: number; label: string; items: StatItem[] }[] } | null; counts: { p: string; k: string; l: string; n: number }[] };
const KIND_LABEL: Record<string, string> = { play: "Played", image: "Picture clicked", link: "Link clicked", qr: "QR scanned" };
function StatsPanel({ eventId }: { eventId: number }) {
  const q = useQuery<Stats>({ queryKey: ["/api/admin/magazine/stats", eventId], queryFn: async () => (await fetch(`/api/admin/magazine/${eventId}/stats`, { credentials: "include" })).json(), refetchInterval: 60_000 });
  const d = q.data;
  const count = (p: string, k: string, l: string) => d?.counts.find((c) => c.p === p && c.k === k && c.l === l)?.n ?? 0;
  const totals = (["play", "image", "link", "qr"] as const).map((k) => [k, (d?.counts ?? []).filter((c) => c.k === k).reduce((a, c) => a + c.n, 0)] as const);
  const pages = [...(d?.manifest?.pages ?? [])].sort((a, b) => a.n - b.n).map((pg) => {
    // Anything counted on the page that the list doesn't have yet (a renamed episode, say) still shows.
    const extra = (d?.counts ?? []).filter((c) => c.p === pg.p && !pg.items.some((i) => i.k === c.k && i.l === c.l)).map((c) => ({ k: c.k, l: c.l }));
    return { ...pg, items: [...pg.items, ...extra] };
  });
  return (
    <section className="rounded-2xl border border-border bg-card p-5" data-testid="magazine-stats">
      <h3 className="font-semibold">Plays, clicks and scans</h3>
      <p className="mt-1 text-sm text-muted-foreground">Every picture in the magazine is a link, and every QR code is counted on its way through. Counting started 9 Oct.</p>
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {totals.map(([k, n]) => (
          <div key={k} className="rounded-xl bg-muted/50 p-3 text-center">
            <p className="text-2xl font-bold tabular-nums">{n}</p>
            <p className="text-xs font-semibold text-muted-foreground">{({ play: "Plays", image: "Picture clicks", link: "Link clicks", qr: "QR scans" } as Record<string, string>)[k]}</p>
          </div>
        ))}
      </div>
      {!d?.manifest ? (
        <p className="mt-4 text-sm text-muted-foreground">Open the magazine once and every page will be listed here.</p>
      ) : (
        <div className="mt-5 divide-y divide-border rounded-xl border border-border">
          {pages.map((pg) => {
            const total = pg.items.reduce((a, i) => a + count(pg.p, i.k, i.l), 0);
            return (
              <details key={pg.p} className="group px-4 py-2.5" open={total > 0}>
                <summary className="flex cursor-pointer list-none items-center gap-3 text-sm">
                  <span className="w-8 shrink-0 tabular-nums text-muted-foreground">{pg.n}</span>
                  <span className="min-w-0 flex-1 truncate font-semibold">{pg.label}</span>
                  <span className={`tabular-nums font-semibold ${total ? "text-[#053877]" : "text-muted-foreground"}`}>{total}</span>
                </summary>
                {pg.items.length > 0 && (
                  <ul className="mt-2 space-y-1 pb-1 pl-11">
                    {pg.items.map((i) => (
                      <li key={`${i.k}|${i.l}`} className="flex items-center gap-3 text-sm">
                        <span className="w-28 shrink-0 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{KIND_LABEL[i.k] ?? i.k}</span>
                        <span className="min-w-0 flex-1 truncate">{i.l}</span>
                        <span className="tabular-nums">{count(pg.p, i.k, i.l)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </details>
            );
          })}
        </div>
      )}
    </section>
  );
}
