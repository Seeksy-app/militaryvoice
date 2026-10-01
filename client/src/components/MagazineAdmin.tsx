import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BookOpen, Camera, Check, EyeOff, ExternalLink, ImageIcon, Loader2, Mail, Megaphone, Plus, Printer, Sparkles, Trash2, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { adminSend, adminUpload } from "@/lib/adminApi";
import { fitForUpload } from "@/lib/cropImage";

type Show = { signupId: number; number: number; time: string; podcastName: string; hostName: string; headshot: string; printQuality: boolean; art: string; blurb: string; quote: string; link: string; audio?: string };
type Ad = { id: number; sponsorId: number; name: string; headline: string; body: string; site: string; logo: string; artwork: string };
type Mag = { event: { name: string }; published: boolean; welcome: string; shows: Show[]; leftOut?: { signupId: number; podcastName: string; hostName: string }[]; cover?: { photo: string }; ads?: Ad[] };

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
  const save = async (signupId: number, patch: { blurb?: string; quote?: string; audio?: string }) => {
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
          <Button asChild variant="outline" className="gap-1.5 rounded-full"><a href={url} target="_blank" rel="noreferrer"><ExternalLink className="h-4 w-4" /> Open</a></Button>
          <Button asChild variant="outline" className="gap-1.5 rounded-full"><a href={`${url}?print=1`} target="_blank" rel="noreferrer"><Printer className="h-4 w-4" /> Print / PDF</a></Button>
          <label className="flex items-center gap-2 rounded-full border border-border px-3 py-1.5 text-sm font-medium">
            <Switch checked={m.published} onCheckedChange={(v) => void publish(v)} data-testid="magazine-publish" />
            {m.published ? <span className="font-semibold text-[#15834f]">Published</span> : <span className="text-muted-foreground">Admins only</span>}
          </label>
        </div>
      </div>

      <CoverPanel eventId={eventId} photo={m.cover?.photo ?? ""} onChanged={refresh} />
      <AdsPanel eventId={eventId} ads={m.ads ?? []} onChanged={refresh} />

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
              <input defaultValue={s.audio ?? ""} key={`a-${s.signupId}-${s.audio ?? ""}`} placeholder="Their segment from the day: a link to the audio (after Oct 5). Until then the page plays their latest episode." className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm" onBlur={(e) => { if (e.target.value.trim() !== (s.audio ?? "")) void save(s.signupId, { audio: e.target.value.trim() }); }} data-testid={`magazine-audio-${s.signupId}`} />
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
function CoverPanel({ eventId, photo, onChanged }: { eventId: number; photo: string; onChanged: () => unknown }) {
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
  return (
    <section className="flex flex-wrap items-center gap-4 rounded-2xl border border-border bg-card p-5" data-testid="magazine-cover">
      <div className="h-28 w-[86px] shrink-0 overflow-hidden rounded-md bg-[#000741]">{photo && <img src={photo} alt="" className="h-full w-full object-cover" />}</div>
      <div className="min-w-0 flex-1">
        <h3 className="font-semibold">Cover</h3>
        <p className="mt-0.5 text-sm text-muted-foreground">{photo ? "Your photo, full page, with the title over the bottom." : "Every podcaster's photo (their show art until a photo comes in). Or put in one photo for the whole cover."}</p>
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
