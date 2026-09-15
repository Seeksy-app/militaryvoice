import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { apiRequest } from "@/lib/queryClient";
import { Turnstile, useTurnstileSiteKey } from "@/components/Turnstile";
import { MessageCircle, X, Send, User, Check, Loader2 } from "lucide-react";

// The help bubble. Ask a question, get an answer from what we know about the
// site; at any point "Talk to a human" hands the whole thing to a person by
// email. Hidden on the studio and admin surfaces, where it would only be in
// the way.

type Msg = { role: "user" | "assistant"; content: string };

// Site paths and full URLs in an answer become links. The assistant is told to
// name pages as paths ("/schedule"), so this is what makes them tappable.
const LINK_RE = /(https?:\/\/[^\s)]+|(?<![\w/])\/(?:schedule|agenda|prepare|faq|platform|about|sponsors|host\/dashboard|studio|watch|s\/\d+|event\/[\w-]+(?:\/[\w-]+)?)(?![\w/-]))/g;

function linkify(text: string) {
  const out: React.ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(LINK_RE)) {
    const start = m.index ?? 0;
    const raw = m[0];
    // Trailing punctuation belongs to the sentence, not the link.
    const trimmed = raw.replace(/[.,;:!?]+$/, "");
    const trail = raw.slice(trimmed.length);
    if (start > last) out.push(text.slice(last, start));
    const cls = "font-medium underline underline-offset-2 text-primary hover:opacity-80";
    if (/^https?:\/\//.test(trimmed)) {
      let internal = false;
      try {
        internal = new URL(trimmed).host.replace(/^www\./, "") === window.location.host.replace(/^www\./, "");
      } catch {
        /* leave external */
      }
      out.push(
        internal ? (
          <Link key={start} href={new URL(trimmed).pathname + new URL(trimmed).search} className={cls}>{trimmed}</Link>
        ) : (
          <a key={start} href={trimmed} target="_blank" rel="noopener noreferrer" className={cls}>{trimmed}</a>
        ),
      );
    } else {
      out.push(<Link key={start} href={trimmed} className={cls}>{trimmed}</Link>);
    }
    if (trail) out.push(trail);
    last = start + raw.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const HIDDEN_ON = ["/studio", "/watch", "/admin"];

const OPENER: Msg = {
  role: "assistant",
  content: "Hi — ask me anything about the Podcastathon: claiming a slot, how show day works, reminders. If I can't help, I'll get you to a person.",
};

export function HelpChat() {
  const [location] = useLocation();
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([OPENER]);
  const [draft, setDraft] = useState("");
  const [mode, setMode] = useState<"chat" | "human" | "sent">("chat");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [question, setQuestion] = useState("");
  const [human, setHuman] = useState<string | null>(null);
  const [humanReset, setHumanReset] = useState(0);
  const siteKey = useTurnstileSiteKey();
  const scroller = useRef<HTMLDivElement>(null);

  const { data: cfg } = useQuery<{ agent: boolean }>({ queryKey: ["/api/help/config"], staleTime: Infinity, retry: false });

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [msgs, mode, open]);

  const ask = useMutation({
    mutationFn: async (history: Msg[]) =>
      (await apiRequest("POST", "/api/help/chat", { messages: history, page: location })).json() as Promise<{ text: string; handoff: boolean }>,
    onSuccess: (r) => {
      setMsgs((m) => [...m, { role: "assistant", content: r.text }]);
      if (r.handoff) {
        // Carry their last question into the form so they don't retype it.
        const last = [...msgs].reverse().find((x) => x.role === "user");
        setQuestion(last?.content ?? "");
        setMode("human");
      }
    },
    onError: (e: Error) => setMsgs((m) => [...m, { role: "assistant", content: e.message || "Something went wrong. Want a person instead?" }]),
  });

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

  function send() {
    const text = draft.trim();
    if (!text || ask.isPending) return;
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
          className="fixed bottom-5 right-5 z-50 inline-flex items-center gap-2 rounded-full bg-[#053877] px-4 py-3 text-sm font-semibold text-white shadow-lg transition-transform hover:scale-[1.03]"
          aria-label="Open help"
          data-testid="button-help-open"
        >
          <MessageCircle className="h-5 w-5" /> Help
        </button>
      )}

      {open && (
        <div
          className="fixed bottom-5 right-5 z-50 flex h-[min(600px,calc(100vh-40px))] w-[min(380px,calc(100vw-40px))] flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl"
          role="dialog"
          aria-label="Help"
          data-testid="panel-help"
        >
          <div className="flex items-center justify-between bg-[#053877] px-4 py-3 text-white">
            <div>
              <p className="text-sm font-semibold">MilitaryVoice.ai help</p>
              <p className="text-[11px] text-white/80">{cfg?.agent === false ? "A person will reply by email" : "Answers now · a person if you need one"}</p>
            </div>
            <button type="button" onClick={() => setOpen(false)} className="rounded-full p-1 hover:bg-white/10" aria-label="Close help" data-testid="button-help-close">
              <X className="h-4 w-4" />
            </button>
          </div>

          {mode === "chat" && (
            <>
              <div ref={scroller} className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
                {msgs.map((m, i) => (
                  <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                    <div
                      className={`max-w-[85%] whitespace-pre-line rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${
                        m.role === "user" ? "bg-[#053877] text-white" : "bg-muted text-foreground"
                      }`}
                    >
                      {m.role === "assistant" ? linkify(m.content) : m.content}
                    </div>
                  </div>
                ))}
                {ask.isPending && (
                  <div className="flex justify-start">
                    <div className="rounded-2xl bg-muted px-3.5 py-2.5 text-sm text-muted-foreground">
                      <Loader2 className="inline h-3.5 w-3.5 animate-spin" /> thinking…
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
                  <Button type="submit" size="icon" className="h-10 w-10 shrink-0 rounded-full" disabled={!draft.trim() || ask.isPending} aria-label="Send" data-testid="button-help-send">
                    <Send className="h-4 w-4" />
                  </Button>
                </form>
                <button type="button" onClick={wantHuman} className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline" data-testid="button-help-human">
                  <User className="h-3.5 w-3.5" /> Talk to a human
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
                <p className="text-sm font-semibold text-foreground">Leave it with a person</p>
                <p className="text-xs text-muted-foreground">We'll email you back — usually the same day.</p>
              </div>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" data-testid="input-help-name" />
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" required data-testid="input-help-email" />
              <Textarea value={question} onChange={(e) => setQuestion(e.target.value)} rows={4} placeholder="What can we help with?" required data-testid="input-help-message" />
              {siteKey && <Turnstile siteKey={siteKey} onToken={setHuman} resetSignal={humanReset} />}
              {handoff.isError && <p className="text-xs text-destructive">{(handoff.error as Error).message}</p>}
              <div className="mt-auto flex items-center gap-2">
                <Button type="submit" className="gap-1.5 rounded-full" disabled={handoff.isPending || !email.includes("@") || !question.trim() || (Boolean(siteKey) && !human)} data-testid="button-help-submit">
                  {handoff.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Send to a person
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
              <p className="text-sm font-semibold text-foreground">Sent. A person has it.</p>
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
