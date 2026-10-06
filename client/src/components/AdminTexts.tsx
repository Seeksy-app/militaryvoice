import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { adminGet, adminSend } from "@/lib/adminApi";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { ArrowDownLeft, ArrowUpRight, Loader2, Send, Smartphone, TriangleAlert } from "lucide-react";

// Admin → Texts: text the people on the lineup on show day. Pick a line (or
// write one), tick who gets it, send. Below, every text both ways, with
// whether it arrived. Built after 5 Oct, when "you're on in 10" went by email
// and wasn't read (AAR).

type Person = { key: string; role: "host" | "cohost"; name: string; email: string; show: string; slotAt: string; phone: string; textable: boolean; optedOut: boolean };
type People = { configured: boolean; from: string; studioLink: string; people: Person[] };
type Msg = { id: number; direction: "out" | "in"; phone: string; name: string; body: string; status: string; error: string; createdAt: string };

const PRESETS = [
  { label: "On in 10", text: "Hi {name}, you're on in about 10 minutes. Please come to the green room now: {link}" },
  { label: "Green room", text: "Hi {name}, we're ready for you in the green room: {link}" },
  { label: "Live in 2", text: "{name}, you're live in 2 minutes. Stay on this screen." },
  { label: "Running late", text: "Hi {name}, we're running a few minutes behind. Stay in the green room and we'll bring you on soon." },
];

const time = (iso: string) => (iso ? new Date(iso).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" }) : "");
const when = (iso: string) => new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const STATUS: Record<string, string> = {
  delivered: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300",
  sent: "bg-sky-100 text-sky-800 dark:bg-sky-500/15 dark:text-sky-300",
  received: "bg-[#F0A71F]/20 text-[#8a5a00] dark:text-[#F0A71F]",
  failed: "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300",
  blocked: "bg-slate-200 text-slate-700 dark:bg-white/10 dark:text-white/70",
};

export function AdminTexts({ eventId }: { eventId: number }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data, isLoading } = useQuery<People>({ queryKey: ["/api/admin/sms/people", eventId], queryFn: () => adminGet(`/api/admin/sms/people?eventId=${eventId}`) });
  const { data: log } = useQuery<Msg[]>({ queryKey: ["/api/admin/sms/log", eventId], queryFn: () => adminGet(`/api/admin/sms/log?eventId=${eventId}`), refetchInterval: 10_000 });
  const [text, setText] = useState(PRESETS[0].text);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const people = data?.people ?? [];
  const reachable = people.filter((p) => p.textable && !p.optedOut);
  const preview = useMemo(() => {
    const first = people.find((p) => picked.has(p.key));
    return text.replace(/\{name\}/gi, first?.name.split(/\s+/)[0] || "Sam").replace(/\{link\}/gi, data?.studioLink ?? "").replace(/\{show\}/gi, first?.show ?? "");
  }, [text, picked, people, data?.studioLink]);

  const toggle = (k: string) => setPicked((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const send = async () => {
    setBusy(true);
    try {
      const r = (await (await adminSend("POST", "/api/admin/sms/send", { eventId, keys: Array.from(picked), text })).json()) as { sent: number; results: { name: string; ok: boolean; error: string }[] };
      const failed = r.results.filter((x) => !x.ok);
      toast({
        title: r.sent ? `Texted ${r.sent} ${r.sent === 1 ? "person" : "people"}` : "Nothing was sent",
        description: failed.length ? failed.map((f) => `${f.name}: ${f.error}`).join(" · ") : undefined,
        variant: failed.length && !r.sent ? "destructive" : "default",
      });
      if (r.sent) setPicked(new Set());
      qc.invalidateQueries({ queryKey: ["/api/admin/sms/log", eventId] });
    } catch (e) {
      toast({ title: "Couldn't send", description: (e as Error).message, variant: "destructive" });
    }
    setBusy(false);
  };

  if (isLoading || !data) return <p className="p-4 text-sm text-muted-foreground">Loading…</p>;
  return (
    <div className="max-w-5xl space-y-5" data-testid="admin-texts">
      <div className="rounded-2xl border border-border bg-card p-5">
        <p className="text-xs font-bold uppercase tracking-wider text-[#8a5a00]">Show-day texts</p>
        <h2 className="mt-1 text-2xl font-bold text-[#000741] dark:text-white">Text the lineup</h2>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          For the moments email is too slow: "you're on in 10", the green room link. Every text starts with MilitaryVoices.ai, the first one tells them how to stop, and a STOP reply is honoured for good. Replies show up below and in Slack.
        </p>
        {!data.configured && (
          <div className="mt-4 flex gap-3 rounded-xl border border-[#F0A71F]/50 bg-[#F0A71F]/10 p-4 text-sm" data-testid="texts-not-configured">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-[#b07800]" />
            <p>
              <span className="font-semibold">Texting isn't switched on yet.</span> It needs a verified toll-free number on Telnyx and its keys in Vercel. You can line up texts here; nothing goes out until it's on.
            </p>
          </div>
        )}
        {data.configured && <p className="mt-3 text-xs text-muted-foreground">Sending from {data.from}</p>}
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <div className="rounded-2xl border border-border bg-card p-5">
          <h3 className="text-base font-semibold">1. What to say</h3>
          <div className="mt-3 flex flex-wrap gap-2">
            {PRESETS.map((p) => (
              <button key={p.label} type="button" onClick={() => setText(p.text)} className={`rounded-full border px-3 py-1 text-sm transition ${text === p.text ? "border-[#053877] bg-[#053877] text-white" : "border-border hover:bg-muted"}`} data-testid={`texts-preset-${p.label}`}>
                {p.label}
              </button>
            ))}
          </div>
          <Textarea className="mt-3" rows={4} value={text} onChange={(e) => setText(e.target.value)} maxLength={600} data-testid="texts-body" />
          <p className="mt-1 text-xs text-muted-foreground">{"{name}"} is their first name, {"{link}"} the green room. {text.length}/600</p>
          <div className="mt-4 rounded-2xl bg-muted/60 p-3">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">They'll see</p>
            <p className="mt-1 whitespace-pre-wrap rounded-2xl rounded-tl-sm bg-card px-3 py-2 text-sm shadow-sm">MilitaryVoices.ai: {preview}</p>
          </div>
          <Button className="mt-4 w-full gap-2" size="lg" disabled={busy || !picked.size || !text.trim()} onClick={send} data-testid="texts-send">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            {picked.size ? `Text ${picked.size} ${picked.size === 1 ? "person" : "people"}` : "Pick who gets it"}
          </Button>
        </div>

        <div className="rounded-2xl border border-border bg-card p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-base font-semibold">2. Who gets it</h3>
            <span className="text-xs text-muted-foreground">{reachable.length} of {people.length} have a mobile</span>
          </div>
          <div className="mt-3 max-h-[28rem] divide-y divide-border overflow-y-auto rounded-xl border border-border">
            {people.map((p) => {
              const can = p.textable && !p.optedOut;
              return (
                <label key={p.key} className={`flex items-center gap-3 px-3 py-2.5 ${can ? "cursor-pointer hover:bg-muted/50" : "opacity-55"}`} data-testid={`texts-person-${p.key}`}>
                  <input type="checkbox" className="h-4 w-4 accent-[#053877]" disabled={!can} checked={picked.has(p.key)} onChange={() => toggle(p.key)} />
                  <span className="w-16 shrink-0 text-xs tabular-nums text-muted-foreground">{time(p.slotAt)}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{p.name}{p.role === "cohost" ? <span className="font-normal text-muted-foreground"> · co-host</span> : ""}</span>
                    <span className="block truncate text-xs text-muted-foreground">{p.show}</span>
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">{p.optedOut ? "Opted out" : p.textable ? p.phone : "No mobile"}</span>
                </label>
              );
            })}
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-card p-5">
        <h3 className="text-base font-semibold">Sent and received</h3>
        {!log?.length ? (
          <p className="mt-2 text-sm text-muted-foreground">No texts yet.</p>
        ) : (
          <ul className="mt-3 divide-y divide-border">
            {log.map((m) => (
              <li key={m.id} className="flex gap-3 py-2.5 text-sm">
                {m.direction === "in" ? <ArrowDownLeft className="mt-0.5 h-4 w-4 shrink-0 text-[#b36b00]" aria-label="Came in" /> : <ArrowUpRight className="mt-0.5 h-4 w-4 shrink-0 text-[#053877] dark:text-[#8fb5e8]" aria-label="We sent" />}
                <span className="min-w-0 flex-1">
                  <span className="font-medium">{m.name || m.phone}</span> <span className="text-xs text-muted-foreground">{when(m.createdAt)}</span>
                  <span className="block text-muted-foreground">{m.body}</span>
                  {m.error && <span className="block text-xs text-red-600">{m.error}</span>}
                </span>
                <span className={`h-fit shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold capitalize ${STATUS[m.status] ?? STATUS.sent}`}>{m.status}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><Smartphone className="h-3.5 w-3.5" /> Numbers come from each person's profile or booking. Ask anyone missing one to add their mobile in Profile.</p>
    </div>
  );
}
