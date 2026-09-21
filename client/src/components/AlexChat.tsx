import { useEffect, useRef, useState } from "react";
import { Send } from "lucide-react";

interface Msg { role: "user" | "assistant"; content: string }

const HELLO = "Hi — I'm Alex, the producer. Ask me anything about the day: your time, who's on before you, what happens when I bring you up.";

/**
 * Alex in the green room, by text.
 *
 * A still of her rather than the rendered face: the face took seven seconds
 * to answer, and what a podcaster waiting to go on wants is the answer.
 * Words appear as she writes them. The avatar keeps the main stage.
 */
export function AlexChat({ studioId }: { studioId?: number }) {
  const [msgs, setMsgs] = useState<Msg[]>([{ role: "assistant", content: HELLO }]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const logRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [msgs]);

  async function send() {
    const text = draft.trim();
    if (!text || busy) return;
    setDraft("");
    const next: Msg[] = [...msgs, { role: "user", content: text }, { role: "assistant", content: "" }];
    setMsgs(next);
    setBusy(true);
    try {
      const r = await fetch("/api/host/alex/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ studioId, messages: next.slice(1, -1) }),
      });
      if (!r.ok || !r.body) throw new Error("no answer");
      const reader = r.body.getReader();
      const dec = new TextDecoder();
      let acc = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        acc += dec.decode(value, { stream: true });
        const snapshot = acc;
        setMsgs((m) => [...m.slice(0, -1), { role: "assistant", content: snapshot }]);
      }
      if (!acc.trim()) setMsgs((m) => [...m.slice(0, -1), { role: "assistant", content: "I didn't catch that — ask me again?" }]);
    } catch {
      setMsgs((m) => [...m.slice(0, -1), { role: "assistant", content: "I'm not answering right now — the producer will still bring you up on time." }]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex h-56 items-stretch overflow-hidden rounded-2xl border border-[#F0A71F]/30 bg-[#F0A71F]/[0.06]" data-testid="alex-chat">
      {/* Flush to the card's edges and its full height, as her live tile was. */}
      <div className="hidden w-40 shrink-0 self-stretch bg-black/40 sm:block">
        <img src="/alex.webp" alt="Alex" className="h-full w-full object-cover object-top" />
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-baseline gap-2 px-4 pt-3">
          <span className="text-lg font-semibold leading-tight">Alex</span>
          <span className="text-xs text-white/55">Producer · ask her anything</span>
        </div>
        <div ref={logRef} className="mt-2 flex-1 space-y-2 overflow-y-auto px-4 pb-1 text-[13px] leading-snug" data-testid="alex-log">
          {msgs.map((m, i) => (
            <div key={i} className={`max-w-[92%] rounded-xl px-3 py-1.5 ${m.role === "user" ? "ml-auto bg-white/10 text-white" : "bg-[#F0A71F]/15 text-white/90"}`}>
              {m.content || <span className="inline-block animate-pulse">…</span>}
            </div>
          ))}
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
