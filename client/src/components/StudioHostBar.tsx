import { useEffect, useRef, useState } from "react";
import { AlertTriangle, ChevronRight, Loader2, MessageCircle, Radio, Send, X } from "lucide-react";

type Role = "user" | "alex" | "producer";
type Thread = { messages: { id: number; role: Role; content: string }[] };

/**
 * The studio host's controls, as big as buttons get, across the top of the
 * console: put me on stage, the next show, and the one for when something
 * goes wrong (OH SH#T!), which covers the screen with "We'll be right back"
 * and calls Michael in the same press. Everything else in the console is still there
 * below; these are the four things a co-host does under pressure.
 */
export function StudioHostBar({
  meOnStage,
  stageBusy,
  onStage,
  nextName,
  nextBusy,
  onNext,
  covered,
  onCover,
  onUncover,
  studioId,
}: {
  meOnStage: boolean;
  stageBusy: boolean;
  onStage: () => void;
  nextName: string;
  nextBusy: boolean;
  onNext: () => void;
  covered: boolean;
  onCover: () => void;
  onUncover: () => void;
  studioId?: number;
}) {
  const [chatOpen, setChatOpen] = useState(false);
  const [alerted, setAlerted] = useState(false);

  const cover = async () => {
    onCover();
    setChatOpen(true);
    if (!alerted) {
      setAlerted(true);
      await fetch("/api/host/alex/chat", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ studioId, text: "I pressed OH SH#T! The screen is on We'll be right back. Something's wrong on stage, please help.", toProducer: true, urgent: true }),
      }).catch(() => {});
    }
  };

  const big = "flex min-h-[5.5rem] flex-1 items-center justify-center gap-3 rounded-2xl px-5 text-left text-white shadow-lg transition-transform active:scale-[0.98] disabled:opacity-60";
  return (
    <div className="border-b border-white/10 bg-[#000741] p-3 sm:p-4" data-testid="studio-host-bar">
      <div className="flex flex-col gap-3 lg:flex-row">
        <button type="button" onClick={onStage} disabled={stageBusy} className={`${big} ${meOnStage ? "bg-[#ED1C24] hover:bg-[#d01820]" : "bg-[#15834f] hover:bg-[#126e42]"}`} data-testid="host-bar-stage">
          {stageBusy ? <Loader2 className="h-8 w-8 shrink-0 animate-spin" /> : <Radio className="h-8 w-8 shrink-0" />}
          <span>
            <span className="block text-xl font-bold leading-tight">{stageBusy ? "Getting you on…" : meOnStage ? "Take me off stage" : "Put me on stage"}</span>
            <span className="block text-xs text-white/75">{meOnStage ? "You're on the air now" : "Your camera and mic go live"}</span>
          </span>
        </button>

        <button type="button" onClick={onNext} disabled={nextBusy || !nextName} className={`${big} bg-[#053877] hover:bg-[#0a4a99]`} data-testid="host-bar-next">
          {nextBusy ? <Loader2 className="h-8 w-8 shrink-0 animate-spin" /> : <ChevronRight className="h-8 w-8 shrink-0" />}
          <span className="min-w-0">
            <span className="block text-xl font-bold leading-tight">Next</span>
            <span className="block truncate text-xs text-white/75">{nextName || "Nothing after this"}</span>
          </span>
        </button>

        {covered ? (
          <button type="button" onClick={onUncover} className={`${big} bg-[#F0A71F] text-[#000741] hover:bg-[#f5b94a]`} data-testid="host-bar-uncover">
            <Radio className="h-8 w-8 shrink-0" />
            <span>
              <span className="block text-xl font-bold leading-tight">Back to the show</span>
              <span className="block text-xs text-[#000741]/75">Takes "We'll be right back" off</span>
            </span>
          </button>
        ) : (
          <button type="button" onClick={() => void cover()} className={`${big} bg-[#ED1C24] hover:bg-[#d01820]`} data-testid="host-bar-cover">
            <AlertTriangle className="h-8 w-8 shrink-0" />
            <span>
              <span className="block text-2xl font-black leading-tight tracking-tight">OH SH#T!</span>
              <span className="block text-xs text-white/85">We'll be right back · calls Michael</span>
            </span>
          </button>
        )}

        <button type="button" onClick={() => setChatOpen((o) => !o)} className={`${big} border border-white/20 bg-white/10 hover:bg-white/15 lg:max-w-[16rem]`} data-testid="host-bar-chat">
          <MessageCircle className="h-8 w-8 shrink-0" />
          <span>
            <span className="block text-xl font-bold leading-tight">Message Michael</span>
            <span className="block text-xs text-white/75">The producer, right here</span>
          </span>
        </button>
      </div>
      {chatOpen && <MichaelChat studioId={studioId} onClose={() => setChatOpen(false)} />}
    </div>
  );
}

/** A direct line to Michael from inside the studio: same thread as the green room, never to Alex. */
function MichaelChat({ studioId, onClose }: { studioId?: number; onClose: () => void }) {
  const [thread, setThread] = useState<Thread | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const logRef = useRef<HTMLDivElement | null>(null);
  const load = async () => {
    try {
      const r = await fetch(`/api/host/alex/thread${studioId ? `?studioId=${studioId}` : ""}`, { credentials: "include" });
      if (r.ok) setThread((await r.json()) as Thread);
    } catch {
      // The next poll asks again.
    }
  };
  useEffect(() => {
    void load();
    const id = setInterval(() => void load(), 3000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studioId]);
  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [thread?.messages.length]);
  const send = async () => {
    const text = draft.trim();
    if (!text) return;
    setDraft("");
    setBusy(true);
    await fetch("/api/host/alex/chat", { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ studioId, text, toProducer: true }) }).catch(() => {});
    await load();
    setBusy(false);
  };
  const msgs = thread?.messages ?? [];
  return (
    <div className="mt-3 overflow-hidden rounded-2xl border border-[#8ab4f8]/30 bg-[#8ab4f8]/[0.07] text-white" data-testid="michael-chat">
      <div className="flex items-center gap-2 border-b border-white/10 px-4 py-2.5">
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[#053877] text-sm font-bold">M</span>
        <span className="font-semibold">Michael</span>
        <span className="text-xs text-white/60">Producer · watching now</span>
        <button type="button" onClick={onClose} className="ml-auto rounded-md p-1 text-white/60 hover:bg-white/10 hover:text-white" aria-label="Close the chat"><X className="h-4 w-4" /></button>
      </div>
      <div ref={logRef} className="max-h-48 space-y-2 overflow-y-auto px-4 py-3 text-sm">
        {msgs.length === 0 && <p className="text-white/55">Tell Michael what's happening. He answers right here.</p>}
        {msgs.map((m) => (
          <div key={m.id} className={`max-w-[85%] rounded-xl px-3 py-1.5 ${m.role === "user" ? "ml-auto bg-white/10" : m.role === "producer" ? "bg-[#8ab4f8]/20" : "bg-[#F0A71F]/15"}`}>
            {m.role === "producer" && <span className="mb-0.5 block text-[10px] font-bold uppercase tracking-[0.14em] text-[#8ab4f8]">Michael</span>}
            {m.content}
          </div>
        ))}
      </div>
      <form onSubmit={(e) => { e.preventDefault(); void send(); }} className="flex gap-2 border-t border-white/10 p-3">
        <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="What's wrong?" maxLength={500} className="h-11 min-w-0 flex-1 rounded-full bg-black/30 px-4 text-sm placeholder:text-white/40 focus:outline-none focus:ring-2 focus:ring-[#8ab4f8]/50" data-testid="michael-chat-input" />
        <button type="submit" disabled={busy || !draft.trim()} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#F0A71F] text-[#000741] disabled:opacity-40" aria-label="Send"><Send className="h-4 w-4" /></button>
      </form>
    </div>
  );
}
