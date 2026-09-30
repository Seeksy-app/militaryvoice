import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BookOpen, Check, ExternalLink, Loader2, Printer, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { adminSend } from "@/lib/adminApi";

type Show = { signupId: number; number: number; time: string; podcastName: string; hostName: string; headshot: string; printQuality: boolean; art: string; blurb: string; quote: string; link: string };
type Mag = { event: { name: string }; published: boolean; welcome: string; shows: Show[] };

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
  const save = async (signupId: number, patch: { blurb?: string; quote?: string }) => {
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
  const print = m.shows.filter((s) => s.printQuality).length;
  const url = `/magazine/${encodeURIComponent(slug)}`;

  return (
    <div className="space-y-6" data-testid="magazine-admin">
      <div className="flex flex-wrap items-start justify-between gap-4 rounded-2xl border border-border bg-card p-5 shadow-sm">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-xl font-bold tracking-tight"><BookOpen className="h-5 w-5 text-[#053877]" /> Keepsake magazine</h2>
          <p className="mt-1 text-sm text-muted-foreground">A cover, Riccoh's welcome, the lineup, a page for every show and the sponsors. US Letter for print; the same pages online.</p>
          <p className="mt-2 text-sm"><span className="font-semibold">{drafted} of {m.shows.length}</span> pages written · <span className={print < m.shows.length ? "font-semibold text-[#8a5a00]" : "font-semibold"}>{print} of {m.shows.length}</span> print-quality headshots</p>
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

      <section className="rounded-2xl border border-border bg-card p-5">
        <h3 className="font-semibold">Riccoh's welcome</h3>
        <Textarea defaultValue={m.welcome} key={`w-${m.welcome.length}`} rows={7} className="mt-2" placeholder="SI writes it with the rest, in Riccoh's voice." onBlur={(e) => { if (e.target.value !== m.welcome) void save(0, { blurb: e.target.value }); }} data-testid="magazine-welcome" />
      </section>

      <ul className="space-y-3">
        {m.shows.map((s) => (
          <li key={s.signupId} className="flex gap-4 rounded-2xl border border-border bg-card p-4" data-testid={`magazine-page-${s.signupId}`}>
            <div className="relative h-24 w-20 shrink-0 overflow-hidden rounded-lg bg-muted">
              {s.headshot && <img src={s.headshot} alt="" className="h-full w-full object-cover" />}
              <span className={`absolute inset-x-0 bottom-0 py-0.5 text-center text-[10px] font-bold ${s.printQuality ? "bg-emerald-600 text-white" : "bg-[#F0A71F] text-[#1a1200]"}`}>{s.printQuality ? "Print" : "Web only"}</span>
            </div>
            <div className="min-w-0 flex-1 space-y-2">
              <p className="text-sm"><span className="font-semibold">{s.number}. {s.podcastName}</span> <span className="text-muted-foreground">· {s.hostName} · {s.time}</span>{saving === s.signupId && <Loader2 className="ml-2 inline h-3.5 w-3.5 animate-spin" />}</p>
              <Textarea defaultValue={s.blurb} key={`b-${s.signupId}-${s.blurb.length}`} rows={3} placeholder="Their paragraph: SI drafts it, you edit it." onBlur={(e) => { if (e.target.value !== s.blurb) void save(s.signupId, { blurb: e.target.value }); }} />
              <input defaultValue={s.quote} key={`q-${s.signupId}-${s.quote.length}`} placeholder="Pull quote: their own words only, from an episode (optional)" className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm" onBlur={(e) => { if (e.target.value !== s.quote) void save(s.signupId, { quote: e.target.value }); }} />
            </div>
            {s.blurb && <Check className="mt-1 h-4 w-4 shrink-0 text-emerald-600" aria-label="Written" />}
          </li>
        ))}
      </ul>
    </div>
  );
}
