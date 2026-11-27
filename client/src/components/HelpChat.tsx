import { useHelpHiddenOnPhone } from "@/lib/helpPlacement";
import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { AnswerActions, AnswerBody, type HelpAction } from "@/components/AlexAnswer";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { apiRequest } from "@/lib/queryClient";
import { Turnstile, useTurnstileSiteKey } from "@/components/Turnstile";
import { GuideSettingsRoot, LoriGuide, useGuide } from "@/components/LoriGuide";
import { X, Send, User, Check, Loader2 } from "lucide-react";

// The help bubble. Ask a question, get an answer from what we know about the
// site. When Alex isn't sure she checks with the team live (20 Nov): the chat
// waits up to 5 minutes for their answer, then offers the email form. "Email
// the team" hands the whole thing over by email at any point. Hidden on the studio and admin surfaces, where it would only be in
// the way.

type Msg = { role: "user" | "assistant"; content: string; actions?: HelpAction[] };


// Andrew, 20 Nov 2026: Ask Alex on the whole site for now (booths, Radio, show pages and podcasters' own pages
// included), until there's a permanent placement. Still never on a page the recorder films (it would be on air
// or in the recording: /dx/program, /studio/composite, /room/composite, the /promo renders), and not on /admin,
// which has its own Ask Alex button (AdminChatDock) in the same corner. A screen can also ask for it to be hidden on a
// phone only (useHideHelpOnPhone, lib/helpPlacement): My Studio's camera check, where it sat on Enter studio (PM, 27 Nov).
const HIDDEN_ON = ["/promo", "/studio/composite", "/room/composite", "/dx/", "/admin"];

const OPENER: Msg = {
  role: "assistant",
  content: "Hi, I'm Alex. Ask me anything about MilitaryVoices.ai. If I'm not sure, I'll check with the team.",
};

/** An account with its own AI guide (GET /api/guide/me enabled) gets her in Alex's place; everyone else keeps Alex. */
export function HelpChat() {
  // Settings → Your guide lives here, once, wherever the account menu opens it.
  return <><HelpChat_ /><GuideSettingsRoot /></>;
}

function HelpChat_() {
  const [location] = useLocation();
  const g = useGuide();
  // Off at phone width while a screen asks (display: contents keeps the page's layout as it was).
  const phoneOff = useHelpHiddenOnPhone();
  const wrap = phoneOff ? "hidden lg:contents" : "contents";
  if (g?.enabled) {
    if (HIDDEN_ON.some((p) => location.startsWith(p))) return null;
    return <div className={wrap}><LoriGuide g={g} compact={/^\/host\/dashboard\/(postify|page)\b/.test(location) || location.startsWith("/black-friday")} /></div>;
  }
  return <div className={wrap}><AlexChat /></div>;
}

function AlexChat() {
  const [location] = useLocation();
  // The podcaster's dashboard has a tab bar at the bottom on a phone.
  const inApp = location.startsWith("/host/dashboard");
  // On the editing screens (Pōstify, the SmartLink builder) just Alex's face, on a computer too: the
  // full "Ask Alex" pill sat on the timeline and the phone preview (8 Oct).
  const compact = /^\/host\/dashboard\/(postify|page)\b/.test(location) || location.startsWith("/black-friday");
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([OPENER]);
  const [draft, setDraft] = useState("");
  const [mode, setMode] = useState<"chat" | "human" | "sent">("chat");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [question, setQuestion] = useState("");
  const [human, setHuman] = useState<string | null>(null);
  // Alex is checking with the team: the question's token, and when to stop waiting.
  const [waiting, setWaiting] = useState<{ token: string; until: number } | null>(null);
  const [humanReset, setHumanReset] = useState(0);
  const siteKey = useTurnstileSiteKey();
  const scroller = useRef<HTMLDivElement>(null);

  const { data: cfg } = useQuery<{ agent: boolean }>({ queryKey: ["/api/help/config"], staleTime: Infinity, retry: false });

  // A link can open her: the acknowledgement email points at /#help. So can
  // any button on the site, with a question already typed.
  useEffect(() => {
    if (window.location.hash === "#help") setOpen(true);
    const onAsk = (e: Event) => {
      const d = (e as CustomEvent<{ question?: string; send?: boolean }>).detail;
      const q = String(d?.question ?? "");
      setOpen(true);
      setMode("chat");
      if (q && d?.send) setPendingAsk(q);
      else if (q) setDraft(q);
    };
    window.addEventListener("mv:ask-alex", onAsk);
    return () => window.removeEventListener("mv:ask-alex", onAsk);
  }, []);
  // A question asked somewhere else (the dashboard's ask box) goes straight in, not just into the box.
  const [pendingAsk, setPendingAsk] = useState("");
  useEffect(() => {
    if (!pendingAsk) return;
    send(pendingAsk);
    setPendingAsk("");
  }, [pendingAsk]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [msgs, mode, open]);

  const ask = useMutation({
    mutationFn: async (history: Msg[]) =>
      (await apiRequest("POST", "/api/help/chat", { messages: history, page: location, canWait: true })).json() as Promise<{ text: string; handoff: boolean; waiting?: string; waitSec?: number; actions?: HelpAction[] }>,
    onSuccess: (r) => {
      setMsgs((m) => [...m, { role: "assistant", content: r.text, ...(r.actions?.length ? { actions: r.actions } : {}) }]);
      if (r.waiting) setWaiting({ token: r.waiting, until: Date.now() + ((r.waitSec ?? 300) + 30) * 1000 });
      else if (r.handoff) {
        // Carry their last question into the form so they don't retype it.
        const last = [...msgs].reverse().find((x) => x.role === "user");
        setQuestion(last?.content ?? "");
        setMode("human");
      }
    },
    onError: (e: Error) => setMsgs((m) => [...m, { role: "assistant", content: e.message || "Something went wrong. Want someone to get back to you instead?" }]),
  });

  // While Alex checks with the team: ask every 3 seconds. The first answer shows here; no answer in
  // 5 minutes and the email form comes up with their question in it.
  useEffect(() => {
    if (!waiting) return;
    let stop = false;
    const giveUp = (mail?: string) => {
      setWaiting(null);
      setMsgs((m) => [...m, { role: "assistant", content: "Someone will get back to you as soon as possible. Leave your email and we'll write back." }]);
      const last = [...msgs].reverse().find((x) => x.role === "user");
      setQuestion(last?.content ?? "");
      if (mail) setEmail((e) => e || mail);
      setMode("human");
    };
    const tick = async () => {
      if (stop) return;
      if (Date.now() > waiting.until) return giveUp();
      try {
        const r = await fetch(`/api/help/question/${encodeURIComponent(waiting.token)}`, { cache: "no-store" });
        if (stop) return;
        if (r.ok) {
          const q = (await r.json()) as { status: string; answer: string; email?: string };
          if (q.status === "answered" && q.answer) {
            setWaiting(null);
            setMsgs((m) => [...m, { role: "assistant", content: `Here's what the team says: ${q.answer}` }]);
            return;
          }
          if (q.status === "timed_out") return giveUp(q.email);
        }
      } catch {
        /* try again on the next tick */
      }
    };
    const t = setInterval(tick, 3000);
    return () => { stop = true; clearInterval(t); };
  }, [waiting]); // eslint-disable-line react-hooks/exhaustive-deps

  const handoff = useMutation({
    mutationFn: async () =>
      (
        await apiRequest("POST", "/api/help/handoff", {
          name,
          email,
          question,
          transcript: msgs.map((m) => `${m.role === "user" ? "Visitor" : "Assistant"}: ${m.content}`).join("\n"),
          page: location,
          turnstileToken: human,
        })
      ).json(),
    onSuccess: () => setMode("sent"),
    onSettled: () => setHumanReset((n) => n + 1),
  });

  if (HIDDEN_ON.some((p) => location.startsWith(p))) return null;

  function send(said?: string) {
    const text = (said ?? draft).trim();
    if (!text || ask.isPending || waiting) return;
    const next = [...msgs, { role: "user" as const, content: text }];
    setMsgs(next);
    setDraft("");
    ask.mutate(next.filter((m) => m !== OPENER));
  }

  function wantHuman() {
    const last = [...msgs].reverse().find((x) => x.role === "user");
    setQuestion((q) => q || last?.content || draft.trim());
    setMode("human");
  }

  return (
    <>
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className={`fixed right-4 z-50 inline-flex items-center gap-2 rounded-full bg-[#053877] text-sm font-semibold text-white shadow-lg transition-transform hover:scale-[1.03] lg:right-5 ${compact ? "lg:p-1.5" : "lg:px-4 lg:py-3"} ${inApp ? "bottom-[calc(4.75rem+env(safe-area-inset-bottom))] p-1.5 lg:bottom-5" : compact ? "bottom-5 p-1.5" : "bottom-5 px-4 py-3"}`}
          aria-label="Open help"
          data-testid="button-help-open"
        >
          <img src="/alex.jpg" alt="" className={`h-8 w-8 rounded-full object-cover ring-2 ring-white/30 ${inApp ? (compact ? "" : "lg:-ml-1.5") : compact ? "" : "-ml-1.5"}`} />
          {/* On the phone's dashboard: just Alex's face, above the tab bar. */}
          <span className={compact ? "sr-only" : inApp ? "hidden lg:inline" : ""}>Ask Alex</span>
        </button>
      )}

      {open && (
        <div
          // In the app on a phone it sits above the tab bar, which it used to cover (8 Oct).
          className={`fixed right-5 z-50 flex w-[min(380px,calc(100vw-40px))] flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl ${inApp ? "bottom-[calc(4.75rem+env(safe-area-inset-bottom))] h-[min(600px,calc(100dvh-7rem))] lg:bottom-5 lg:h-[min(600px,calc(100vh-40px))]" : "bottom-5 h-[min(600px,calc(100vh-40px))]"}`}
          role="dialog"
          aria-label="Help"
          data-testid="panel-help"
        >
          <div className="flex items-center justify-between bg-[#053877] px-4 py-3 text-white">
            <div className="flex items-center gap-3">
              <img src="/alex.jpg" alt="Alex" className="h-10 w-10 rounded-full object-cover ring-2 ring-white/30" />
              <div>
                <p className="text-sm font-semibold">Alex · SI help desk</p>
                <p className="text-[11px] text-white/80">{cfg?.agent === false ? "We'll get back to you by email" : "Answers now · checks with the team when unsure"}</p>
              </div>
            </div>
            <button type="button" onClick={() => setOpen(false)} className="rounded-full p-1 hover:bg-white/10" aria-label="Close help" data-testid="button-help-close">
              <X className="h-4 w-4" />
            </button>
          </div>

          {mode === "chat" && (
            <>
              <div ref={scroller} className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
                {msgs.map((m, i) => (
                  <div key={i} className={`flex items-end gap-2 ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                    {m.role === "assistant" && <img src="/alex.jpg" alt="" className="h-6 w-6 shrink-0 rounded-full object-cover" />}
                    <div
                      className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${
                        m.role === "user" ? "whitespace-pre-line bg-[#053877] text-white" : "bg-muted text-foreground"
                      }`}
                    >
                      {m.role === "assistant" ? (
                        <>
                          <AnswerBody text={m.content} />
                          <AnswerActions actions={m.actions} onGo={() => setOpen(false)} />
                        </>
                      ) : m.content}
                    </div>
                  </div>
                ))}
                {/* Something to tap on the way in (8 Oct): the questions people actually ask first. */}
                {msgs.length === 1 && !ask.isPending && (
                  <div className="flex flex-wrap gap-2 pl-8" data-testid="help-starters">
                    {["How do I get my podcast on Spotify and Apple?", "How do I make clips from an episode?", "Where are my Marathon recording and clips?", "How do I connect Zoom?"].map((q) => (
                      <button key={q} type="button" onClick={() => send(q)} className="rounded-full border border-[#053877]/30 bg-[#053877]/[0.05] px-3 py-1.5 text-left text-xs font-medium text-[#053877] hover:bg-[#053877]/10 dark:border-[#8ab4f8]/30 dark:text-[#8ab4f8]">{q}</button>
                    ))}
                  </div>
                )}
                {ask.isPending && (
                  <div className="flex justify-start">
                    <div className="rounded-2xl bg-muted px-3.5 py-2.5 text-sm text-muted-foreground">
                      <Loader2 className="inline h-3.5 w-3.5 animate-spin" /> thinking…
                    </div>
                  </div>
                )}
                {waiting && (
                  <div className="flex justify-start pl-8" data-testid="help-waiting">
                    <div className="rounded-2xl bg-muted px-3.5 py-2.5 text-sm text-muted-foreground">
                      <Loader2 className="inline h-3.5 w-3.5 animate-spin" /> Checking with the team…
                    </div>
                  </div>
                )}
              </div>
              <div className="border-t border-border p-3">
                <form
                  className="flex items-end gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    send();
                  }}
                >
                  <Textarea
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        send();
                      }
                    }}
                    rows={1}
                    placeholder="Ask a question…"
                    className="min-h-[40px] resize-none text-sm"
                    data-testid="input-help-question"
                  />
                  <Button type="submit" size="icon" className="h-10 w-10 shrink-0 rounded-full" disabled={!draft.trim() || ask.isPending || !!waiting} aria-label="Send" data-testid="button-help-send">
                    <Send className="h-4 w-4" />
                  </Button>
                </form>
                <button type="button" onClick={wantHuman} className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline" data-testid="button-help-human">
                  <User className="h-3.5 w-3.5" /> Have someone get back to me
                </button>
              </div>
            </>
          )}

          {mode === "human" && (
            <form
              className="flex flex-1 flex-col gap-3 overflow-y-auto px-4 py-4"
              onSubmit={(e) => {
                e.preventDefault();
                if (email.includes("@") && question.trim() && (!siteKey || human)) handoff.mutate();
              }}
            >
              <div>
                <p className="text-sm font-semibold text-foreground">Leave your question with us</p>
                <p className="text-xs text-muted-foreground">Someone will get back to you as soon as possible.</p>
              </div>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" data-testid="input-help-name" />
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" required data-testid="input-help-email" />
              <Textarea value={question} onChange={(e) => setQuestion(e.target.value)} rows={4} placeholder="What can we help with?" required data-testid="input-help-message" />
              {siteKey && <Turnstile siteKey={siteKey} onToken={setHuman} resetSignal={humanReset} />}
              {handoff.isError && <p className="text-xs text-destructive">{(handoff.error as Error).message}</p>}
              <div className="mt-auto flex items-center gap-2">
                <Button type="submit" className="gap-1.5 rounded-full" disabled={handoff.isPending || !email.includes("@") || !question.trim() || (Boolean(siteKey) && !human)} data-testid="button-help-submit">
                  {handoff.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Send
                </Button>
                <Button type="button" variant="ghost" size="sm" onClick={() => setMode("chat")}>
                  Back
                </Button>
              </div>
            </form>
          )}

          {mode === "sent" && (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-700">
                <Check className="h-6 w-6" />
              </span>
              <p className="text-sm font-semibold text-foreground">Sent. Someone will get back to you as soon as possible.</p>
              <p className="text-xs text-muted-foreground">We'll reply to {email}. You can close this.</p>
              <Button type="button" variant="outline" size="sm" className="rounded-full" onClick={() => { setMode("chat"); setOpen(false); }}>
                Done
              </Button>
            </div>
          )}
        </div>
      )}
    </>
  );
}
