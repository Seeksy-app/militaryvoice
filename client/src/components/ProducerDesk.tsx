import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bot, Hand, Loader2, MessagesSquare, Send, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { IconTile } from "@/components/ui/icon-tile";
import { useToast } from "@/hooks/use-toast";
import { adminGet, adminSend } from "@/lib/adminApi";

type ChatItem = { id: number; name: string; show: string; email: string; mode: "alex" | "producer"; needsProducer: boolean; lastAt: string; last: { role: string; content: string } | null };
type List = { alexOn: boolean; chats: ChatItem[] };
type Detail = { chat: ChatItem; messages: { id: number; role: "user" | "alex" | "producer"; content: string; createdAt: string }[] };

const time = (iso: string) => (iso ? new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "");

/** How many conversations are waiting on Michael, for a badge. */
export function useGreenRoomWaiting(eventId?: number, enabled = true): number {
  const q = useQuery<List>({
    queryKey: ["/api/admin/greenroom/chats", eventId ?? 0],
    queryFn: () => adminGet(`/api/admin/greenroom/chats${eventId ? `?eventId=${eventId}` : ""}`),
    refetchInterval: 4000,
    enabled,
  });
  return (q.data?.chats ?? []).filter((c) => c.needsProducer).length;
}

/**
 * The producer's desk: every green room conversation, live. Michael (a person)
 * reads along, takes any one from Alex by answering it, hands it back, or
 * switches Alex off for the whole green room. The ones Alex passed to him, or
 * that wrote while he had them, float to the top in gold.
 */
export function ProducerDesk({ eventId, compact = false, narrow = false }: { eventId?: number; compact?: boolean; /** In the console's rail: one column, the list above the conversation. */ narrow?: boolean }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const listKey = ["/api/admin/greenroom/chats", eventId ?? 0];
  const list = useQuery<List>({ queryKey: listKey, queryFn: () => adminGet(`/api/admin/greenroom/chats${eventId ? `?eventId=${eventId}` : ""}`), refetchInterval: 4000 });
  const chats = [...(list.data?.chats ?? [])].sort((a, b) => Number(b.needsProducer) - Number(a.needsProducer) || b.lastAt.localeCompare(a.lastAt));
  const [openId, setOpenId] = useState<number | null>(null);
  const open = openId ?? chats[0]?.id ?? null;
  const detail = useQuery<Detail>({ queryKey: ["/api/admin/greenroom/chats", "one", open], queryFn: () => adminGet(`/api/admin/greenroom/chats/${open}`), enabled: open !== null, refetchInterval: 3000 });
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const logRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [detail.data?.messages.length, open]);

  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: ["/api/admin/greenroom/chats"] });
  };
  const act = async (fn: () => Promise<unknown>, failed: string) => {
    setBusy(true);
    try {
      await fn();
      await refresh();
    } catch (e) {
      toast({ title: failed, description: (e as Error).message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };
  const reply = () => {
    const text = draft.trim();
    if (!text || open === null) return;
    setDraft("");
    void act(() => adminSend("POST", `/api/admin/greenroom/chats/${open}/reply`, { text }), "Couldn't send");
  };
  const chat = detail.data?.chat ?? chats.find((c) => c.id === open);

  return (
    <div className="space-y-4" data-testid="producer-desk">
      <div className="flex flex-wrap items-center gap-4 rounded-2xl border border-border bg-card p-4">
        <IconTile icon={MessagesSquare} size={compact ? "sm" : undefined} />
        <div className="min-w-0 flex-1">
          <p className="font-semibold">Green room chat</p>
          <p className="text-xs text-muted-foreground [text-wrap:pretty]">You're Michael, the producer. Answer any conversation to take it from Alex. Anything Alex can't handle comes to you in gold, and Slack hears.</p>
        </div>
        <label className="flex items-center gap-2 text-sm font-medium">
          <Switch checked={list.data?.alexOn ?? true} disabled={busy || !list.data} onCheckedChange={(on) => void act(() => adminSend("PUT", "/api/admin/greenroom/alex", { eventId, on }), "Couldn't switch Alex")} data-testid="desk-alex-switch" />
          Alex answers
        </label>
      </div>

      <div className={`grid gap-4 ${narrow ? "" : compact ? "md:grid-cols-[240px_minmax(0,1fr)]" : "lg:grid-cols-[300px_minmax(0,1fr)]"}`}>
        <ul className="max-h-[60vh] divide-y divide-border overflow-y-auto rounded-2xl border border-border bg-card" data-testid="desk-list">
          {list.isLoading && <li className="p-4 text-sm text-muted-foreground"><Loader2 className="inline h-4 w-4 animate-spin" /></li>}
          {!list.isLoading && chats.length === 0 && <li className="p-4 text-sm text-muted-foreground">No one has written in the green room yet.</li>}
          {chats.map((c) => (
            <li key={c.id}>
              <button type="button" onClick={() => setOpenId(c.id)} className={`flex w-full items-start gap-2 px-3 py-2.5 text-left ${c.id === open ? "bg-muted" : "hover:bg-muted/60"} ${c.needsProducer ? "border-l-4 border-[#F0A71F]" : "border-l-4 border-transparent"}`}>
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-1.5 truncate text-sm font-semibold">
                    {c.name || c.email}
                    {c.mode === "producer" ? <UserRound className="h-3.5 w-3.5 shrink-0 text-[#053877] dark:text-[#8ab4f8]" aria-label="Michael has it" /> : <Bot className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-label="Alex has it" />}
                  </p>
                  {c.show && <p className="truncate text-[11px] text-muted-foreground">{c.show}</p>}
                  {c.last && <p className="mt-0.5 line-clamp-2 text-xs text-foreground/80">{c.last.role === "user" ? "" : c.last.role === "producer" ? "You: " : "Alex: "}{c.last.content}</p>}
                </div>
                <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">{time(c.lastAt)}</span>
              </button>
            </li>
          ))}
        </ul>

        <div className="flex min-h-[22rem] flex-col rounded-2xl border border-border bg-card">
          {chat ? (
            <>
              <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">{chat.name || chat.email}</p>
                  <p className="truncate text-xs text-muted-foreground">{[chat.show, chat.email].filter(Boolean).join(" · ")}</p>
                </div>
                {chat.mode === "producer" ? (
                  <Button size="sm" variant="outline" className="gap-1.5 rounded-full" disabled={busy} onClick={() => void act(() => adminSend("POST", `/api/admin/greenroom/chats/${chat.id}/mode`, { mode: "alex" }), "Couldn't hand back")} data-testid="desk-hand-back">
                    <Bot className="h-4 w-4" /> Hand back to Alex
                  </Button>
                ) : (
                  <Button size="sm" className="gap-1.5 rounded-full bg-[#053877] text-white hover:bg-[#0a4a99]" disabled={busy} onClick={() => void act(() => adminSend("POST", `/api/admin/greenroom/chats/${chat.id}/mode`, { mode: "producer" }), "Couldn't take over")} data-testid="desk-take-over">
                    <Hand className="h-4 w-4" /> Take over
                  </Button>
                )}
              </div>
              <div ref={logRef} className="max-h-[50vh] flex-1 space-y-2 overflow-y-auto px-4 py-3 text-sm">
                {(detail.data?.messages ?? []).map((m) => (
                  <div key={m.id} className={`max-w-[85%] rounded-xl px-3 py-2 ${m.role === "user" ? "bg-muted" : m.role === "producer" ? "ml-auto bg-[#053877] text-white" : "ml-auto bg-[#F0A71F]/15"}`}>
                    <p className={`text-[10px] font-bold uppercase tracking-[0.12em] ${m.role === "producer" ? "text-white/70" : "text-muted-foreground"}`}>{m.role === "user" ? (chat.name || "Them").split(" ")[0] : m.role === "producer" ? "You · Michael" : "Alex"} · {time(m.createdAt)}</p>
                    <p className="mt-0.5 whitespace-pre-wrap">{m.content}</p>
                  </div>
                ))}
              </div>
              <form className="flex gap-2 border-t border-border p-3" onSubmit={(e) => { e.preventDefault(); reply(); }}>
                <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={`Answer ${(chat.name || "them").split(" ")[0]} as Michael`} className="h-10 min-w-0 flex-1 rounded-full border border-border bg-background px-4 text-sm focus:outline-none focus:ring-2 focus:ring-[#053877]/40" maxLength={2000} data-testid="desk-reply" />
                <Button type="submit" disabled={busy || !draft.trim()} className="h-10 gap-1.5 rounded-full bg-[#053877] px-4 text-white hover:bg-[#0a4a99]" data-testid="desk-send">
                  <Send className="h-4 w-4" /> Send
                </Button>
              </form>
            </>
          ) : (
            <p className="m-auto p-6 text-sm text-muted-foreground">Pick a conversation.</p>
          )}
        </div>
      </div>
    </div>
  );
}

type Line = { id: number; chatId: number; role: "user" | "alex" | "producer"; name: string; show: string; content: string; at: string };
type Feed = { alexOn: boolean; studio: { lines: Line[]; waiting: number }; green: { lines: Line[]; waiting: number } };
type Room = "studio" | "green";

const seenKey = (room: Room) => `mv-chat-seen-${room}`;
const readSeen = (room: Room) => { try { return Number(localStorage.getItem(seenKey(room))) || 0; } catch { return 0; } };

/**
 * Michael's chat, as two rooms: the Studio (the co-hosts running the show)
 * and the Green Room (everyone waiting to go on, with Alex). Each is one
 * conversation that scrolls; a number on the tab says what's new. In the
 * studio everyone reads what he writes; in the green room it answers the
 * person he tapped, or whoever wrote last.
 */
export function ProducerChat({ eventId, tall = false }: { eventId?: number; /** Fill a full column (the green room) rather than a panel. */ tall?: boolean }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const key = ["/api/admin/greenroom/feed", eventId ?? 0];
  const feed = useQuery<Feed>({ queryKey: key, queryFn: () => adminGet(`/api/admin/greenroom/feed${eventId ? `?eventId=${eventId}` : ""}`), refetchInterval: 3000 });
  const [room, setRoom] = useState<Room>(() => { try { return localStorage.getItem("mv-chat-room") === "studio" ? "studio" : "green"; } catch { return "green"; } });
  const [seen, setSeen] = useState<Record<Room, number>>(() => ({ studio: readSeen("studio"), green: readSeen("green") }));
  const [target, setTarget] = useState<Record<Room, number | null>>({ studio: null, green: null });
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const logRef = useRef<HTMLDivElement | null>(null);
  const lines = feed.data?.[room].lines ?? [];
  const lastId = lines.length ? lines[lines.length - 1].id : 0;

  const unread = (r: Room) => (feed.data?.[r].lines ?? []).filter((l) => l.role === "user" && l.id > seen[r]).length;
  // Reading a room marks it read (only while the page is actually in front of him).
  useEffect(() => {
    if (!lastId || document.visibilityState !== "visible" || lastId <= seen[room]) return;
    setSeen((s) => ({ ...s, [room]: lastId }));
    try { localStorage.setItem(seenKey(room), String(lastId)); } catch { /* private window */ }
  }, [lastId, room, seen]);
  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lastId, room]);
  const pick = (r: Room) => { setRoom(r); try { localStorage.setItem("mv-chat-room", r); } catch { /* private window */ } };

  // Who a green room answer goes to: the line he tapped, else whoever wrote last.
  const lastUser = [...lines].reverse().find((l) => l.role === "user");
  const toId = target[room] ?? lastUser?.chatId ?? null;
  const toName = lines.find((l) => l.chatId === toId && l.role === "user")?.name ?? lastUser?.name ?? "";

  const send = async () => {
    const text = draft.trim();
    if (!text) return;
    setBusy(true);
    try {
      const res = await adminSend("POST", "/api/admin/greenroom/say", { eventId, room, chatId: room === "green" ? toId : null, text });
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.message ?? "Couldn't send.");
      setDraft("");
      await qc.invalidateQueries({ queryKey: ["/api/admin/greenroom"] });
      await qc.invalidateQueries({ queryKey: key });
    } catch (e) {
      toast({ title: "Couldn't send", description: (e as Error).message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };
  const setAlex = async (on: boolean) => {
    await adminSend("PUT", "/api/admin/greenroom/alex", { eventId, on }).catch(() => null);
    await qc.invalidateQueries({ queryKey: key });
  };

  const tab = (r: Room, label: string) => {
    const n = unread(r) || feed.data?.[r].waiting || 0;
    return (
      <button
        type="button"
        onClick={() => pick(r)}
        className={`relative flex flex-1 items-center justify-center gap-2 rounded-full px-3 py-2 text-sm font-semibold transition-colors ${room === r ? "bg-[#053877] text-white" : "text-foreground/70 hover:bg-muted"}`}
        data-testid={`chat-room-${r}`}
      >
        {label}
        {n > 0 && <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-[#F0A71F] px-1.5 text-[11px] font-bold text-[#1a1200]">{n}</span>}
      </button>
    );
  };

  return (
    <div className={`flex flex-col gap-2 ${tall ? "h-full min-h-[28rem]" : "h-[min(70vh,40rem)]"}`} data-testid="producer-chat">
      <div className="flex gap-1 rounded-full bg-muted p-1">
        {tab("studio", "Studio")}
        {tab("green", "Green Room")}
      </div>
      <a
        href={`/api/admin/greenroom/transcript?room=${room}${eventId ? `&eventId=${eventId}` : ""}`}
        className="self-end px-1 text-[11px] font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
        data-testid="chat-transcript"
      >
        Download the {room === "studio" ? "Studio" : "Green Room"} transcript
      </a>
      {room === "green" && (
        <label className="flex items-center justify-between gap-2 px-1 text-xs text-muted-foreground">
          <span>{feed.data?.alexOn ? "Alex answers first; anything she can't, comes to you." : "Alex is off: every question comes to you."}</span>
          <span className="flex items-center gap-1.5 font-medium text-foreground"><Bot className="h-3.5 w-3.5" /> Alex <Switch checked={feed.data?.alexOn ?? true} onCheckedChange={(v) => void setAlex(v)} data-testid="chat-alex-switch" /></span>
        </label>
      )}
      <div ref={logRef} className="min-h-0 flex-1 space-y-2 overflow-y-auto rounded-xl border border-border bg-card p-3" data-testid={`chat-feed-${room}`}>
        {lines.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">{room === "studio" ? "Nothing from the studio yet. Anything Amy, Enrique or Riccoh sends lands here." : "Nobody in the green room has written yet."}</p>
        ) : lines.map((l) => {
          const mine = l.role === "producer";
          const picked = room === "green" && l.role === "user" && l.chatId === toId;
          return (
            <div key={l.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
              <button
                type="button"
                disabled={l.role !== "user" || room !== "green"}
                onClick={() => setTarget((t) => ({ ...t, [room]: l.chatId }))}
                className={`max-w-[85%] rounded-2xl px-3 py-2 text-left text-sm leading-snug ${mine ? "bg-[#F0A71F]/20" : l.role === "alex" ? "bg-[#053877]/[0.07]" : "bg-muted"} ${picked ? "ring-2 ring-[#053877]/40" : ""} disabled:cursor-default`}
                title={l.role === "user" && room === "green" ? `Answer ${l.name}` : undefined}
              >
                <span className="block text-[11px] font-semibold text-muted-foreground">
                  {l.name}{l.show ? ` · ${l.show}` : ""} · {time(l.at)}
                </span>
                <span className="block whitespace-pre-wrap text-foreground">{l.content}</span>
              </button>
            </div>
          );
        })}
      </div>
      <form onSubmit={(e) => { e.preventDefault(); void send(); }} className="flex flex-col gap-1">
        <p className="px-1 text-[11px] text-muted-foreground">
          {room === "studio" ? "Everyone in the studio sees this." : toName ? <>Answering <span className="font-semibold text-foreground">{toName}</span>. Tap a message to answer someone else.</> : "Tap a message to answer it."}
        </p>
        <div className="flex items-center gap-1.5">
          <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={room === "studio" ? "Message the studio" : toName ? `Answer ${toName}` : "Answer"} maxLength={2000} className="h-10 min-w-0 flex-1 rounded-full border border-border bg-background px-4 text-sm focus:outline-none focus:ring-2 focus:ring-[#053877]/30" data-testid="chat-input" />
          <Button type="submit" size="icon" disabled={busy || !draft.trim() || (room === "green" && !toId)} className="h-10 w-10 shrink-0 rounded-full bg-[#053877] text-white hover:bg-[#0a4a99]" aria-label="Send">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </Button>
        </div>
      </form>
    </div>
  );
}
