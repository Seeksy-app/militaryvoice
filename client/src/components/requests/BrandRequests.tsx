import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronDown, Handshake, Mail, Plus, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { REQUEST_KINDS } from "@shared/schema";
import { RequestComposer } from "@/components/requests/RequestComposer";

// A brand's requests (7 Oct): what they sent, who answered, their rates, a
// thread with each creator, and Connect, which shares emails both ways.

type Msg = { id: number; side: string; body: string; createdAt: string };
type Rcpt = { id: number; name: string; show: string; picture: string; status: string; rate: string; seenAt: string; respondedAt: string; connectedAt: string; email: string; messages: Msg[] };
type Req = { id: number; kind: string; title: string; details: string; timing: string; budgetLow: number; budgetHigh: number; status: string; createdAt: string; recipients: Rcpt[] };
type Data = { orgs: { id: number; name: string; status: string }[]; requests: Req[] };

const STATUS: Record<string, { label: string; tone: string }> = {
  new: { label: "Not answered", tone: "bg-muted text-muted-foreground" },
  interested: { label: "Interested", tone: "bg-[#F0A71F]/20 text-[#8a5a00] dark:text-[#F0A71F]" },
  declined: { label: "Passed", tone: "bg-muted text-muted-foreground line-through" },
  connected: { label: "Connected", tone: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300" },
};
export const money = (lo: number, hi: number) => (lo && hi && lo === hi ? `$${lo.toLocaleString()}` : lo && hi ? `$${lo.toLocaleString()} to $${hi.toLocaleString()}` : lo ? `From $${lo.toLocaleString()}` : hi ? `Up to $${hi.toLocaleString()}` : "");
const when = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });

export function BrandRequests() {
  const q = useQuery<Data>({ queryKey: ["/api/brand/requests"], queryFn: async () => (await apiRequest("GET", "/api/brand/requests")).json() });
  const [composing, setComposing] = useState(false);
  const pending = !!q.data && q.data.orgs.length > 0 && !q.data.orgs.some((o) => o.status === "approved");
  const reqs = q.data?.requests ?? [];
  return (
    <section className="mt-6 max-w-4xl space-y-5" data-testid="brand-requests">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Requests</h1>
          <p className="mt-1 text-sm text-muted-foreground">What you've asked creators for, and their answers. Their email shows once you connect.</p>
        </div>
        <Button onClick={() => setComposing(true)} className="gap-1.5 rounded-full bg-[#053877] text-white hover:bg-[#0a4a99]" data-testid="new-request"><Plus className="h-4 w-4" /> New request</Button>
      </div>
      {pending && <p className="rounded-xl bg-[#F0A71F]/15 px-4 py-3 text-sm text-[#8a5a00] dark:text-[#F0A71F]">We're checking your brand. Requests send as soon as we've approved it, usually within a day.</p>}
      {!q.isLoading && reqs.length === 0 && (
        <div className="rounded-2xl border border-dashed border-border p-10 text-center">
          <Send className="mx-auto h-6 w-6 text-muted-foreground" />
          <p className="mt-2 font-medium">No requests yet</p>
          <p className="mt-1 text-sm text-muted-foreground">Open a creator in Find creators and press Send a request, or send one to a saved list.</p>
        </div>
      )}
      {reqs.map((r) => <RequestCard key={r.id} r={r} />)}
      {composing && <RequestComposer pending={pending} onClose={() => setComposing(false)} />}
    </section>
  );
}

function RequestCard({ r }: { r: Req }) {
  const [open, setOpen] = useState(true);
  const count = (s: string) => r.recipients.filter((x) => x.status === s).length;
  return (
    <article className="overflow-hidden rounded-2xl border border-border bg-card" data-testid={`request-${r.id}`}>
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex w-full items-start gap-3 p-5 text-left">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">{REQUEST_KINDS[r.kind as keyof typeof REQUEST_KINDS] ?? r.kind} · sent {when(r.createdAt)}{r.status === "closed" ? " · closed" : ""}</p>
          <h2 className="mt-1 text-lg font-semibold">{r.title}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{[r.timing, money(r.budgetLow, r.budgetHigh)].filter(Boolean).join(" · ")}</p>
          <p className="mt-2 text-sm">{r.recipients.length} sent · <b>{count("interested") + count("connected")}</b> interested · {count("connected")} connected · {count("declined")} passed</p>
        </div>
        <ChevronDown className={`mt-1 h-5 w-5 shrink-0 text-muted-foreground transition ${open ? "rotate-180" : ""}`} />
      </button>
      {open && <ul className="divide-y divide-border border-t border-border">{r.recipients.map((x) => <RecipientRow key={x.id} x={x} />)}</ul>}
    </article>
  );
}

function RecipientRow({ x }: { x: Rcpt }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const st = STATUS[x.status] ?? STATUS.new;
  const refresh = () => void qc.invalidateQueries({ queryKey: ["/api/brand/requests"] });
  const act = async (fn: () => Promise<unknown>, ok?: string) => {
    setBusy(true);
    try { await fn(); if (ok) toast({ title: ok }); refresh(); } catch (e) { toast({ title: "Didn't work", description: (e as Error).message, variant: "destructive" }); }
    setBusy(false);
  };
  return (
    <li className="p-4 sm:px-5" data-testid={`recipient-${x.id}`}>
      <div className="flex flex-wrap items-center gap-3">
        {x.picture ? <img src={x.picture} alt="" className="h-10 w-10 rounded-full object-cover" /> : <span className="h-10 w-10 rounded-full bg-muted" />}
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">{x.name}</p>
          <p className="truncate text-xs text-muted-foreground">{x.show}{x.status === "new" ? (x.seenAt ? " · seen" : " · not opened yet") : ""}</p>
        </div>
        {x.rate && <span className="text-sm font-semibold">{x.rate}</span>}
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${st.tone}`}>{st.label}</span>
        {x.status === "interested" && (
          <Button size="sm" disabled={busy} onClick={() => void act(() => apiRequest("POST", `/api/brand/recipients/${x.id}/connect`), `You're connected with ${x.name}`)} className="gap-1.5 rounded-full bg-[#15834f] text-white hover:bg-[#126e42]" data-testid={`connect-${x.id}`}><Handshake className="h-4 w-4" /> Connect</Button>
        )}
        {x.status === "connected" && x.email && <a href={`mailto:${x.email}`} className="inline-flex items-center gap-1 text-sm font-semibold text-[#053877] hover:underline dark:text-[#9cc2ff]"><Mail className="h-4 w-4" /> {x.email}</a>}
      </div>
      {x.messages.length > 0 && (
        <ul className="mt-3 space-y-2 sm:pl-[52px]">
          {x.messages.map((m) => (
            <li key={m.id} className={`rounded-xl px-3 py-2 text-sm ${m.side === "brand" ? "ml-8 bg-[#053877]/[0.07]" : m.side === "team" ? "bg-emerald-50 text-emerald-900 dark:bg-emerald-500/10 dark:text-emerald-200" : "mr-8 bg-muted"}`}>
              <span className="mb-0.5 block text-[11px] font-semibold text-muted-foreground">{m.side === "brand" ? "You" : m.side === "team" ? "MilitaryVoices" : x.name} · {when(m.createdAt)}</span>
              <span className="whitespace-pre-wrap">{m.body}</span>
            </li>
          ))}
        </ul>
      )}
      {(x.status === "interested" || x.status === "connected") && (
        <form className="mt-3 flex gap-2 sm:pl-[52px]" onSubmit={(e) => { e.preventDefault(); if (msg.trim()) void act(() => apiRequest("POST", `/api/brand/recipients/${x.id}/messages`, { body: msg })).then(() => setMsg("")); }}>
          <Textarea value={msg} onChange={(e) => setMsg(e.target.value)} rows={1} placeholder={`Write to ${x.name.split(" ")[0]}`} className="min-h-[40px] text-sm" />
          <Button type="submit" size="sm" disabled={busy || !msg.trim()} className="self-end"><Check className="h-4 w-4" /></Button>
        </form>
      )}
    </li>
  );
}
