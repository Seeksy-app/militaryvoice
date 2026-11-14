import { useEffect, useRef, useState } from "react";
import { ArrowRight, Check, ImagePlus, Loader2, Mic, Podcast, RefreshCw, Upload, Video } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

/**
 * The Podcast page's first screen (15 Nov 2026), after Andrew's mockup and Buzzsprout's steps:
 * "How would you like to begin?" Someone with a show brings it in (its RSS feed, or the files);
 * someone starting one answers five plain questions, picks a name from three ideas, edits the
 * description we write from their words, picks a cover, and lands with a way to record.
 */

const ORANGE = "#d9622b";
const NAVY = "#053877";
const say = (e: unknown) => ((e as Error).message ?? "").replace(/^\d+:\s*/, "").replace(/^\{"message":"|"\}$/g, "") || "Try again in a moment.";

type Answers = { about: string; who: string; hosts: string; often: string; feel: string[] };
const EMPTY: Answers = { about: "", who: "", hosts: "", often: "", feel: [] };
const DRAFT_KEY = "mv_pod_setup";

type Stage = "choose" | "writing" | "title" | "desc" | "art" | "creating" | "ready";
export type SetupNext = "show" | "upload" | "rooms" | "zoom";

const QUESTIONS: { key: keyof Answers; title: string; sub: string; kind: "text" | "chips"; placeholder?: string; chips?: string[]; multi?: boolean }[] = [
  { key: "about", title: "What's your show about?", sub: "Tell us the way you'd tell a friend. It doesn't have to be perfect.", kind: "text", placeholder: "Veterans tell the stories behind their service, and what came next…" },
  { key: "who", title: "Who is it for?", sub: "Who do you picture listening?", kind: "text", placeholder: "Veterans, military spouses, and anyone thinking about serving…" },
  { key: "hosts", title: "Who's talking?", sub: "You, and anyone who joins you.", kind: "text", placeholder: "I host it, with my co-host…" },
  { key: "often", title: "How often will you publish?", sub: "Pick the closest. You can change it any time.", kind: "chips", chips: ["Every week", "Every two weeks", "Once a month", "Not sure yet"] },
  { key: "feel", title: "How should it feel?", sub: "Pick up to three.", kind: "chips", multi: true, chips: ["Warm", "Funny", "Serious", "Straight talk", "Inspiring", "Practical"] },
];

function Progress({ stage, q }: { stage: Stage; q: number }) {
  const inQ = stage === "choose";
  const steps = [
    { label: `Questions ${Math.min(q + 1, 5)}/5`, fill: inQ ? (q + 1) / 5 : 1 },
    { label: "Title", fill: stage === "title" ? 0.5 : ["desc", "art", "creating", "ready"].includes(stage) ? 1 : 0 },
    { label: "Description", fill: stage === "desc" ? 0.5 : ["art", "creating", "ready"].includes(stage) ? 1 : 0 },
    { label: "Artwork", fill: stage === "art" ? 0.5 : ["creating", "ready"].includes(stage) ? 1 : 0 },
  ];
  return (
    <div className="grid grid-cols-4 gap-3" aria-label="Setup progress">
      {steps.map((s, i) => (
        <div key={s.label}>
          <p className={`text-sm font-semibold ${s.fill > 0 ? "text-foreground" : "text-muted-foreground"}`}>{i === 0 ? s.label : s.label}</p>
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full transition-all" style={{ width: `${s.fill * 100}%`, background: NAVY }} /></div>
        </div>
      ))}
    </div>
  );
}

function BeginCard({ icon: Icon, title, text, action, selected, onClick, testid, withIcon }: { icon: typeof Mic; title: string; text: string; action?: string; selected?: boolean; onClick: () => void; testid: string; withIcon?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`group flex flex-col rounded-3xl border-2 bg-card p-6 text-left transition-colors hover:border-[#053877] ${action || withIcon ? "min-h-[11rem]" : ""}`}
      style={{ borderColor: selected ? ORANGE : undefined }}
      aria-pressed={selected}
      data-testid={testid}
    >
      {(action || withIcon) && <span className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl border-2 border-foreground/80"><Icon className="h-6 w-6" /></span>}
      <span className="text-2xl font-bold tracking-tight [text-wrap:balance]">{title}</span>
      <span className="mt-1.5 text-[15px] text-muted-foreground [text-wrap:balance]">{text}</span>
      {action && <span className="mt-auto pt-5 font-bold" style={{ color: selected ? ORANGE : NAVY }}>{action} <ArrowRight className="inline h-4 w-4" /></span>}
    </button>
  );
}

export function PodcastSetup({ initialFeed, onImported, onCreating, onFinish }: {
  initialFeed: string;
  /** A show came in from a feed. */
  onImported: () => void;
  /** About to create their show: keep this screen up while the list refreshes underneath. */
  onCreating: () => void;
  /** They chose what's next. `id` is the show just made. */
  onFinish: (next: SetupNext, id: number | null) => void;
}) {
  const { toast } = useToast();
  const [stage, setStage] = useState<Stage>("choose");
  const [path, setPath] = useState<"" | "have" | "new">("");
  const [have, setHave] = useState<"" | "rss" | "upload">(initialFeed ? "rss" : "");
  const [feed, setFeed] = useState(initialFeed);
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState(-1); // -1: not in the questions
  const [ans, setAns] = useState<Answers>(() => { try { return { ...EMPTY, ...(JSON.parse(localStorage.getItem(DRAFT_KEY) ?? "{}") as Partial<Answers>) }; } catch { return EMPTY; } });
  const [titles, setTitles] = useState<string[]>([]);
  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");
  const [covers, setCovers] = useState<string[]>([]);
  const [cover, setCover] = useState("");
  const [mine, setMine] = useState<File | null>(null);
  const [coverBusy, setCoverBusy] = useState(false);
  const [coverMsg, setCoverMsg] = useState("");
  const [madeId, setMadeId] = useState<number | null>(null);
  const top = useRef<HTMLDivElement>(null);

  useEffect(() => { try { localStorage.setItem(DRAFT_KEY, JSON.stringify(ans)); } catch { /* fine */ } }, [ans]);
  useEffect(() => { top.current?.scrollIntoView({ block: "start", behavior: "smooth" }); }, [stage, q, path, have]);

  const inQuestions = q >= 0 && stage === "choose";

  // ---- An existing show ------------------------------------------------------------------
  async function importFeed() {
    setBusy(true);
    try {
      const r = (await (await apiRequest("POST", "/api/host/hosting/import", { feedUrl: feed.trim() })).json()) as { episodes: number };
      toast({ title: "Your show is here", description: `${r.episodes} episode${r.episodes === 1 ? "" : "s"} moved over. Next: forward your old feed so your subscribers follow.` });
      onImported();
    } catch (e) { toast({ title: "Couldn't move that show", description: say(e), variant: "destructive" }); } finally { setBusy(false); }
  }
  async function startUpload() {
    setBusy(true);
    onCreating();
    try {
      const s = (await (await apiRequest("POST", "/api/host/hosting/shows", {})).json()) as { id: number };
      onFinish("upload", s.id);
    } catch (e) { toast({ title: "Couldn't set that up", description: say(e), variant: "destructive" }); } finally { setBusy(false); }
  }

  // ---- A new show ------------------------------------------------------------------------
  async function writeIt(then: Stage) {
    setStage("writing");
    try {
      const r = (await (await apiRequest("POST", "/api/host/hosting/setup/write", { answers: ans })).json()) as { titles: string[]; description: string };
      setTitles(r.titles);
      setTitle((t) => t || r.titles[0] || "");
      setDesc(r.description);
      setStage(then);
    } catch (e) {
      toast({ title: "Couldn't write that just now", description: say(e), variant: "destructive" });
      setStage("choose");
      setQ(4);
    }
  }
  async function makeCovers() {
    setCoverBusy(true); setCoverMsg("");
    try {
      const r = (await (await apiRequest("POST", "/api/host/hosting/setup/artwork", { title, about: ans.about })).json()) as { options: string[] };
      setCovers(r.options); setCover(r.options[0] ?? ""); setMine(null);
    } catch (e) { setCoverMsg(say(e)); } finally { setCoverBusy(false); }
  }
  useEffect(() => { if (stage === "art" && !covers.length && !coverBusy && !coverMsg) void makeCovers(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [stage]);

  async function createShow() {
    setStage("creating");
    onCreating();
    try {
      const s = (await (await apiRequest("POST", "/api/host/hosting/shows", { title: title.trim(), description: desc.trim(), artworkUrl: mine ? "" : cover })).json()) as { id: number };
      if (mine) {
        const fd = new FormData(); fd.append("file", mine);
        const r = await fetch(`/api/host/hosting/shows/${s.id}/artwork`, { method: "POST", body: fd, credentials: "include" });
        if (!r.ok) toast({ title: "Your show is made, but that picture didn't take", description: ((await r.json().catch(() => ({}))) as { message?: string }).message ?? "You can add cover art from Show details.", variant: "destructive" });
      }
      try { localStorage.removeItem(DRAFT_KEY); } catch { /* fine */ }
      setMadeId(s.id);
      setStage("ready");
    } catch (e) { toast({ title: "Couldn't set that up", description: say(e), variant: "destructive" }); setStage("art"); }
  }

  const cur = QUESTIONS[Math.max(q, 0)];
  const val = ans[cur.key];
  const filled = cur.kind === "text" ? String(val).trim().length >= (cur.key === "about" ? 8 : 2) : cur.multi ? (val as string[]).length > 0 : !!val;
  const nextQ = () => { if (q < QUESTIONS.length - 1) setQ(q + 1); else void writeIt("title"); };
  const toggleFeel = (c: string) => setAns((a) => ({ ...a, feel: a.feel.includes(c) ? a.feel.filter((x) => x !== c) : a.feel.length >= 3 ? a.feel : [...a.feel, c] }));
  const nextBtn = "h-12 rounded-xl px-10 text-base font-bold text-white disabled:bg-muted-foreground/40";

  // ---- The screens -----------------------------------------------------------------------
  if (inQuestions || stage === "writing" || stage === "title" || stage === "desc" || stage === "art" || stage === "creating") {
    return (
      <section className="mx-auto mt-4 max-w-3xl" data-testid="podcast-setup-wizard">
        <div ref={top} />
        <Progress stage={stage === "writing" ? "choose" : stage} q={stage === "writing" ? 4 : q} />
        <div className="mt-10">
          {inQuestions && (
            <>
              <h1 className="text-4xl font-bold tracking-tight [text-wrap:balance] sm:text-5xl">{cur.title}</h1>
              <p className="mt-3 text-lg text-muted-foreground [text-wrap:balance]">{cur.sub}</p>
              {cur.kind === "text" ? (
                <Textarea
                  key={cur.key}
                  autoFocus
                  value={String(val)}
                  onChange={(e) => setAns((a) => ({ ...a, [cur.key]: e.target.value }))}
                  rows={4}
                  placeholder={cur.placeholder}
                  className="mt-6 min-h-[8rem] rounded-xl border-2 p-4 text-lg"
                  data-testid="setup-answer"
                />
              ) : (
                <div className="mt-6 flex flex-wrap gap-3" data-testid="setup-chips">
                  {cur.chips!.map((c) => {
                    const on = cur.multi ? (val as string[]).includes(c) : val === c;
                    return (
                      <button key={c} type="button" onClick={() => (cur.multi ? toggleFeel(c) : setAns((a) => ({ ...a, [cur.key]: c })))} aria-pressed={on}
                        className="rounded-full border-2 px-5 py-2.5 text-base font-semibold transition-colors hover:border-[#053877]" style={{ borderColor: on ? ORANGE : undefined, background: on ? `${ORANGE}14` : undefined }}>
                        {on && <Check className="mr-1.5 inline h-4 w-4" />}{c}
                      </button>
                    );
                  })}
                </div>
              )}
              <div className="mt-8 flex items-center justify-between">
                <button type="button" onClick={() => (q > 0 ? setQ(q - 1) : setQ(-1))} className="text-sm font-semibold text-muted-foreground hover:text-foreground">Back</button>
                <Button onClick={nextQ} disabled={!filled} className={nextBtn} style={{ background: filled ? NAVY : undefined }} data-testid="setup-next">Next</Button>
              </div>
              <p className="mt-10 text-center"><button type="button" onClick={() => setQ(-1)} className="text-base font-medium underline underline-offset-4 text-muted-foreground hover:text-foreground">Not ready? Finish later</button></p>
            </>
          )}

          {stage === "writing" && (
            <div className="py-16 text-center" data-testid="setup-writing">
              <Loader2 className="mx-auto h-8 w-8 animate-spin text-muted-foreground" />
              <p className="mt-4 text-2xl font-bold">Writing your name ideas and description…</p>
              <p className="mt-1 text-muted-foreground">A few seconds.</p>
            </div>
          )}

          {stage === "title" && (
            <>
              <h1 className="text-4xl font-bold tracking-tight [text-wrap:balance] sm:text-5xl">Pick a name</h1>
              <p className="mt-3 text-lg text-muted-foreground">Here are three ideas. Pick one, or write your own.</p>
              <div className="mt-6 grid gap-3" role="radiogroup">
                {titles.map((t) => (
                  <button key={t} type="button" role="radio" aria-checked={title === t} onClick={() => setTitle(t)} className="rounded-2xl border-2 p-5 text-left text-2xl font-bold transition-colors hover:border-[#053877]" style={{ borderColor: title === t ? ORANGE : undefined }} data-testid="setup-title-option">{t}</button>
                ))}
              </div>
              <label className="mt-6 block text-sm font-semibold">Or write your own</label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} className="mt-1.5 h-12 rounded-xl border-2 text-lg" data-testid="setup-title" />
              <div className="mt-8 flex items-center justify-between">
                <button type="button" onClick={() => { setStage("choose"); setQ(4); }} className="text-sm font-semibold text-muted-foreground hover:text-foreground">Back</button>
                <Button onClick={() => setStage("desc")} disabled={title.trim().length < 2} className={nextBtn} style={{ background: title.trim().length >= 2 ? NAVY : undefined }} data-testid="setup-next">Next</Button>
              </div>
            </>
          )}

          {stage === "desc" && (
            <>
              <h1 className="text-4xl font-bold tracking-tight [text-wrap:balance] sm:text-5xl">Here's how we'd describe it</h1>
              <p className="mt-3 text-lg text-muted-foreground">It's what people read in Apple Podcasts and Spotify. Change anything you like.</p>
              <Textarea value={desc} onChange={(e) => setDesc(e.target.value)} rows={7} maxLength={900} className="mt-6 rounded-xl border-2 p-4 text-lg" data-testid="setup-desc" />
              <button type="button" onClick={() => void writeIt("desc")} className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold hover:underline" style={{ color: NAVY }}><RefreshCw className="h-4 w-4" /> Write it again</button>
              <div className="mt-8 flex items-center justify-between">
                <button type="button" onClick={() => setStage("title")} className="text-sm font-semibold text-muted-foreground hover:text-foreground">Back</button>
                <Button onClick={() => setStage("art")} disabled={desc.trim().length < 10} className={nextBtn} style={{ background: desc.trim().length >= 10 ? NAVY : undefined }} data-testid="setup-next">Next</Button>
              </div>
            </>
          )}

          {stage === "art" && (
            <>
              <h1 className="text-4xl font-bold tracking-tight [text-wrap:balance] sm:text-5xl">Pick your cover</h1>
              <p className="mt-3 text-lg text-muted-foreground">It's the square picture people see. Pick one of ours, or use your own.</p>
              {coverBusy ? (
                <div className="mt-8 grid grid-cols-3 gap-3" data-testid="setup-covers-loading">
                  {[0, 1, 2].map((i) => <div key={i} className="flex aspect-square items-center justify-center rounded-2xl bg-muted"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>)}
                  <p className="col-span-3 text-center text-sm text-muted-foreground">Drawing three covers with your name on them. About 15 seconds.</p>
                </div>
              ) : (
                <div className="mt-8 grid grid-cols-3 gap-3" role="radiogroup" data-testid="setup-covers">
                  {covers.map((u) => (
                    <button key={u} type="button" role="radio" aria-checked={!mine && cover === u} onClick={() => { setCover(u); setMine(null); }} className="overflow-hidden rounded-2xl border-4 transition-colors hover:border-[#053877]" style={{ borderColor: !mine && cover === u ? ORANGE : "transparent" }}>
                      <img src={u} alt="A cover idea" className="aspect-square w-full object-cover" />
                    </button>
                  ))}
                  {mine && <div className="relative overflow-hidden rounded-2xl border-4" style={{ borderColor: ORANGE }}><img src={URL.createObjectURL(mine)} alt="Your cover" className="aspect-square w-full object-cover" /></div>}
                </div>
              )}
              {coverMsg && <p className="mt-4 text-sm text-red-600" role="alert">{coverMsg}</p>}
              <div className="mt-5 flex flex-wrap items-center gap-4">
                <label className="inline-flex cursor-pointer items-center gap-1.5 text-sm font-semibold hover:underline" style={{ color: NAVY }}>
                  <ImagePlus className="h-4 w-4" /> Use my own picture
                  <input type="file" accept="image/jpeg,image/png" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) { if (f.size > 12 * 1024 ** 2) toast({ title: "Keep it under 12MB", variant: "destructive" }); else { setMine(f); setCoverMsg(""); } } }} data-testid="setup-upload-cover" />
                </label>
                <button type="button" disabled={coverBusy} onClick={() => void makeCovers()} className="inline-flex items-center gap-1.5 text-sm font-semibold hover:underline disabled:opacity-50" style={{ color: NAVY }}><RefreshCw className="h-4 w-4" /> Make three more</button>
              </div>
              <div className="mt-8 flex items-center justify-between">
                <button type="button" onClick={() => setStage("desc")} className="text-sm font-semibold text-muted-foreground hover:text-foreground">Back</button>
                <div className="flex items-center gap-4">
                  <button type="button" onClick={() => { setCover(""); setMine(null); void createShow(); }} className="text-sm font-semibold text-muted-foreground hover:text-foreground">Skip for now</button>
                  <Button onClick={() => void createShow()} disabled={coverBusy || (!cover && !mine)} className={nextBtn} style={{ background: !coverBusy && (cover || mine) ? NAVY : undefined }} data-testid="setup-create">Create my show</Button>
                </div>
              </div>
            </>
          )}

          {stage === "creating" && (
            <div className="py-16 text-center">
              <Loader2 className="mx-auto h-8 w-8 animate-spin text-muted-foreground" />
              <p className="mt-4 text-2xl font-bold">Setting up your show…</p>
            </div>
          )}
        </div>
      </section>
    );
  }

  if (stage === "ready") {
    return (
      <section className="mx-auto mt-4 max-w-4xl" data-testid="podcast-setup-ready">
        <div ref={top} />
        <p className="text-xs font-bold uppercase tracking-[0.2em]" style={{ color: ORANGE }}>Your show is ready</p>
        <h1 className="mt-2 text-4xl font-bold tracking-tight [text-wrap:balance] sm:text-5xl">How will you record?</h1>
        <p className="mt-3 text-lg text-muted-foreground">Pick one to start. You can use all of them later.</p>
        <div className="mt-8 grid gap-4 sm:grid-cols-3">
          <BeginCard icon={Video} withIcon title="Record in Rooms" text="Quick, like Zoom. Guests join on a link." onClick={() => onFinish("rooms", madeId)} testid="setup-record-rooms" />
          <BeginCard icon={Upload} withIcon title="Upload an episode" text="Audio or video you already have." onClick={() => onFinish("upload", madeId)} testid="setup-record-upload" />
          <BeginCard icon={Mic} withIcon title="Use Zoom" text="Your Zoom cloud recordings land in your Library." onClick={() => onFinish("zoom", madeId)} testid="setup-record-zoom" />
        </div>
        <p className="mt-8"><button type="button" onClick={() => onFinish("show", madeId)} className="text-base font-semibold underline underline-offset-4" style={{ color: NAVY }} data-testid="setup-go-show">Go to my show</button></p>
      </section>
    );
  }

  // ---- The opening screen: how would you like to begin? -----------------------------------
  return (
    <section className="mx-auto mt-4 max-w-5xl" data-testid="podcast-setup">
      <div ref={top} />
      <p className="text-xs font-bold uppercase tracking-[0.2em]" style={{ color: ORANGE }}>Podcast setup</p>
      <h1 className="mt-2 text-4xl font-bold tracking-tight [text-wrap:balance] sm:text-5xl">How would you like to begin?</h1>
      <p className="mt-3 text-lg text-muted-foreground">Bring an existing podcast, or create a new one here.</p>
      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        <BeginCard icon={Podcast} title="I already have a podcast" text="Connect its RSS feed or upload your episodes." action="Bring in my podcast" selected={path === "have"} onClick={() => setPath("have")} testid="setup-have" />
        <BeginCard icon={Mic} title="I'm starting a podcast" text="Answer a few questions. We'll help with the name, the description and the cover." action="Create my podcast" selected={path === "new"} onClick={() => { setPath("new"); setQ(0); }} testid="setup-new" />
      </div>

      {path === "have" && (
        <div className="mt-10 border-t border-border pt-8" data-testid="setup-existing">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-muted-foreground">Existing podcast</p>
          <h2 className="mt-2 text-3xl font-bold tracking-tight">Where is your podcast hosted?</h2>
          <p className="mt-2 text-muted-foreground">Choose how you'd like to bring your episodes into MilitaryVoices.</p>
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <BeginCard icon={Podcast} title="Use my RSS feed" text="Bring in your existing episodes." selected={have === "rss"} onClick={() => setHave("rss")} testid="setup-rss" />
            <BeginCard icon={Upload} title="Upload my episodes" text="Add your audio or video files." selected={have === "upload"} onClick={() => setHave("upload")} testid="setup-upload" />
          </div>
          {have === "rss" && (
            <form onSubmit={(e) => { e.preventDefault(); void importFeed(); }} className="mt-5 rounded-2xl border border-border bg-card p-5" data-testid="setup-rss-form">
              <p className="font-bold">Your podcast's RSS feed</p>
              <Input value={feed} onChange={(e) => setFeed(e.target.value)} placeholder="Paste your RSS feed URL" className="mt-2 h-12 text-base" data-testid="hosting-import-url" />
              <Button type="submit" disabled={busy || !/^https?:\/\//.test(feed.trim())} className="mt-3 h-11 rounded-lg px-6 font-bold text-white" style={{ background: NAVY }}>{busy ? <><Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> Moving…</> : "Continue"}</Button>
              <p className="mt-3 text-xs text-muted-foreground">It's in your old host's settings, often under Distribution or RSS. Buzzsprout, Libsyn, Transistor, Podbean, RSS.com, Spotify for Creators and the rest all have one. We bring every episode, its notes and its artwork, and show you how to forward the feed so your subscribers follow.</p>
            </form>
          )}
          {have === "upload" && (
            <div className="mt-5 rounded-2xl border border-border bg-card p-5" data-testid="setup-upload-form">
              <p className="font-bold">Upload your episodes</p>
              <p className="mt-1 text-sm text-muted-foreground">We'll set up your show, then you add your first episode. Audio or video both work.</p>
              <Button onClick={() => void startUpload()} disabled={busy} className="mt-3 h-11 rounded-lg px-6 font-bold text-white" style={{ background: NAVY }} data-testid="setup-upload-go">{busy ? <><Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> One moment…</> : "Continue"}</Button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
