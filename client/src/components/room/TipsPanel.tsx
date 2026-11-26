import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Lightbulb, X } from "lucide-react";
import { useRoomContext } from "@livekit/components-react";
import { RoomEvent, type RemoteParticipant } from "livekit-client";
import { apiRequest } from "@/lib/queryClient";
import { Select } from "./Select";

/**
 * Tips (Studio v2, Andrew, 26 Nov: "If there's a lull in the conversation, we're going to pop up conversation starters,
 * and they can toggle that off or on"). The owner's switch and settings live here; Engineering's listener sends a card
 * on the room's "mv-starter" topic to the owner only (agreed 26 Nov). Until that listener runs nothing arrives, so the
 * card never shows: there are no made-up suggestions. Never seen by guests or viewers, never in the recording.
 */
export type Starters = { on: boolean; from: { notes: boolean; prep: boolean; talk: boolean; brief: boolean }; wait: number };
const KEY = ["/api/host/my-studio/starters"];
const WAITS = [5, 8, 12, 20];

export function useStarters(enabled: boolean) {
  const qc = useQueryClient();
  const q = useQuery<Starters>({ queryKey: KEY, enabled, staleTime: 60_000, retry: false, queryFn: async () => (await apiRequest("GET", KEY[0])).json() });
  const save = useMutation({
    mutationFn: async (p: Partial<Starters>) => (await apiRequest("PUT", KEY[0], p)).json() as Promise<Starters>,
    onMutate: (p) => { const was = qc.getQueryData<Starters>(KEY); if (was) qc.setQueryData(KEY, { ...was, ...p, from: { ...was.from, ...(p.from ?? {}) } }); return { was }; },
    onError: (_e, _p, c) => { if (c?.was) qc.setQueryData(KEY, c.was); },
    onSuccess: (s) => qc.setQueryData(KEY, s),
  });
  return { s: q.data, set: (p: Partial<Starters>) => save.mutate(p) };
}

function Toggle({ on, onClick, label }: { on: boolean; onClick: () => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} onClick={onClick} className={`relative h-[18px] w-[30px] shrink-0 rounded-full transition-colors ${on ? "bg-[#053877]" : "bg-[#d0d5dd]"}`}>
      <span className={`absolute top-[2px] h-[14px] w-[14px] rounded-full bg-white shadow-sm transition-all ${on ? "left-[14px]" : "left-[2px]"}`} />
    </button>
  );
}

export function TipsPanel() {
  const { s, set } = useStarters(true);
  const on = s?.on === true;
  const from = { notes: true, prep: true, talk: true, brief: true, ...(s?.from ?? {}) };
  const box = (k: keyof Starters["from"], text: string) => (
    <label className="flex items-center gap-2 text-[13px] font-medium">
      <input type="checkbox" checked={from[k]} onChange={(e) => set({ from: { ...from, [k]: e.target.checked } })} className="h-4 w-4 accent-[#053877]" data-testid={`starters-from-${k}`} />{text}
    </label>
  );
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-5 pb-6 pt-5" data-testid="tips-panel">
      <p className="text-lg font-bold tracking-tight">Tips</p>
      <p className="mt-0.5 text-[13px] text-[#667085]">Help while you're on air. Only you see it.</p>
      <div className="mt-3.5 flex items-start gap-3 rounded-xl border border-[#e4e7ec] p-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold">Conversation starters</p>
          <p className="mt-0.5 text-[12.5px] leading-snug text-[#667085] [text-wrap:pretty]">When the talk goes quiet, we suggest 2–3 questions. One tap closes them.</p>
        </div>
        <Toggle on={on} onClick={() => set({ on: !on })} label="Conversation starters" />
      </div>
      <p className="mt-5 text-xs font-bold uppercase tracking-[0.06em] text-[#667085]">Ideas come from</p>
      <div className="mt-2 grid gap-1.5">
        {box("notes", "Your show notes")}
        {box("prep", "Your guest's prep form")}
        {box("brief", "Your guest brief")}
        {box("talk", "What's been said so far")}
      </div>
      <div className="mt-4 flex items-center justify-between gap-3 text-[13px] font-medium">
        <span className="whitespace-nowrap">Suggest after</span>
        <Select value={s?.wait ?? 8} onChange={(e) => set({ wait: Number(e.target.value) })} aria-label="Quiet spell" wrap="shrink-0" className="h-8 rounded-lg border border-[#d0d5dd] bg-white pl-2.5 text-[12.5px] font-semibold" data-testid="starters-wait">
          {WAITS.map((w) => <option key={w} value={w}>{w} seconds</option>)}
        </Select>
      </div>
      <p className="mt-4 rounded-[10px] bg-[#f9fafb] px-3 py-2.5 text-xs leading-relaxed text-[#667085]">Never shown to guests or viewers, and never in the recording.</p>
    </div>
  );
}

/** The bottom bar's Tips switch: one tap turns conversation starters on or off. */
export function TipsSwitch({ onOpen }: { onOpen: () => void }) {
  const { s, set } = useStarters(true);
  const on = s?.on === true;
  return (
    <div className="hidden h-[58px] items-center gap-2 rounded-xl px-2 text-[12px] font-semibold text-[#344054] lg:flex" data-testid="tips-switch">
      <button type="button" onClick={onOpen} className="flex flex-col items-center gap-1 hover:text-[#101828]" aria-label="Open Tips"><Lightbulb className="h-[22px] w-[22px]" />Tips</button>
      <Toggle on={on} onClick={() => set({ on: !on })} label="Conversation starters" />
    </div>
  );
}

type Card = { id: string; lines: string[]; basis?: string; from: string };
const enc = new TextEncoder();
const dec = new TextDecoder();

/**
 * The card itself, under the stage, for the owner only. It shows only what Engineering's listener sends on
 * "mv-starter" ({ kind: "starter", id, lines, basis?, at }); a tap on a line or the ✕ answers { kind: "starter-ack",
 * id, action } to the sender, which drives its cooldown. Off, or with nothing sent, it draws nothing.
 */
export function StarterCard() {
  const room = useRoomContext();
  const { s } = useStarters(true);
  const on = s?.on === true;
  const [card, setCard] = useState<Card | null>(null);
  useEffect(() => {
    const got = (payload: Uint8Array, p?: RemoteParticipant, _k?: unknown, topic?: string) => {
      if (topic !== "mv-starter" || !p) return;
      let m: { kind?: string; id?: string; lines?: unknown; basis?: string } = {};
      try { m = JSON.parse(dec.decode(payload)); } catch { return; }
      if (m.kind === "starter" && typeof m.id === "string" && Array.isArray(m.lines)) {
        const lines = m.lines.map((x) => String(x ?? "").trim().slice(0, 120)).filter(Boolean).slice(0, 3);
        if (lines.length) setCard({ id: m.id, lines, basis: typeof m.basis === "string" ? m.basis.slice(0, 60) : undefined, from: p.identity });
      }
    };
    room.on(RoomEvent.DataReceived, got);
    return () => { room.off(RoomEvent.DataReceived, got); };
  }, [room]);
  useEffect(() => { if (!on) setCard(null); }, [on]);
  if (!on || !card) return null;
  const ack = (action: "used" | "dismissed") => {
    void room.localParticipant.publishData(enc.encode(JSON.stringify({ kind: "starter-ack", id: card.id, action })), { reliable: true, topic: "mv-starter", destinationIdentities: [card.from] }).catch(() => {});
    setCard(null);
  };
  return (
    <div className="mt-2.5 flex w-full shrink-0 gap-2.5 rounded-xl border border-[#f5d48a] bg-[#fffbf0] py-2.5 pl-3.5 pr-3 shadow-[0_6px_18px_-10px_rgba(16,24,40,0.25)]" style={{ maxWidth: "inherit" }} data-testid="starter-card">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[#F0A71F] text-[#1a1200]"><Lightbulb className="h-4 w-4" /></span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-xs font-bold">Conversation starters <span className="font-semibold text-[#8a6a1f]">· Only you see this</span>
          <button type="button" onClick={() => ack("dismissed")} aria-label="Close" className="ml-auto flex h-[22px] w-[22px] items-center justify-center rounded-md text-[#667085] hover:bg-white"><X className="h-3.5 w-3.5" /></button>
        </div>
        <ul className="mt-1.5 grid gap-1">
          {card.lines.map((l, i) => (
            <li key={i}><button type="button" onClick={() => ack("used")} className="w-full rounded-lg border border-[#f0e2bd] bg-white px-2.5 py-1.5 text-left text-[13px] leading-snug hover:border-[#e0c47a]">{l}{card.basis && i === 0 ? <span className="ml-1 text-[11px] text-[#667085]">{card.basis}</span> : null}</button></li>
          ))}
        </ul>
      </div>
    </div>
  );
}
