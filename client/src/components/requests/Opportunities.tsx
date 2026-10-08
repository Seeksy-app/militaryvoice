import { useState } from "react";
import { useLocation } from "wouter";
import { showGuide } from "@/components/Guide";
import { STEP_GUIDE } from "@/components/NextSteps";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Globe, Inbox, Mail, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { REQUEST_KINDS } from "@shared/schema";
import { money } from "@/components/requests/BrandRequests";

// A creator's Opportunities (7 Oct): requests brands sent them. Read it, say
// you're interested (with your rate) or pass, ask a question; once the brand
// connects, you see their email. Yours stays private until then.

type Msg = { id: number; side: string; body: string; createdAt: string };
type Opp = {
  id: number; status: string; rate: string; seen: boolean; createdAt: string;
  request: { kind: string; title: string; details: string; timing: string; budgetLow: number; budgetHigh: number; open: boolean } | null;
  brand: { name: string; logoUrl: string; website: string; about: string } | null;
  brandEmail: string; messages: Msg[];
};
const when = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });

export function Opportunities() {
  const [, navigate] = useLocation();
  const q = useQuery<Opp[]>({ queryKey: ["/api/host/opportunities"], queryFn: async () => (await apiRequest("GET", "/api/host/opportunities")).json() });
  const list = q.data ?? [];
  return (
    <section className="mt-6 max-w-3xl space-y-5" data-testid="opportunities">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Opportunities</h1>
        <p className="mt-1 text-sm text-muted-foreground">Requests from brands. Say you're interested with your rate, or pass. Your email stays private until they connect with you.</p>
      </div>
      {!q.isLoading && list.length === 0 && (
        <div className="rounded-2xl border border-dashed border-border p-10 text-center">
          <Inbox className="mx-auto h-6 w-6 text-muted-foreground" />
          <p className="mt-2 font-medium">Nothing yet</p>
          <p className="mt-1 text-sm text-muted-foreground">Turn on Let brands find me in your Profile, and add a media kit to your SmartLink, so brands can find you.</p>
          {/* The way there, not just the words (8 Oct): the switch, with the pointer on it. */}
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            <Button className="rounded-full bg-[#053877] text-white hover:bg-[#0a4a99]" onClick={() => { navigate("/host/dashboard/profile"); if (STEP_GUIDE.brands) showGuide([STEP_GUIDE.brands]); }} data-testid="opps-turn-on">Let brands find me</Button>
            <Button variant="outline" className="rounded-full" onClick={() => navigate("/host/dashboard/page")} data-testid="opps-media-kit">Open my SmartLink</Button>
          </div>
        </div>
      )}
      {list.map((o) => <OppCard key={o.id} o={o} />)}
    </section>
  );
}

function OppCard({ o }: { o: Opp }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [rate, setRate] = useState(o.rate);
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState("");
  const [answering, setAnswering] = useState(false);
  const [busy, setBusy] = useState(false);
  const refresh = () => void qc.invalidateQueries({ queryKey: ["/api/host/opportunities"] });
  const act = async (fn: () => Promise<unknown>, ok?: string) => {
    setBusy(true);
    try { await fn(); if (ok) toast({ title: ok }); refresh(); } catch (e) { toast({ title: "Didn't work", description: (e as Error).message, variant: "destructive" }); }
    setBusy(false);
  };
  const r = o.request;
  if (!r) return null;
  return (
    <article className={`overflow-hidden rounded-2xl border bg-card ${o.status === "new" ? "border-2 border-[#F0A71F]/60" : "border-border"}`} data-testid={`opp-${o.id}`}>
      <header className="flex items-start gap-4 p-5">
        {o.brand?.logoUrl ? <img src={o.brand.logoUrl} alt="" className="h-12 w-12 shrink-0 rounded-xl border border-border bg-white object-contain p-1" /> : <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-[#053877] font-bold text-white">{o.brand?.name.charAt(0)}</span>}
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">{o.brand?.name} · {REQUEST_KINDS[r.kind as keyof typeof REQUEST_KINDS] ?? r.kind} · {when(o.createdAt)}</p>
          <h2 className="mt-1 text-lg font-semibold">{r.title}</h2>
          <p className="mt-1 text-sm font-medium">{[r.timing, money(r.budgetLow, r.budgetHigh)].filter(Boolean).join(" · ")}</p>
          {o.brand?.website && <a href={o.brand.website} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-xs text-muted-foreground hover:underline"><Globe className="h-3 w-3" />{o.brand.website.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "")}</a>}
        </div>
        <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold ${o.status === "connected" ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300" : o.status === "interested" ? "bg-[#F0A71F]/20 text-[#8a5a00] dark:text-[#F0A71F]" : o.status === "declined" ? "bg-muted text-muted-foreground" : "bg-[#053877] text-white"}`}>
          {o.status === "connected" ? "Connected" : o.status === "interested" ? "You're interested" : o.status === "declined" ? "You passed" : "New"}
        </span>
      </header>
      <div className="space-y-4 border-t border-border p-5">
        <p className="whitespace-pre-wrap text-sm leading-relaxed">{r.details}</p>
        {o.brand?.about && <p className="text-xs text-muted-foreground">About {o.brand.name}: {o.brand.about}</p>}

        {o.status === "connected" && o.brandEmail && (
          <p className="flex items-center gap-2 rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-900 dark:bg-emerald-500/10 dark:text-emerald-200"><Mail className="h-4 w-4" /> You're connected. Reach them at <a href={`mailto:${o.brandEmail}`} className="font-semibold underline">{o.brandEmail}</a></p>
        )}

        {/* Answer */}
        {o.status === "new" && r.open && !answering && (
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => setAnswering(true)} className="gap-1.5 rounded-full bg-[#053877] text-white hover:bg-[#0a4a99]" data-testid={`opp-yes-${o.id}`}><Check className="h-4 w-4" /> I'm interested</Button>
            <Button variant="outline" disabled={busy} onClick={() => void act(() => apiRequest("POST", `/api/host/opportunities/${o.id}`, { answer: "declined" }), "Passed")} className="gap-1.5 rounded-full"><X className="h-4 w-4" /> Not for me</Button>
          </div>
        )}
        {o.status === "new" && !r.open && <p className="text-sm text-muted-foreground">The brand closed this request.</p>}
        {answering && (
          <form className="space-y-3 rounded-xl border border-border p-4" onSubmit={(e) => { e.preventDefault(); void act(() => apiRequest("POST", `/api/host/opportunities/${o.id}`, { answer: "interested", rate, note }), "They'll see you're interested").then(() => setAnswering(false)); }}>
            <label className="block text-sm font-medium">Your rate <span className="font-normal text-muted-foreground">(optional)</span><Input value={rate} onChange={(e) => setRate(e.target.value)} placeholder="$400 for a 60-second read" className="mt-1" data-testid={`opp-rate-${o.id}`} /></label>
            <label className="block text-sm font-medium">A note to them <span className="font-normal text-muted-foreground">(optional)</span><Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} placeholder="Why it fits your audience, a question, your availability" className="mt-1" /></label>
            <div className="flex gap-2"><Button type="submit" disabled={busy} className="rounded-full bg-[#053877] text-white hover:bg-[#0a4a99]">Send</Button><Button type="button" variant="ghost" onClick={() => setAnswering(false)}>Cancel</Button></div>
          </form>
        )}

        {/* Thread */}
        {o.messages.length > 0 && (
          <ul className="space-y-2">
            {o.messages.map((m) => (
              <li key={m.id} className={`rounded-xl px-3 py-2 text-sm ${m.side === "creator" ? "ml-8 bg-[#053877]/[0.07]" : m.side === "team" ? "bg-emerald-50 text-emerald-900 dark:bg-emerald-500/10 dark:text-emerald-200" : "mr-8 bg-muted"}`}>
                <span className="mb-0.5 block text-[11px] font-semibold text-muted-foreground">{m.side === "creator" ? "You" : m.side === "team" ? "MilitaryVoices" : o.brand?.name} · {when(m.createdAt)}</span>
                <span className="whitespace-pre-wrap">{m.body}</span>
              </li>
            ))}
          </ul>
        )}
        {o.status !== "declined" && (
          <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (msg.trim()) void act(() => apiRequest("POST", `/api/host/opportunities/${o.id}/messages`, { body: msg })).then(() => setMsg("")); }}>
            <Textarea value={msg} onChange={(e) => setMsg(e.target.value)} rows={1} placeholder={`Ask ${o.brand?.name ?? "them"} a question`} className="min-h-[40px] text-sm" />
            <Button type="submit" size="sm" disabled={busy || !msg.trim()} className="self-end">Send</Button>
          </form>
        )}
      </div>
    </article>
  );
}
