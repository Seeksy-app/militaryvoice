import { useEffect, useRef, useState } from "react";
import { Send } from "lucide-react";

type Role = "user" | "alex" | "producer";
interface Msg { id?: number; role: Role; content: string }
type Thread = { alexOn: boolean; mode: "alex" | "producer"; messages: { id: number; role: Role; content: string }[] };

const HELLO_ALEX = "Hi, I'm Alex, the co-host. Ask me anything about the day: your time, who's on before you, what happens when you're brought up. Michael, the producer, is here too.";
const HELLO_MICHAEL = "Hi, it's Michael, the producer. Ask me anything about the day and I'll answer right here.";

/**
 * The green room chat: Alex, with Michael (the producer, a person) behind her.
 *
 * Every message is kept on the server, so Michael sees the conversation live
 * and can step in; his replies arrive by polling. Alex's answers stream in as
 * she writes them. When Michael has the conversation, or Alex is switched off
 * for the day, the card is his: his name on it, and messages wait for him.
 */
export function AlexChat({ studioId }: { studioId?: number }) {
  const [thread, setThread] = useState<Thread | null>(null);
  const [streaming, setStreaming] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
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
    const id = setInterval(() => void load(), 4000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studioId]);

  const michael = Boolean(thread && (!thread.alexOn || thread.mode === "producer"));
  const msgs: Msg[] = [
    { role: michael ? "producer" : "alex", content: michael ? HELLO_MICHAEL : HELLO_ALEX },
    ...(thread?.messages ?? []),
    ...(pending ? [{ role: "user" as const, content: pending }] : []),
    ...(streaming !== null ? [{ role: "alex" as const, content: streaming }] : []),
  ];

  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [msgs.length, streaming]);

  async function send() {
    const text = draft.trim();
    if (!text || busy) return;
    setDraft("");
    setPending(text);
    setBusy(true);
    try {
      const r = await fetch("/api/host/alex/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ studioId, text }),
      });
      if (!r.ok) throw new Error("no answer");
      // Michael has it: the message is saved and waits for him.
      if ((r.headers.get("content-type") ?? "").includes("application/json") || !r.body) {
        await load();
        return;
      }
      setStreaming("");
      const reader = r.body.getReader();
      const dec = new TextDecoder();
      let acc = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        acc += dec.decode(value, { stream: true });
        setStreaming(acc);
      }
      await load();
    } catch {
      await load();
    } finally {
      setPending(null);
      setStreaming(null);
      setBusy(false);
    }
  }

  return (
    <div className={`flex h-56 items-stretch overflow-hidden rounded-2xl border ${michael ? "border-[#8ab4f8]/30 bg-[#8ab4f8]/[0.06]" : "border-[#F0A71F]/30 bg-[#F0A71F]/[0.06]"}`} data-testid="alex-chat">
      {/* Flush to the card's edges and its full height, as her live tile was. */}
      <div className="hidden w-40 shrink-0 self-stretch bg-black/40 sm:block">
        {michael ? (
          <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-[#053877] to-[#000741] text-5xl font-bold text-white/90" aria-hidden="true">M</div>
        ) : (
          <img src="/alex.webp" alt="Alex" className="h-full w-full object-cover object-top" />
        )}
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-baseline gap-2 px-4 pt-3">
          <span className="text-lg font-semibold leading-tight">{michael ? "Michael" : "Alex"}</span>
          <span className="text-xs text-white/55">{michael ? "Producer · ask him anything" : "Co-host · ask her anything"}</span>
        </div>
        <div ref={logRef} className="mt-2 flex-1 space-y-2 overflow-y-auto px-4 pb-1 text-[13px] leading-snug" data-testid="alex-log">
          {msgs.map((m, i) => (
            <div
              key={m.id ?? `l${i}`}
              className={`max-w-[92%] rounded-xl px-3 py-1.5 ${m.role === "user" ? "ml-auto bg-white/10 text-white" : m.role === "producer" ? "bg-[#8ab4f8]/15 text-white/90" : "bg-[#F0A71F]/15 text-white/90"}`}
            >
              {m.role === "producer" && i > 0 && <span className="mb-0.5 block text-[10px] font-bold uppercase tracking-[0.14em] text-[#8ab4f8]">Michael · Producer</span>}
              {m.content || <span className="inline-block animate-pulse">…</span>}
            </div>
          ))}
          {michael && !busy && thread?.messages.length && thread.messages[thread.messages.length - 1].role === "user" ? (
            <p className="text-[11px] text-white/45">Michael has your message and will answer here.</p>
          ) : null}
        </div>
        <form
          onSubmit={(e) => { e.preventDefault(); void send(); }}
          className="flex items-center gap-2 border-t border-white/10 px-3 py-2"
        >
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="When am I on? Who's before me?"
            className="h-9 min-w-0 flex-1 rounded-full bg-black/30 px-3.5 text-sm text-white placeholder:text-white/35 focus:outline-none focus:ring-2 focus:ring-[#F0A71F]/50"
            maxLength={500}
            data-testid="alex-input"
          />
          <button
            type="submit"
            disabled={busy || !draft.trim()}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#F0A71F] text-[#1a1200] disabled:opacity-40"
            aria-label="Send"
            data-testid="alex-send"
          >
            <Send className="h-4 w-4" />
          </button>
        </form>
      </div>
    </div>
  );
}
