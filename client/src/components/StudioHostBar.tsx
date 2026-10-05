import { useEffect, useRef, useState } from "react";
import { AlertTriangle, ChevronRight, Loader2, MessageCircle, Radio, Send, X } from "lucide-react";

type Role = "user" | "peer" | "alex" | "producer";
type Thread = { messages: { id: number; role: Role; content: string; name?: string }[] };

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
  onChat,
  chatWaiting = 0,
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
  /** Opens Michael's chat in the console's right rail. Without it the chat opens here, under the buttons. */
  onChat?: () => void;
  /** Messages waiting on Michael, shown on the card. */
  chatWaiting?: number;
}) {
  const [chatOpen, setChatOpen] = useState(false);
  const openChat = () => (onChat ? onChat() : setChatOpen(true));
  const [alerted, setAlerted] = useState(false);

  const cover = async () => {
    onCover();
    openChat();
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
              <span className="block text-xs text-white/85">Puts up "We'll be right back" · calls Michael</span>
            </span>
          </button>
        )}

        <button type="button" onClick={() => (onChat ? onChat() : setChatOpen((o) => !o))} className={`${big} bg-[#F0A71F] text-[#000741] hover:bg-[#f5b94a] lg:max-w-[16rem]`} data-testid="host-bar-chat">
          <MessageCircle className="h-8 w-8 shrink-0" />
          <span>
            <span className="block text-xl font-bold leading-tight">Message Michael</span>
            <span className="block text-xs text-[#000741]/75">{chatWaiting > 0 ? `${chatWaiting} waiting · opens the chat` : "Opens the chat on the right"}</span>
          </span>
        </button>
      </div>
      {chatOpen && !onChat && <MichaelChat studioId={studioId} onClose={() => setChatOpen(false)} />}
    </div>
  );
}

/** A direct line to Michael from inside the studio: same thread as the green room, never to Alex. */
/** Where a host last read the team's messages to them, kept per studio in this browser. */
const teamSeenKey = (studioId?: number) => `mv-team-seen-${studioId ?? 0}`;
const readTeamSeen = (studioId?: number) => { try { return Number(localStorage.getItem(teamSeenKey(studioId)) || 0); } catch { return 0; } };
const writeTeamSeen = (studioId: number | undefined, id: number) => { try { localStorage.setItem(teamSeenKey(studioId), String(id)); window.dispatchEvent(new Event("mv-team-seen")); } catch { /* private window */ } };

/**
 * Unread messages from the team (Michael) to this host, for the badge on the
 * chat icon. "first" turns true once, the first time a message from the team
 * arrives, so the console can open the chat and say what it is.
 */
export function useTeamUnread(studioId: number | undefined, enabled: boolean): { count: number; first: boolean; markSeen: () => void } {
  const [lines, setLines] = useState<{ id: number; role: Role }[]>([]);
  const [seen, setSeen] = useState(() => readTeamSeen(studioId));
  useEffect(() => {
    if (!enabled) return;
    let stop = false;
    const load = async () => {
      try {
        const r = await fetch(`/api/host/alex/thread?feed=studio${studioId ? `&studioId=${studioId}` : ""}`, { credentials: "include" });
        if (r.ok && !stop) setLines(((await r.json()) as Thread).messages.map((m) => ({ id: m.id, role: m.role })));
      } catch { /* next poll */ }
    };
    void load();
    const id = setInterval(() => void load(), 4000);
    const sync = () => setSeen(readTeamSeen(studioId));
    window.addEventListener("mv-team-seen", sync);
    return () => { stop = true; clearInterval(id); window.removeEventListener("mv-team-seen", sync); };
  }, [studioId, enabled]);
  const team = lines.filter((m) => m.role === "producer");
  const count = team.filter((m) => m.id > seen).length;
  const lastTeam = team.length ? team[team.length - 1].id : 0;
  return { count, first: count > 0 && seen === 0, markSeen: () => { if (lastTeam) { writeTeamSeen(studioId, lastTeam); setSeen(lastTeam); } } };
}

export function MichaelChat({ studioId, onClose, panel = false }: { studioId?: number; onClose?: () => void; panel?: boolean }) {
  const [thread, setThread] = useState<Thread | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const logRef = useRef<HTMLDivElement | null>(null);
  const load = async () => {
    try {
      const r = await fetch(`/api/host/alex/thread?feed=studio${studioId ? `&studioId=${studioId}` : ""}`, { credentials: "include" });
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
    // Reading the panel is reading them: the badge on the chat icon clears.
    if (panel) {
      const team = (thread?.messages ?? []).filter((m) => m.role === "producer");
      if (team.length) writeTeamSeen(studioId, team[team.length - 1].id);
    }
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
  const who = (r: Role, name?: string) => (r === "producer" ? "Michael" : r === "alex" ? "Alex" : r === "peer" ? name || "Co-host" : "You");
  const tone = (r: Role) => (r === "producer" ? "text-[#8ab4f8]" : r === "alex" ? "text-[#F0A71F]" : "text-white/60");
  // In the rail: the whole conversation, newest at the bottom, the box under it.
  if (panel) {
    const all = thread?.messages ?? [];
    const fromTeam = all.some((m) => m.role === "producer");
    return (
      <div className="flex h-full min-h-[24rem] flex-col gap-2 text-white" data-testid="michael-chat-panel">
        {fromTeam && <p className="shrink-0 rounded-lg bg-[#F0A71F]/15 px-3 py-2 text-xs font-semibold text-[#F0A71F]" data-testid="team-dm-note">Here are your direct messages from the team.</p>}
        <div ref={logRef} className="min-h-0 flex-1 space-y-2 overflow-y-auto text-sm leading-snug">
          {all.length === 0 ? (
            <p className="text-white/60"><span className="font-semibold text-white">Michael</span> is watching. Tell him what's happening.</p>
          ) : all.map((m) => (
            <div key={m.id} className={`rounded-xl px-3 py-2 ${m.role === "user" ? "ml-6 bg-white/10" : "mr-6 bg-[#8ab4f8]/[0.1]"}`}>
              <p className={`text-[11px] font-semibold ${tone(m.role)}`}>{who(m.role, m.name)}</p>
              <p className="whitespace-pre-wrap text-white/90">{m.content}</p>
            </div>
          ))}
        </div>
        <form onSubmit={(e) => { e.preventDefault(); void send(); }} className="flex shrink-0 items-center gap-1.5">
          <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Message Michael" maxLength={500} className="h-10 min-w-0 flex-1 rounded-full bg-black/30 px-4 text-sm placeholder:text-white/40 focus:outline-none focus:ring-2 focus:ring-[#8ab4f8]/50" data-testid="michael-chat-input" autoFocus />
          <button type="submit" disabled={busy || !draft.trim()} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#F0A71F] text-[#000741] disabled:opacity-40" aria-label="Send"><Send className="h-4 w-4" /></button>
        </form>
      </div>
    );
  }
  // Slim on purpose: a strip under the buttons, the last word or two and a box to type in.
  const msgs = (thread?.messages ?? []).slice(-2);
  return (
    <div className="mt-2 flex flex-col gap-1.5 rounded-xl border border-[#8ab4f8]/30 bg-[#8ab4f8]/[0.07] px-3 py-2 text-white sm:flex-row sm:items-center" data-testid="michael-chat">
      <div ref={logRef} className="min-w-0 flex-1 space-y-0.5 text-xs leading-snug">
        {msgs.length === 0 ? (
          <p className="text-white/60"><span className="font-semibold text-white">Michael</span> is watching. Tell him what's happening.</p>
        ) : msgs.map((m) => (
          <p key={m.id} className="truncate">
            <span className={`font-semibold ${m.role === "producer" ? "text-[#8ab4f8]" : m.role === "alex" ? "text-[#F0A71F]" : "text-white/60"}`}>{m.role === "producer" ? "Michael" : m.role === "alex" ? "Alex" : m.role === "peer" ? m.name || "Co-host" : "You"}:</span> <span className="text-white/85">{m.content}</span>
          </p>
        ))}
      </div>
      <form onSubmit={(e) => { e.preventDefault(); void send(); }} className="flex shrink-0 items-center gap-1.5 sm:w-[44%]">
        <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Message Michael" maxLength={500} className="h-9 min-w-0 flex-1 rounded-full bg-black/30 px-3.5 text-sm placeholder:text-white/40 focus:outline-none focus:ring-2 focus:ring-[#8ab4f8]/50" data-testid="michael-chat-input" autoFocus />
        <button type="submit" disabled={busy || !draft.trim()} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#F0A71F] text-[#000741] disabled:opacity-40" aria-label="Send"><Send className="h-4 w-4" /></button>
        <button type="button" onClick={() => onClose?.()} className="rounded-md p-1 text-white/60 hover:bg-white/10 hover:text-white" aria-label="Close the chat"><X className="h-4 w-4" /></button>
      </form>
    </div>
  );
}
