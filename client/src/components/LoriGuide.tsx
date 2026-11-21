import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Loader2, Mic, Send, Sparkles, Square, Volume2, X } from "lucide-react";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { Turnstile, useTurnstileSiteKey } from "@/components/Turnstile";
import { GuideLayer, showGuide, hideGuide } from "@/components/Guide";
import type { GuideTarget } from "@shared/guideTargets";
import { DEFAULT_GUIDE, GUIDES, guideById, type GuideId } from "@shared/guides";
import { GuidePicker, guidePickable, useSaveGuide } from "@/components/GuidePicker";

/**
 * An account's own AI guide (Lori for Frank, mockup approved 21 Nov 2026). Only when GET /api/guide/me says
 * enabled; then she takes Ask Alex's place. She answers, and when a page would help she offers it ("Want me to
 * open that for you?"). Only after "Yes, open it" does she go there and point at each control (showGuide with
 * Back / Stop / Next). He makes every click. Voice is off until he taps the mic. She's AI, never a person.
 */
export type GuideMe =
  /** offer: show the one-time "Pick your guide" step; canPick: Settings → Your guide can switch one on. */
  | { enabled: false; offer?: boolean; canPick?: boolean }
  | { enabled: true; guideId?: string | null; name: string; avatarUrl: string; voice: boolean; targets: GuideTarget[] };
const KEY = ["/api/guide/me"];
const SPEAK = "mv-guide-speak";
/** When she doesn't know (Alex's rule): never promise a person, never say someone is looking. */
const NOT_SURE = "I'm not sure about that one. Leave a note and someone will get back to you as soon as possible.";

export function useGuide(): GuideMe | undefined {
  return useQuery<GuideMe>({
    queryKey: KEY, staleTime: 300_000, retry: false,
    queryFn: async () => { const r = await fetch("/api/guide/me", { credentials: "include", cache: "no-store" }); return r.ok ? r.json() : { enabled: false }; },
  }).data;
}

/** Who answers on this account: the guide's name when it has one (Lori, or what he renamed her), else Alex. */
export function useGuideName(): string {
  const g = useGuide();
  return g?.enabled ? g.name : "Alex";
}

/** The guide's face and name for the dashboard's Ask box; null while Alex answers. */
export function useGuideFace(): { name: string; avatarUrl: string } | null {
  const g = useGuide();
  return g?.enabled ? { name: g.name, avatarUrl: g.avatarUrl } : null;
}

export { Face as GuideFace };

type Offer = { id: string; label: string };
type Msg = { role: "user" | "assistant"; content: string; offer?: Offer; answered?: boolean };
type Reply = { text: string; handoff?: boolean; offer?: Offer; name?: string; waiting?: string; waitSec?: number };

/** With an offer the card asks "Want me to open that for you?", so her own closing "Want me to open…?" goes. */
const withoutAsk = (t: string) => t.replace(/\s*(?:Want|Would you like|Shall|Should) (?:me|I) (?:to )?(?:open|take|show)[^.?!]*\?\s*$/i, "").trim() || t;

const speakOn = () => { try { return localStorage.getItem(SPEAK) !== "0"; } catch { return true; } };

/** Her face: the avatar when there is one, else her initial in the same round slot (three sizes). */
function Face({ g, size = "h-8 w-8 text-sm" }: { g: { name: string; avatarUrl: string }; size?: string }) {
  return g.avatarUrl
    ? <img src={g.avatarUrl} alt="" className={`${size} shrink-0 rounded-full object-cover shadow-[0_0_0_2px_rgba(255,255,255,.35)]`} />
    : <span className={`${size} flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#0b2a5e] to-[#053877] font-extrabold text-[#F0A71F] shadow-[0_0_0_2px_rgba(255,255,255,.35)]`}>{g.name[0]}</span>;
}

/** Play her voice for one line. Only ever called after he has tapped the mic (or Hear a sample). */
async function say(text: string, el: { current: HTMLAudioElement | null }, onSpeaking?: (on: boolean) => void) {
  try {
    const r = await fetch("/api/guide/speak", { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ text }) });
    if (!r.ok) return;
    const url = URL.createObjectURL(await r.blob());
    el.current?.pause();
    const a = new Audio(url);
    el.current = a;
    a.onplay = () => onSpeaking?.(true);
    a.onended = a.onpause = () => { onSpeaking?.(false); URL.revokeObjectURL(url); };
    await a.play();
  } catch { onSpeaking?.(false); /* her words are on screen anyway */ }
}

export function LoriGuide({ g, compact = false }: { g: Extract<GuideMe, { enabled: true }>; compact?: boolean }) {
  const [location, navigate] = useLocation();
  const qc = useQueryClient();
  const inApp = location.startsWith("/host/dashboard");
  const [open, setOpen] = useState(false);
  const [showing, setShowing] = useState(false);
  const opener: Msg = { role: "assistant", content: `Hi, I'm ${g.name}, your AI guide. Ask me how to do anything here and I'll show you where to click.` };
  const [msgs, setMsgs] = useState<Msg[]>([opener]);
  const msgsRef = useRef(msgs);
  msgsRef.current = msgs;
  const [draft, setDraft] = useState("");
  const [heard, setHeard] = useState(false); // the box holds what she heard: check it, then Send
  const box = useRef<HTMLTextAreaElement>(null);
  // The box grows with what's in it, up to four lines.
  useEffect(() => { const el = box.current; if (el) { el.style.height = "auto"; el.style.height = `${Math.min(el.scrollHeight, 112)}px`; } }, [draft, open]);
  const [busy, setBusy] = useState(false);
  const [waiting, setWaiting] = useState<{ token: string; until: number } | null>(null);
  const [form, setForm] = useState<"" | "open" | "sent">("");
  const [voiceOn, setVoiceOn] = useState(false);
  const [rec, setRec] = useState<"" | "listening" | "hearing">("");
  const [speaking, setSpeaking] = useState(false);
  const recorder = useRef<MediaRecorder | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const scroller = useRef<HTMLDivElement>(null);

  // The same doors into Ask Alex open her: a link to #help, and any "ask" button on the site.
  useEffect(() => {
    if (window.location.hash === "#help") setOpen(true);
    // The dashboard's top box sends its question straight in (send: true); other doors just type it for him.
    const onAsk = (e: Event) => { const d = (e as CustomEvent<{ question?: string; send?: boolean }>).detail; const q = String(d?.question ?? "").trim(); setOpen(true); if (q && d?.send) void sendRef.current(q); else if (q) setDraft(q); };
    window.addEventListener("mv:ask-alex", onAsk);
    return () => window.removeEventListener("mv:ask-alex", onAsk);
  }, []);
  useEffect(() => { scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" }); }, [msgs, open, waiting, form]);

  const hear = (text: string) => { if (voiceOn && g.voice && speakOn()) void say(text, audio, setSpeaking); };
  const hush = () => { audio.current?.pause(); setSpeaking(false); };
  const add = (m: Msg) => { setMsgs((x) => [...x, m]); if (m.role === "assistant") hear(m.content); };

  const send = async (said?: string) => {
    const text = (said ?? draft).trim();
    if (!text || busy) return;
    const history = [...msgsRef.current, { role: "user" as const, content: text }];
    setMsgs(history); setDraft(""); setHeard(false); setBusy(true);
    try {
      const r = await fetch("/api/guide/chat", {
        method: "POST", credentials: "include", headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages: history.slice(1).map(({ role, content }) => ({ role, content })), page: location, canWait: true }),
      });
      const j = (await r.json().catch(() => ({}))) as Reply & { message?: string };
      if (!r.ok) throw new Error(j.message || "I couldn't answer that just now. Try again in a moment.");
      if (j.name) qc.setQueryData<GuideMe>(KEY, (o) => (o && o.enabled ? { ...o, name: j.name! } : o));
      if (j.waiting || j.handoff) {
        // She doesn't know (or it's money, legal, press, a complaint): the server's line, and the note form.
        // Never "checking with the team"; NOT_SURE only stands in if an old reply has no line of its own.
        add({ role: "assistant", content: j.handoff && j.text ? j.text : NOT_SURE });
        setForm("open");
        // If the question did go to the team and an answer comes back while the panel is open, it shows here.
        if (j.waiting) setWaiting({ token: j.waiting, until: Date.now() + ((j.waitSec ?? 300) + 30) * 1000 });
      } else add({ role: "assistant", content: j.offer ? withoutAsk(j.text) : j.text, offer: j.offer });
    } catch (e) {
      add({ role: "assistant", content: (e as Error).message || "I couldn't answer that just now. Try again in a moment." });
    } finally { setBusy(false); }
  };

  // A question that went to the team: look for an answer every 3 seconds, quietly (the form is already up).
  useEffect(() => {
    if (!waiting) return;
    let stop = false;
    const giveUp = () => setWaiting(null);
    const t = window.setInterval(async () => {
      if (stop) return;
      if (Date.now() > waiting.until) return giveUp();
      try {
        const r = await fetch(`/api/help/question/${encodeURIComponent(waiting.token)}`, { cache: "no-store" });
        if (!r.ok || stop) return;
        const q = (await r.json()) as { status: string; answer: string };
        if (q.status === "answered" && q.answer) { setWaiting(null); add({ role: "assistant", content: `Here's the answer: ${q.answer}` }); }
        else if (q.status === "timed_out") giveUp();
      } catch { /* next tick */ }
    }, 3000);
    return () => { stop = true; window.clearInterval(t); };
  }, [waiting]); // eslint-disable-line react-hooks/exhaustive-deps

  const sendRef = useRef(send);
  sendRef.current = send;

  /** "Yes, open it": go there, then point at each control. He makes every click. */
  const take = (m: Msg) => {
    const t = g.targets.find((x) => x.id === m.offer?.id);
    setMsgs((x) => x.map((y) => (y === m ? { ...y, answered: true } : y)));
    if (!t) return;
    setOpen(false);
    setShowing(true);
    if (location !== t.path) navigate(t.path);
    window.setTimeout(() => showGuide(t.steps, () => setShowing(false), { name: g.name, avatarUrl: g.avatarUrl }), 500);
  };
  const notNow = (m: Msg) => { setMsgs((x) => x.map((y) => (y === m ? { ...y, answered: true } : y))); add({ role: "assistant", content: "No problem. Ask me anything else." }); };

  /** The mic: tap to talk, tap again to send. Tapping it is also what turns her voice on. */
  const mic = async () => {
    if (rec === "listening") { recorder.current?.stop(); return; }
    if (rec) return;
    hush();
    setVoiceOn(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      const parts: Blob[] = [];
      mr.ondataavailable = (e) => { if (e.data.size) parts.push(e.data); };
      mr.onstop = async () => {
        stream.getTracks().forEach((x) => x.stop());
        setRec("hearing");
        try {
          const blob = new Blob(parts, { type: mr.mimeType || "audio/webm" });
          const r = await fetch("/api/guide/listen", { method: "POST", credentials: "include", headers: { "content-type": blob.type }, body: blob });
          const j = (await r.json().catch(() => ({}))) as { text?: string; message?: string };
          // What she heard goes into the box: a room can talk over him, so he checks it and presses Send.
          if (r.ok && j.text) { setDraft((d) => (d.trim() ? `${d.trim()} ${j.text}` : j.text!)); setHeard(true); window.setTimeout(() => { const el = box.current; if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); } }, 0); }
          else add({ role: "assistant", content: j.message || "I didn't catch that. Try again, or type it." });
        } finally { setRec(""); }
      };
      recorder.current = mr;
      mr.start();
      setRec("listening");
      const done = () => { if (mr.state === "recording") mr.stop(); };
      window.setTimeout(done, 30_000);
      // Pause detection: once he has spoken, ~1.5 s of quiet ends it.
      try {
        const ctx = new AudioContext();
        const an = ctx.createAnalyser();
        an.fftSize = 1024;
        ctx.createMediaStreamSource(stream).connect(an);
        const buf = new Float32Array(an.fftSize);
        let spoke = 0, quietSince = 0;
        const t = window.setInterval(() => {
          if (mr.state !== "recording") { window.clearInterval(t); void ctx.close(); return; }
          an.getFloatTimeDomainData(buf);
          let sum = 0;
          for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
          const loud = Math.sqrt(sum / buf.length) > 0.015;
          const now = Date.now();
          if (loud) { spoke += 100; quietSince = 0; }
          else if (spoke >= 300) { if (!quietSince) quietSince = now; else if (now - quietSince >= 1500) done(); }
        }, 100);
      } catch { /* no Web Audio: the red mic and the 30 s cap still end it */ }
    } catch {
      add({ role: "assistant", content: "I can't hear you yet. Allow the microphone for this site, or type your question." });
    }
  };

  const place = inApp ? "bottom-[calc(4.75rem+env(safe-area-inset-bottom))] lg:bottom-5" : "bottom-5";
  const stop = () => { hideGuide(); setShowing(false); };

  return (
    <>
      {!open && (showing ? (
        <button type="button" onClick={stop} className={`fixed right-4 z-[61] inline-flex items-center gap-2 rounded-full bg-[#053877] py-1.5 pl-1.5 pr-4 text-sm font-semibold text-white shadow-lg lg:right-5 ${place}`} data-testid="lori-stop-pill">
          <Face g={g} /><span className="whitespace-nowrap">{g.name} is showing you · Stop</span>
        </button>
      ) : (
        <button type="button" onClick={() => setOpen(true)} className={`fixed right-4 z-50 inline-flex items-center gap-2 rounded-full bg-[#053877] text-sm font-semibold text-white shadow-lg transition-transform hover:scale-[1.03] lg:right-5 ${compact ? "lg:p-1.5" : "lg:px-4 lg:py-3"} ${inApp ? "bottom-[calc(4.75rem+env(safe-area-inset-bottom))] p-1.5 lg:bottom-5" : compact ? "bottom-5 p-1.5" : "bottom-5 px-4 py-3"}`} aria-label={`Ask ${g.name}`} data-testid="lori-button">
          <Face g={g} size={`h-8 w-8 ${inApp ? (compact ? "" : "lg:-ml-1.5") : compact ? "" : "-ml-1.5"}`} />
          {/* Always labelled AI guide, never a person (mockup 21 Nov). */}
          <span className={`whitespace-nowrap text-left leading-tight ${compact ? "sr-only" : inApp ? "hidden lg:block" : "block"}`}>Ask {g.name}<span className="block text-[10px] font-semibold uppercase tracking-wide text-white/75">AI guide</span></span>
        </button>
      ))}

      {open && (
        <div className={`fixed inset-0 z-[60] flex flex-col overflow-hidden bg-white text-[#101828] sm:inset-auto sm:right-5 sm:w-[380px] sm:rounded-2xl sm:border sm:border-[#e4e7ec] sm:shadow-2xl ${inApp ? "sm:bottom-[calc(4.75rem+env(safe-area-inset-bottom))] sm:h-[min(600px,calc(100dvh-7rem))] lg:bottom-5 lg:h-[min(600px,calc(100vh-40px))]" : "sm:bottom-5 sm:h-[min(600px,calc(100vh-40px))]"}`} role="dialog" aria-label={`${g.name}, your AI guide`} data-testid="lori-panel">
          <div className="flex items-center justify-between bg-[#053877] px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] text-white">
            <div className="flex min-w-0 items-center gap-3">
              <Face g={g} size={`h-10 w-10 text-base ${speaking ? "ring-4 ring-[#F0A71F]/60" : ""}`} />
              <div className="min-w-0"><p className="text-sm font-semibold">{g.name} · AI guide</p><p className="truncate text-[11px] text-white/80">{rec === "listening" ? "Listening… stops when you pause" : rec === "hearing" ? "Getting that…" : speaking ? "Speaking" : busy ? "Thinking…" : "Shows you where to click. You make every click."}</p></div>
            </div>
            <button type="button" onClick={() => { hush(); setOpen(false); }} className="rounded-full p-1.5 hover:bg-white/10" aria-label="Close"><X className="h-4 w-4" /></button>
          </div>

          <div ref={scroller} className="flex-1 space-y-3 overflow-y-auto px-4 py-4 text-sm leading-relaxed">
            {msgs.map((m, i) => (
              <div key={i}>
                {m.role === "user"
                  ? <div className="flex justify-end"><p className="max-w-[85%] whitespace-pre-wrap rounded-2xl bg-[#053877] px-3.5 py-2.5 text-white">{m.content}</p></div>
                  : <div className="flex items-end gap-2"><Face g={g} size="h-6 w-6 text-[11px]" /><p className="max-w-[85%] whitespace-pre-wrap rounded-2xl bg-[#f2f4f7] px-3.5 py-2.5">{m.content}</p></div>}
                {m.offer && !m.answered && (
                  <div className="ml-8 mt-3 rounded-2xl border border-[#053877]/25 bg-[#f5f8fd] p-3.5" data-testid="lori-offer">
                    <p className="text-[14px] font-semibold text-[#0b1f4a]">Want me to open that for you?</p>
                    <p className="mt-0.5 text-xs text-[#667085]">I'll take you there and point at each step.</p>
                    <div className="mt-3 flex gap-2">
                      <button type="button" onClick={() => take(m)} className="h-9 rounded-full bg-[#053877] px-4 text-[13px] font-bold text-white" data-testid="lori-offer-yes">Yes, open it</button>
                      <button type="button" onClick={() => notNow(m)} className="h-9 rounded-full px-3 text-[13px] font-semibold text-[#475467] hover:bg-white" data-testid="lori-offer-no">Not now</button>
                    </div>
                  </div>
                )}
              </div>
            ))}
            {busy && (
              <div className="flex items-center gap-2"><Face g={g} size="h-6 w-6 text-[11px]" /><span className="flex items-center gap-1.5 rounded-2xl bg-[#f2f4f7] px-3.5 py-2.5 text-[13px] font-semibold text-[#475467]"><Loader2 className="h-3.5 w-3.5 animate-spin" />Thinking…</span></div>
            )}
            {form && <TeamForm sent={form === "sent"} transcript={msgs} page={location} onSent={() => setForm("sent")} />}
          </div>

          <form onSubmit={(e) => { e.preventDefault(); void send(); }} className="border-t border-[#e4e7ec] p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
            {speaking && (
              <button type="button" onClick={hush} className="mb-2 flex h-9 w-full items-center justify-center gap-1.5 rounded-full border border-[#d0d5dd] text-[13px] font-semibold" data-testid="lori-hush"><Square className="h-3 w-3 fill-current" /> Stop talking</button>
            )}
            <div className="flex items-end gap-2">
              {g.voice && (
                <button type="button" onClick={() => void mic()} aria-label={rec === "listening" ? "Stop listening and send" : `Talk to ${g.name}`} aria-pressed={rec === "listening"} className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${rec === "listening" ? "bg-[#d92d20] text-white ring-4 ring-[#d92d20]/15" : "border border-[#d0d5dd] text-[#475467] hover:bg-[#f2f4f7]"}`} data-testid="lori-mic">
                  {rec === "hearing" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mic className="h-4 w-4" />}
                </button>
              )}
              <textarea ref={box} rows={1} value={draft} onChange={(e) => { setDraft(e.target.value); if (!e.target.value.trim()) setHeard(false); }} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(); } }} placeholder={`Ask ${g.name} how to do something…`} className={`block min-h-10 min-w-0 flex-1 resize-none rounded-xl border bg-white px-3 py-[9px] text-sm leading-5 outline-none focus:border-[#053877] ${heard ? "border-[#053877]" : "border-[#d0d5dd]"}`} aria-label={`Ask ${g.name}`} data-testid="lori-input" />
              <button type="submit" disabled={!draft.trim() || busy} aria-label="Send" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#053877] text-white disabled:opacity-40" data-testid="lori-send"><Send className="h-4 w-4" /></button>
            </div>
            <p className={`mt-2 text-[11px] ${heard ? "font-semibold text-[#053877]" : "text-[#98a2b3]"}`} data-testid="lori-hint">{heard ? "Check what I heard, then press Send." : `${g.name} is AI.${g.voice ? " Tap the mic to talk out loud." : ""}`}</p>
          </form>
        </div>
      )}
      {/* The dashboard has its own pointer layer; anywhere else (the studio) she brings one. */}
      {!inApp && <GuideLayer />}
    </>
  );
}

/** When she can't answer: leave a note, and someone replies by email. */
function TeamForm({ sent, transcript, page, onSent }: { sent: boolean; transcript: Msg[]; page: string; onSent: () => void }) {
  const siteKey = useTurnstileSiteKey();
  const last = [...transcript].reverse().find((m) => m.role === "user")?.content ?? "";
  // She only shows for signed-in accounts: reply to the account's own address (the dashboard already has it),
  // shown as a line he can change. Off the dashboard with nothing loaded yet, the field shows instead.
  const acct = useQueryClient().getQueryData<{ email?: string }>(["/api/host/dashboard"])?.email?.trim() ?? "";
  const [email, setEmail] = useState(acct);
  const [editEmail, setEditEmail] = useState(!acct);
  const [question, setQuestion] = useState(last);
  const [human, setHuman] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  if (sent) return <p className="flex items-center gap-2 rounded-2xl bg-white p-3 text-[14px] font-semibold text-[#067647] shadow-sm"><Check className="h-4 w-4" /> Sent. Someone will get back to you as soon as possible.</p>;
  const submit = async () => {
    setBusy(true); setErr("");
    try {
      const r = await fetch("/api/help/handoff", { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "", email, question, page, turnstileToken: human, transcript: transcript.map((m) => `${m.role === "user" ? "Visitor" : "Guide"}: ${m.content}`).join("\n") }) });
      if (!r.ok) throw new Error(((await r.json().catch(() => ({}))) as { message?: string }).message || "That didn't send. Try again.");
      onSent();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <form onSubmit={(e) => { e.preventDefault(); void submit(); }} className="space-y-2 rounded-2xl bg-white p-3 shadow-sm" data-testid="lori-team-form">
      <p className="text-[13px] font-semibold">Leave a note</p>
      {editEmail
        ? <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" className="h-9 w-full rounded-lg border border-[#d0d5dd] px-3 text-[14px]" aria-label="Your email" autoFocus={!!acct} />
        : <p className="flex min-w-0 items-center gap-1 text-[13px] text-[#475467]" data-testid="lori-reply-to"><span className="truncate">We'll reply to <span className="font-semibold text-[#101828]">{email}</span></span><button type="button" onClick={() => setEditEmail(true)} className="shrink-0 font-semibold text-[#053877] hover:underline">Change</button></p>}
      <textarea required value={question} onChange={(e) => setQuestion(e.target.value)} rows={3} className="w-full rounded-lg border border-[#d0d5dd] px-3 py-2 text-[14px]" aria-label="Your question" />
      {siteKey && <Turnstile siteKey={siteKey} onToken={setHuman} resetSignal={0} />}
      {err && <p className="text-xs text-[#b42318]">{err}</p>}
      <button type="submit" disabled={busy || !email.includes("@") || !question.trim() || (!!siteKey && !human)} className="h-9 rounded-full bg-[#053877] px-4 text-[13px] font-bold text-white disabled:opacity-40">{busy ? "Sending…" : "Send"}</button>
    </form>
  );
}

/* ── Settings → Your guide ── */

const SETTINGS = "mv:guide-settings";

/** In the account menu, only when the account has a guide. */
export function GuideMenuItem() {
  const g = useGuide();
  if (!guidePickable(g)) return null;
  return <DropdownMenuItem onSelect={() => window.dispatchEvent(new Event(SETTINGS))} className="gap-2" data-testid="account-guide"><Sparkles className="h-4 w-4" /> Your guide</DropdownMenuItem>;
}

/**
 * Settings → Your guide: pick a face and voice, switch it on or off, rename it, and speak its answers
 * (mockup approved 21 Nov 2026). Opens from the account menu; rendered once, by HelpChat.
 */
export function GuideSettingsRoot() {
  const g = useGuide();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [speak, setSpeak] = useState(speakOn);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const { save, busy: saving, err } = useSaveGuide();
  const current: GuideId = g?.enabled ? ((guideById(g.guideId ?? "")?.id) ?? GUIDES.find((x) => x.name === g.name)?.id ?? DEFAULT_GUIDE) : DEFAULT_GUIDE;
  const [pick, setPick] = useState<GuideId>(current);
  useEffect(() => {
    const on = () => { setName(g?.enabled ? g.name : ""); setPick(current); setMsg(""); setOpen(true); };
    window.addEventListener(SETTINGS, on);
    return () => window.removeEventListener(SETTINGS, on);
  }, [g, current]);
  if (!open || !guidePickable(g)) return null;
  const on = !!g?.enabled;
  const rename = async () => {
    setBusy(true); setMsg("");
    try {
      const r = await fetch("/api/guide/me", { method: "PUT", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: name.trim() }) });
      const j = (await r.json().catch(() => ({}))) as { name?: string; message?: string };
      if (!r.ok || !j.name) throw new Error(j.message || "That didn't save. Try again.");
      qc.setQueryData<GuideMe>(KEY, (o) => (o && o.enabled ? { ...o, name: j.name! } : o));
      setMsg("Saved.");
    } catch (e) { setMsg((e as Error).message); } finally { setBusy(false); }
  };
  // A pick saves at once (and switches it on); its name is the new guide's.
  const choose = async (id: GuideId) => { setPick(id); if (await save({ guideId: id })) { setName(guideById(id)!.name); setMsg(""); } };
  const toggleSpeak = () => { const v = !speak; setSpeak(v); try { localStorage.setItem(SPEAK, v ? "1" : "0"); } catch { /* private window */ } };
  const who = on && g?.enabled ? g.name : guideById(pick)!.name;
  // The faces show once the server knows picks (it sends guideId); before that, Settings is name and voice as it was.
  const picking = g?.enabled ? g.guideId !== undefined : !!g?.canPick;
  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-[rgba(16,24,40,0.5)] p-0 sm:items-center sm:p-4" onClick={() => setOpen(false)}>
      <div role="dialog" aria-modal="true" aria-label="Your guide" className="max-h-[92dvh] w-full max-w-[640px] overflow-y-auto rounded-t-2xl bg-white p-5 text-[#101828] shadow-2xl sm:rounded-2xl sm:p-6" onClick={(e) => e.stopPropagation()} data-testid="guide-settings">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-lg font-bold">Your guide <span className="ml-1 rounded-full bg-[#eef2fa] px-1.5 py-0.5 align-[2px] text-[10px] font-bold uppercase tracking-wide text-[#053877]">AI guide</span></p>
            <p className="mt-0.5 text-[13px] text-[#667085]">Shows you around and points to the right place. It never pays, posts, sends or deletes for you.</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {picking && <button type="button" role="switch" aria-checked={on} aria-label="Guide on" disabled={saving} onClick={() => void save(on ? { enabled: false } : { guideId: pick })} className={`relative h-6 w-11 rounded-full transition-colors ${on ? "bg-[#053877]" : "bg-[#d0d5dd]"}`} data-testid="guide-switch"><span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-[left] ${on ? "left-[22px]" : "left-0.5"}`} /></button>}
            <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="rounded-full p-1 text-[#667085] hover:bg-[#f2f4f7]"><X className="h-4 w-4" /></button>
          </div>
        </div>
        {picking && <><div className={`mt-4 ${on ? "" : "opacity-60"}`}><GuidePicker small value={pick} onChange={(id) => void choose(id)} /></div>
        <p className="mt-2 text-[13px] text-[#667085]">{saving ? "Saving…" : err ? <span className="text-[#b42318]">{err}</span> : on ? `Saved as soon as you pick.` : "Pick one to switch your guide on. While it's off, the site's own Ask Alex answers."}</p></>}
        {on && g?.enabled && (
          <>
            <label className="mt-5 block text-sm font-semibold" htmlFor="guide-name">Name</label>
            <div className="mt-1.5 flex gap-2">
              <input id="guide-name" value={name} onChange={(e) => setName(e.target.value.slice(0, 24))} className="h-11 min-w-0 flex-1 rounded-xl border border-[#d0d5dd] px-3.5 text-[15px] outline-none focus:border-[#053877]" data-testid="guide-name" />
              <button type="button" onClick={() => void rename()} disabled={busy || !name.trim() || name.trim() === g.name} className="h-11 rounded-xl bg-[#053877] px-4 text-sm font-bold text-white disabled:opacity-40">{busy ? "Saving…" : "Save"}</button>
            </div>
            {msg && <p className="mt-1.5 text-[13px] text-[#475467]">{msg}</p>}
            {g.voice && (
              <div className="mt-5 flex items-start justify-between gap-4">
                <div><p className="text-sm font-semibold">Speak answers out loud</p><p className="text-[13px] text-[#667085]">Only after you tap the mic. The words are always on screen too.</p></div>
                <button type="button" role="switch" aria-checked={speak} onClick={toggleSpeak} className={`relative mt-0.5 h-6 w-11 shrink-0 rounded-full ${speak ? "bg-[#053877]" : "bg-[#d0d5dd]"}`}><span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-[left] ${speak ? "left-[22px]" : "left-0.5"}`} /></button>
              </div>
            )}
          </>
        )}
        <div className="mt-5 rounded-xl bg-[#f9fafb] p-3.5 text-[13px] leading-relaxed text-[#475467]">
          {who} is an AI guide. It shows you where to click; it can't pay, send, post, delete or change settings, and you make every click.
        </div>
      </div>
    </div>
  );
}
