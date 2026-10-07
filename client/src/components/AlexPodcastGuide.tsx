import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, Check, ExternalLink, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

// Alex, your podcast producer (7 Oct): before any advice, a few questions one
// at a time, so the plan fits where they are. What we already know (their
// feed from sign-up, its host, whether Apple lists it) is filled in, not asked.
// The plan at the end: move it here and keep Apple and Spotify, get back into
// the old host first, start a new show, or have our team do it with them.

type Answers = { published?: string; record?: string[]; host?: string; access?: string; listed?: string[]; ready?: string[]; help?: string };
type Known = { rss: string; host: string; apple: string; episodes: number; title: string };
type Data = { answers: Answers; done: boolean; known: Known };

const RECORD = ["Zoom", "Riverside", "StreamYard", "YouTube", "Zencastr", "Descript", "Audacity or GarageBand", "My phone", "Something else"];
const HOSTS = ["Buzzsprout", "Libsyn", "Spotify for Creators", "Captivate", "Transistor", "Podbean", "RSS.com", "Another host", "I'm not sure"];
const LISTED = ["Apple Podcasts", "Spotify", "YouTube", "Amazon Music", "Somewhere else", "Nowhere yet", "I don't know"];
const READY = ["Name", "Description", "Cover art", "First episode"];

type Q = { id: keyof Answers; ask: string; sub?: string; options: string[]; multi?: boolean; show: (a: Answers) => boolean };

function Pick({ options, value, multi, onChange }: { options: string[]; value: string | string[] | undefined; multi?: boolean; onChange: (v: string | string[]) => void }) {
  const on = (o: string) => (multi ? (value as string[] | undefined)?.includes(o) : value === o);
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {options.map((o) => (
        <button key={o} type="button" aria-pressed={!!on(o)} onClick={() => {
          if (!multi) return onChange(o);
          const cur = (value as string[] | undefined) ?? [];
          onChange(cur.includes(o) ? cur.filter((x) => x !== o) : [...cur, o]);
        }} className={`flex items-center gap-2 rounded-xl border-2 px-3.5 py-2.5 text-left text-sm transition ${on(o) ? "border-[#053877] bg-[#053877]/[0.06] font-semibold" : "border-border hover:border-[#053877]/40"}`}>
          {multi && <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${on(o) ? "border-[#053877] bg-[#053877] text-white" : "border-muted-foreground/40"}`}>{on(o) && <Check className="h-3 w-3" />}</span>}
          {o}
        </button>
      ))}
    </div>
  );
}

export function AlexPodcastGuide({ onMove, onStart, moving }: { onMove: (rss: string) => void; onStart: () => void; moving?: boolean }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const q = useQuery<Data>({ queryKey: ["/api/host/podcast-intake"], queryFn: async () => (await apiRequest("GET", "/api/host/podcast-intake")).json() });
  const [open, setOpen] = useState(false);
  const [a, setA] = useState<Answers>({});
  const [i, setI] = useState(0);
  const known = q.data?.known;

  // What we know goes in first; a first visit opens the questions on its own.
  useEffect(() => {
    if (!q.data) return;
    const k = q.data.known;
    setA({
      ...(k.rss ? { published: "Yes, it's out" } : {}),
      ...(k.host && k.host !== "MilitaryVoices" ? { host: HOSTS.includes(k.host) ? k.host : "Another host" } : {}),
      ...q.data.answers,
    });
    if (!q.data.done) setOpen(true);
  }, [q.data]);

  const out = a.published === "Yes, it's out";
  const hostName = known?.host && known.host !== "MilitaryVoices" ? known.host : a.host && !["Another host", "I'm not sure"].includes(a.host) ? a.host : "your current host";
  const questions: Q[] = useMemo(() => [
    { id: "published", ask: "Have you already recorded or published any episodes?", options: ["Yes, it's out", "Recorded, not published yet", "Not yet"], show: () => !known?.rss },
    { id: "record", ask: "Where do you record and edit your episodes?", sub: "Pick any.", options: RECORD, multi: true, show: () => true },
    { id: "host", ask: known?.host ? `It looks like your show is on ${known.host}. Is that right?` : "Which podcast host is your show on?", options: HOSTS, show: (x) => x.published === "Yes, it's out" },
    { id: "access", ask: `Can you sign in to your ${hostName} account?`, sub: "You'll need it to keep your Apple and Spotify listings when you move.", options: ["Yes", "I'm not sure", "No, it's locked or unpaid"], show: (x) => x.published === "Yes, it's out" && x.host !== "I'm not sure" },
    // Nothing ticked for them: only what they know (7 Oct). We mention what Apple's directory shows.
    { id: "listed", ask: "Where is it listed already?", sub: known?.apple ? "Pick any. (We found it in Apple's directory, so Apple Podcasts is likely.)" : "Pick any. Not sure is fine.", options: LISTED, multi: true, show: (x) => x.published === "Yes, it's out" },
    { id: "ready", ask: "What do you have ready?", sub: "Pick any. It's fine if it's none yet.", options: READY, multi: true, show: (x) => x.published !== "Yes, it's out" },
    { id: "help", ask: "Would you like me to walk you through it, or have our team set it up with you?", options: ["Walk me through it", "Have the team do it with me"], show: () => true },
  ], [known, hostName]);
  const asked = questions.filter((x) => x.show(a));
  const cur = asked[Math.min(i, asked.length - 1)];
  const answered = (x: Q) => { const v = a[x.id]; return Array.isArray(v) ? v.length > 0 : !!v; };

  const save = async (done: boolean) => {
    const answers = { ...a, help: a.help === "Have the team do it with me" ? "do-it" : a.help ? "guide" : undefined };
    try {
      await apiRequest("PUT", "/api/host/podcast-intake", { answers: { ...a, help: answers.help }, done });
      void qc.invalidateQueries({ queryKey: ["/api/host/podcast-intake"] });
    } catch (e) { toast({ title: "Not saved", description: (e as Error).message, variant: "destructive" }); }
  };
  const finish = async () => { await save(true); setOpen(false); };

  if (!q.data) return null;
  const done = q.data.done && !open;
  const help = (q.data.answers.help as string | undefined) ?? (a.help === "Have the team do it with me" ? "do-it" : "guide");
  const hasAccess = a.access === "Yes";

  return (
    <>
      {/* The plan, once they've answered */}
      {done && (
        <section className="mb-6 rounded-2xl border border-[#053877]/25 bg-card p-5" data-testid="alex-plan">
          <div className="flex items-start gap-3">
            <img src="/alex.jpg" alt="" className="h-11 w-11 shrink-0 rounded-full object-cover" />
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Alex · your podcast producer</p>
              {help === "do-it" ? (
                <p className="mt-1 text-sm">Thanks. Our team will set it up with you, and we'll email you within a working day to find a time. Nothing to do until then.</p>
              ) : out && hostName !== "MilitaryVoices" ? (
                hasAccess ? (
                  <>
                    <p className="mt-1 text-sm font-semibold">Here's how we move {known?.title || "your show"} here and keep your Apple and Spotify listings:</p>
                    <ol className="mt-2 space-y-2 text-sm">
                      <li><b>1.</b> Move it here: every episode{known?.episodes ? ` (all ${known.episodes})` : ""}, its notes and artwork come over. {known?.rss && <Button size="sm" onClick={() => onMove(known.rss)} disabled={moving} className="ml-1 h-7 rounded-full bg-[#053877] text-white hover:bg-[#0a4a99]">{moving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Move it here"}</Button>}{!known?.rss && " Paste your feed below."}</li>
                      <li><b>2.</b> In {hostName}, turn on the feed redirect (it's in your show's settings). That tells Apple, Spotify and every app your show now lives here. <a href={`https://www.google.com/search?q=${encodeURIComponent(`${hostName} redirect rss feed to new host`)}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 font-semibold text-[#053877] hover:underline dark:text-[#9cc2ff]">How on {hostName} <ExternalLink className="h-3 w-3" /></a></li>
                      <li><b>3.</b> Press <b>Check the redirect</b> here. Keep your {hostName} account open about four weeks while the apps catch up.</li>
                    </ol>
                    <p className="mt-2 text-xs text-muted-foreground">Your Apple and Spotify links stay the same, and your subscribers follow you over.</p>
                  </>
                ) : (
                  <>
                    <p className="mt-1 text-sm">The move itself is easy: <b>Move it here</b> brings every episode over. What keeps your Apple and Spotify listings is a forward from your old feed to your new one, set at {hostName}.</p>
                    <p className="mt-1 text-sm">Can't get into {hostName}, or it's locked until you pay? Ask {hostName}'s support to turn on the redirect to your new feed (hosts do this for paused accounts too). If you own your Apple listing, you can also change its feed address yourself in Apple Podcasts Connect. Or have our team do it with you.</p>
                    {known?.rss && <Button size="sm" onClick={() => onMove(known.rss)} disabled={moving} className="mt-2 h-8 rounded-full bg-[#053877] text-white hover:bg-[#0a4a99]">{moving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Move it here"}</Button>}
                  </>
                )
              ) : (
                <>
                  <p className="mt-1 text-sm font-semibold">Let's get your show out. Three steps:</p>
                  <ol className="mt-2 space-y-2 text-sm">
                    <li><b>1.</b> Set up your show: its name, a short description and cover art (3000 × 3000 pixels is best). <Button size="sm" onClick={onStart} className="ml-1 h-7 rounded-full bg-[#053877] text-white hover:bg-[#0a4a99]">Set up my show</Button></li>
                    <li><b>2.</b> Add your first episode: upload the audio or video, or use a recording from your Library.</li>
                    <li><b>3.</b> Submit it to Apple Podcasts and Spotify from your show's Directories tab. After that, new episodes go out on their own.</li>
                  </ol>
                </>
              )}
              {(a.record ?? []).length > 0 && help !== "do-it" && (
                <p className="mt-3 rounded-xl bg-muted/60 px-3 py-2 text-sm">
                  {(a.record ?? []).includes("Zoom")
                    ? <>You record on Zoom: connect it under <a href="/host/dashboard/integrations" className="font-semibold underline">Integrations</a> and your cloud recordings land in your Library on their own, ready to publish and to clip.</>
                    : <>From {(a.record ?? []).filter((x) => x !== "Something else").join(", ") || "your recorder"}: export the audio or video and upload it as an episode or into your Library. Pōstify cuts the clips from it.</>}
                </p>
              )}
              <button type="button" onClick={() => { setI(0); setOpen(true); }} className="mt-3 text-xs font-semibold text-muted-foreground hover:text-foreground">Change my answers</button>
            </div>
          </div>
        </section>
      )}

      {/* The questions, one at a time */}
      {open && cur && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 p-4 sm:items-center" data-testid="alex-guide" data-guide-wait>
          <div className="w-full max-w-lg rounded-3xl bg-background p-6 shadow-2xl">
            <div className="flex items-start gap-3">
              <img src="/alex.jpg" alt="" className="h-12 w-12 shrink-0 rounded-full object-cover ring-2 ring-[#F0A71F]/60" />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Alex · your podcast producer · {Math.min(i, asked.length - 1) + 1} of {asked.length}</p>
                {i === 0 && <p className="mt-1 text-sm text-muted-foreground">Hi! I'll help you get your show on Apple Podcasts, Spotify and the rest. A few quick questions first, so I point you the simplest way.</p>}
                <h2 className="mt-2 text-lg font-semibold leading-snug">{cur.ask}</h2>
                {cur.sub && <p className="text-sm text-muted-foreground">{cur.sub}</p>}
              </div>
              <button type="button" onClick={() => { void save(false); setOpen(false); }} className="rounded-full p-1.5 text-muted-foreground hover:bg-muted" aria-label="Later"><X className="h-4 w-4" /></button>
            </div>
            <div className="mt-4">
              <Pick options={cur.options} multi={cur.multi} value={a[cur.id] as string | string[] | undefined} onChange={(v) => setA((x) => ({ ...x, [cur.id]: v }))} />
            </div>
            <div className="mt-5 flex items-center justify-between">
              <Button variant="ghost" disabled={i === 0} onClick={() => setI((n) => Math.max(0, n - 1))} className="gap-1"><ArrowLeft className="h-4 w-4" /> Back</Button>
              {i < asked.length - 1 ? (
                <Button disabled={!answered(cur)} onClick={() => setI((n) => n + 1)} className="gap-1 rounded-full bg-[#053877] text-white hover:bg-[#0a4a99]" data-testid="alex-next">Next <ArrowRight className="h-4 w-4" /></Button>
              ) : (
                <Button disabled={!answered(cur)} onClick={() => void finish()} className="gap-1 rounded-full bg-[#F0A71F] font-semibold text-[#1a1200] hover:bg-[#f5b944]" data-testid="alex-done">See my plan <ArrowRight className="h-4 w-4" /></Button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
