import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Search } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { Textarea } from "@/components/ui/textarea";
import type { Brief, BriefView } from "@shared/guestBrief";

/**
 * The guest brief (Andrew, 26 Nov: "Yes, build it", as mocked in exports/guest-brief): one dashed line on the invite form,
 * "Look them up", then a compact card only the host sees. Everything in it comes from public pages, with sources.
 */
const say = (e: unknown) => ((e as Error).message ?? "").replace(/^\d+:\s*/, "").replace(/^\{.*"message":"([^"]+)".*\}$/, "$1") || "Try again in a moment.";
const fmt = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1).replace(/\.0$/, "")}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1).replace(/\.0$/, "")}K` : String(n));
const PLATFORM: Record<string, string> = { instagram: "Instagram", youtube: "YouTube", tiktok: "TikTok", twitter: "X", facebook: "Facebook", other: "" };
const first = (name: string) => name.trim().split(/\s+/)[0] || name;

export function useBriefAllowance() {
  return useQuery<{ on: boolean; left: number | null }>({ queryKey: ["/api/host/guest-brief-allowance"], staleTime: 60_000, retry: false, queryFn: async () => (await apiRequest("GET", "/api/host/guest-brief-allowance")).json() });
}

/** The line on the form before anyone asks. */
export function BriefAsk({ name, left, busy, error, onLookUp }: { name: string; left: number | null; busy: boolean; error?: string; onLookUp: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[10px] border border-dashed border-[#c9d3e3] bg-[#fbfcfe] px-3 py-2.5 text-[13px] text-muted-foreground dark:border-white/20 dark:bg-white/5 sm:col-span-2" data-testid="brief-ask">
      <Search className="h-4 w-4 shrink-0 text-[#053877] dark:text-[#8fb5e8]" aria-hidden />
      <span className="min-w-0 flex-1 basis-[calc(100%-2rem)] [text-wrap:pretty] sm:basis-0"><b className="text-foreground">Guest brief.</b> We look up {first(name)}'s public profile and podcasts and suggest 5 questions. Only you see it.{error && <span className="mt-1 block font-medium text-red-700">{error}</span>}</span>
      {left !== null && <span className="ml-7 whitespace-nowrap text-xs sm:ml-0" data-testid="brief-left">{left} free this month</span>}
      <button type="button" onClick={onLookUp} disabled={busy} className="inline-flex h-[30px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border border-[#d0d5dd] bg-white px-3 text-[13px] font-semibold text-[#053877] hover:bg-[#f5f8fd] disabled:opacity-60 dark:border-white/20 dark:bg-transparent dark:text-[#8fb5e8]" data-testid="brief-look-up">
        {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}Look them up
      </button>
    </div>
  );
}

/** The card. Polls while the look-up runs; Edit keeps the host's own words; "Not them?" deletes it. */
export function BriefCard({ id, onGone, onAddQuestion }: { id: number; onGone: () => void; onAddQuestion?: (q: string) => void }) {
  const qc = useQueryClient();
  const key = [`/api/host/guest-brief/${id}`];
  const q = useQuery<BriefView>({ queryKey: key, retry: false, queryFn: async () => (await apiRequest("GET", key[0])).json(), refetchInterval: (query) => (query.state.data?.status === "running" ? 5000 : false) });
  const [editing, setEditing] = useState<string | null>(null);
  const [added, setAdded] = useState<number[]>([]);
  const save = useMutation({ mutationFn: async (notes: string) => (await apiRequest("PUT", key[0], { notes })).json() as Promise<BriefView>, onSuccess: (v) => { qc.setQueryData(key, v); setEditing(null); } });
  const gone = useMutation({ mutationFn: async () => apiRequest("DELETE", key[0]), onSuccess: () => { qc.removeQueries({ queryKey: key }); void qc.invalidateQueries({ queryKey: ["/api/host/guest-invites"] }); onGone(); } });
  const v = q.data;
  const b: Brief | null = v?.result ?? null;
  const shell = "rounded-xl border border-[#d7e0ee] bg-[#fbfcfe] px-3.5 py-3 text-[13px] dark:border-white/15 dark:bg-white/5 sm:col-span-2";
  const head = (actions?: boolean) => (
    <div className="flex flex-wrap items-center gap-2">
      <b className="text-sm">Guest brief</b>
      <span className="whitespace-nowrap rounded-full bg-[#eef3fb] px-2 py-px text-[11px] font-bold text-[#053877] dark:bg-white/10 dark:text-[#8fb5e8]">Only you see this</span>
      {actions && (
        <span className="ml-auto flex gap-3.5 whitespace-nowrap font-semibold">
          <button type="button" onClick={() => setEditing(v?.notes || plain(b))} className="text-[#053877] hover:underline dark:text-[#8fb5e8]" data-testid="brief-edit">Edit</button>
          <button type="button" onClick={() => { if (window.confirm("Remove this brief? You can look them up again with their LinkedIn or website.")) gone.mutate(); }} className="text-muted-foreground hover:underline" data-testid="brief-not-them">Not them?</button>
        </span>
      )}
    </div>
  );
  if (!v || v.status === "running") {
    return (
      <div className={shell} data-testid="brief-card" data-state="running">
        {head()}
        <div className="mt-2 flex items-center gap-2 text-muted-foreground">
          <span className="h-1.5 max-w-[220px] flex-1 overflow-hidden rounded-full bg-[#e9eef6] dark:bg-white/10"><span className="block h-full w-1/2 animate-pulse rounded-full bg-[#053877]" /></span>
          Looking up {v?.guestName || "your guest"}… you can send the invite now.
        </div>
      </div>
    );
  }
  if (v.status === "failed") {
    return <div className={shell} data-testid="brief-card" data-state="failed">{head()}<p className="mt-1.5 text-muted-foreground">{v.error}</p></div>;
  }
  if (editing !== null) {
    return (
      <div className={shell} data-testid="brief-card" data-state="editing">
        {head()}
        <Textarea value={editing} onChange={(e) => setEditing(e.target.value)} rows={8} maxLength={4000} className="mt-2 bg-background text-[13px]" aria-label="Your notes on this guest" data-testid="brief-notes" />
        <div className="mt-2 flex justify-end gap-2">
          <button type="button" onClick={() => setEditing(null)} className="h-8 rounded-lg border border-border px-3 font-semibold">Cancel</button>
          <button type="button" onClick={() => save.mutate(editing)} disabled={save.isPending} className="h-8 rounded-lg bg-[#053877] px-3 font-semibold text-white disabled:opacity-60" data-testid="brief-save">Save</button>
        </div>
      </div>
    );
  }
  const empty = !b || (!b.summary && !b.podcasts.length && !b.socials.length);
  return (
    <div className={shell} data-testid="brief-card" data-state="done">
      {head(true)}
      {v.notes ? (
        <p className="mt-2 whitespace-pre-line leading-relaxed">{v.notes}</p>
      ) : empty ? (
        <p className="mt-1.5 text-muted-foreground [text-wrap:pretty]">We couldn't find enough public about {v.guestName} to be sure it's them. Their answers to your questions will fill in the rest.</p>
      ) : b && (
        <>
          {b.summary && <p className="mt-2 leading-relaxed [text-wrap:pretty]">{b.summary}{b.sources.map((s) => <a key={s.n} href={s.url} target="_blank" rel="noreferrer" title={s.title} className="ml-1 rounded bg-[#eef3fb] px-1 align-[1px] text-[11px] font-bold text-[#053877] no-underline dark:bg-white/10 dark:text-[#8fb5e8]">{s.n}</a>)}</p>}
          <div className="mt-2.5 grid gap-x-6 gap-y-2.5 sm:grid-cols-2 [&>*]:min-w-0">
            <div className="space-y-2.5">
              {b.service && <Section k="Service"><Row t={b.service} d={b.serviceWhere ? `on ${b.serviceWhere.replace(/^on /, "")}` : ""} /></Section>}
              {b.podcasts.length > 0 && <Section k="Recent podcasts">{b.podcasts.map((p, i) => <Row key={i} t={/^(host|guest)$/i.test(p.episode) ? `${p.show} · as ${p.episode.toLowerCase() === "host" ? "host" : "a guest"}` : `${p.show} · "${p.episode}"`} d={p.date} href={p.url} />)}</Section>}
              {(b.socials.length > 0 || b.linkedin) && (
                <Section k="Socials">
                  {b.linkedin && <Row t="LinkedIn" href={b.linkedin} />}
                  {b.socials.map((s, i) => <Row key={i} t={`${PLATFORM[s.platform] ?? s.platform} @${s.handle}${s.followers ? ` · ${fmt(s.followers)}` : ""}`} href={s.url} likely={s.likely} />)}
                </Section>
              )}
            </div>
            {b.questions.length > 0 && (
              <Section k={`${b.questions.length} questions`}>
                <ol className="list-decimal space-y-1 pl-[18px]">
                  {b.questions.map((qq, i) => (
                    <li key={i}>{qq}{onAddQuestion && (added.includes(i) ? <span className="ml-1.5 whitespace-nowrap text-xs text-muted-foreground">Added</span> : <button type="button" onClick={() => { onAddQuestion(qq); setAdded((a) => [...a, i]); }} className="ml-1.5 whitespace-nowrap text-xs font-semibold text-[#053877] hover:underline dark:text-[#8fb5e8]" data-testid="brief-add-question">+ Add</button>)}</li>
                  ))}
                </ol>
              </Section>
            )}
          </div>
        </>
      )}
      <p className="mt-2.5 flex flex-wrap gap-x-2 border-t border-[#e9eef6] pt-2 text-xs text-muted-foreground dark:border-white/10">
        {!v.notes && b && b.sources.length > 0 && <span>Sources: {b.sources.map((s) => `${s.n} ${hostOf(s.url)}`).join(" · ")}</span>}
        <span>Saved to your notes for {first(v.guestName)}. Your conversation starters can use it.</span>
      </p>
    </div>
  );
}

function Section({ k, children }: { k: string; children: React.ReactNode }) {
  return <div><p className="mb-1 text-[11px] font-bold uppercase tracking-[0.06em] text-muted-foreground">{k}</p>{children}</div>;
}
function Row({ t, d, href, likely }: { t: string; d?: string; href?: string; likely?: boolean }) {
  const text = <span className="min-w-0 flex-1 [overflow-wrap:anywhere] sm:truncate">{t}</span>;
  return (
    <div className="my-0.5 flex items-baseline gap-2">
      {href ? <a href={href} target="_blank" rel="noreferrer" className="flex min-w-0 flex-1 hover:underline">{text}</a> : text}
      {likely && <span className="shrink-0 text-[11px] font-semibold text-[#8a6a1f]" title="We think this is them, but couldn't confirm it">likely</span>}
      {d && <span className="shrink-0 whitespace-nowrap text-xs text-muted-foreground">{d}</span>}
    </div>
  );
}
const hostOf = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return u; } };
function plain(b: Brief | null): string {
  if (!b) return "";
  return [b.summary, b.service && `Service: ${b.service}`, b.podcasts.length ? `Recent podcasts:\n${b.podcasts.map((p) => `- ${p.show}: ${p.episode}${p.date ? ` (${p.date})` : ""}`).join("\n")}` : "", b.questions.length ? `Questions:\n${b.questions.map((q, i) => `${i + 1}. ${q}`).join("\n")}` : ""].filter(Boolean).join("\n\n");
}

/** Start (or find) a brief. */
export function useStartBrief(onDone: (v: BriefView) => void, onError: (msg: string) => void) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: { guestName: string; guestEmail: string; linkedin: string; showId?: number | null; inviteId?: number }) => (await apiRequest("POST", "/api/host/guest-brief", body)).json() as Promise<BriefView>,
    onSuccess: (v) => { qc.setQueryData([`/api/host/guest-brief/${v.id}`], v); void qc.invalidateQueries({ queryKey: ["/api/host/guest-brief-allowance"] }); onDone(v); },
    onError: (e) => onError(say(e)),
  });
}
