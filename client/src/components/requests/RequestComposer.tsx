import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Send, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { REQUEST_KINDS } from "@shared/schema";

// Write a request to creators (7 Oct): one sentence and SI drafts it, or write
// it yourself; send it to the creator you're looking at, or a saved list.
// Only creators on MilitaryVoices can get one; the rest of a list is skipped.

export type Pick = { profileId?: number; signupId?: number; name: string; picture?: string; show?: string };
type List = { id: number; name: string; items: { handle: string; snapshot: { profileId?: number; signupId?: number } }[] };

const onPlatform = (it: List["items"][number]) => /^(member|signup)-\d+$/.test(it.handle) || !!it.snapshot?.profileId || !!it.snapshot?.signupId;

export function RequestComposer({ creators = [], onClose, onSent, pending }: { creators?: Pick[]; onClose: () => void; onSent?: () => void; pending?: boolean }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const lists = useQuery<List[]>({ queryKey: ["/api/discover/lists"], queryFn: async () => (await apiRequest("GET", "/api/discover/lists")).json(), retry: false });
  const [idea, setIdea] = useState("");
  const [drafting, setDrafting] = useState(false);
  const [kind, setKind] = useState<string>("sponsor");
  const [title, setTitle] = useState("");
  const [details, setDetails] = useState("");
  const [timing, setTiming] = useState("");
  const [low, setLow] = useState("");
  const [high, setHigh] = useState("");
  const [picked, setPicked] = useState<Pick[]>(creators);
  const [listId, setListId] = useState<number | null>(null);
  const [sending, setSending] = useState(false);
  const usable = useMemo(() => (lists.data ?? []).map((l) => ({ ...l, count: l.items.filter(onPlatform).length })), [lists.data]);
  const list = usable.find((l) => l.id === listId);
  const total = picked.length + (list?.count ?? 0);

  const draft = async () => {
    setDrafting(true);
    try {
      const d = (await (await apiRequest("POST", "/api/brand/requests/draft", { idea })).json()) as { kind: string; title: string; details: string; timing: string; budgetLow: number; budgetHigh: number };
      setKind(d.kind); setTitle(d.title); setDetails(d.details); setTiming(d.timing);
      if (d.budgetLow) setLow(String(d.budgetLow)); if (d.budgetHigh) setHigh(String(d.budgetHigh));
    } catch (e) { toast({ title: "Couldn't draft it", description: (e as Error).message, variant: "destructive" }); }
    setDrafting(false);
  };
  const send = async () => {
    setSending(true);
    try {
      const r = (await (await apiRequest("POST", "/api/brand/requests", {
        kind, title, details, timing, budgetLow: Number(low) || 0, budgetHigh: Number(high) || 0,
        creators: picked.map((p) => ({ profileId: p.profileId, signupId: p.signupId })), listId,
      })).json()) as { sent: number; skipped: number };
      toast({ title: `Sent to ${r.sent} ${r.sent === 1 ? "creator" : "creators"}`, description: r.skipped ? `${r.skipped} on the list aren't on MilitaryVoices yet, so they were skipped.` : "You'll see their answers under Requests." });
      void qc.invalidateQueries({ queryKey: ["/api/brand/requests"] });
      onSent?.(); onClose();
    } catch (e) { toast({ title: "Not sent", description: (e as Error).message, variant: "destructive" }); }
    setSending(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:p-8" onClick={onClose} data-testid="request-composer">
      <div className="w-full max-w-2xl rounded-3xl bg-background p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-2xl font-bold tracking-tight">Send a request</h2>
            <p className="mt-1 text-sm text-muted-foreground">They answer in their inbox here, with their rate. Your email stays private until you connect.</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-full p-2 text-muted-foreground hover:bg-muted" aria-label="Close"><X className="h-5 w-5" /></button>
        </div>

        {pending && <p className="mt-4 rounded-xl bg-[#F0A71F]/15 px-4 py-3 text-sm text-[#8a5a00] dark:text-[#F0A71F]">We're still checking your brand. You can write it now; sending opens once we've approved you, usually within a day.</p>}

        {/* SI writes it from a sentence */}
        <div className="mt-5 rounded-2xl border border-[#053877]/20 bg-[#053877]/[0.03] p-4">
          <label htmlFor="rq-idea" className="flex items-center gap-1.5 text-sm font-semibold"><Sparkles className="h-4 w-4 text-[#F0A71F]" /> Tell us in a sentence</label>
          <div className="mt-2 flex gap-2">
            <Input id="rq-idea" value={idea} onChange={(e) => setIdea(e.target.value)} placeholder="A 60-second read for our new boot in November episodes, about $500" className="h-10" data-testid="rq-idea" />
            <Button type="button" onClick={() => void draft()} disabled={drafting || idea.trim().length < 8} className="h-10 shrink-0 gap-1.5 rounded-full bg-[#053877] text-white hover:bg-[#0a4a99]" data-testid="rq-draft">{drafting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Write it for me"}</Button>
          </div>
        </div>

        <div className="mt-5 space-y-4">
          <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="What it is">
            {Object.entries(REQUEST_KINDS).map(([k, l]) => (
              <button key={k} type="button" role="radio" aria-checked={kind === k} onClick={() => setKind(k)} className={`rounded-full border px-3 py-1.5 text-sm ${kind === k ? "border-[#053877] bg-[#053877] font-semibold text-white" : "border-border hover:border-[#053877]/40"}`}>{l}</button>
            ))}
          </div>
          <label className="block text-sm font-medium">Title<Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Sponsored read: our new trail boot" className="mt-1" data-testid="rq-title" /></label>
          <label className="block text-sm font-medium">What you'd like<Textarea value={details} onChange={(e) => setDetails(e.target.value)} rows={5} placeholder="What you want, what they'd do, anything they must say, and why their audience fits." className="mt-1" data-testid="rq-details" /></label>
          <div className="grid gap-3 sm:grid-cols-[1fr_8rem_8rem]">
            <label className="block text-sm font-medium">When<Input value={timing} onChange={(e) => setTiming(e.target.value)} placeholder="November" className="mt-1" /></label>
            <label className="block text-sm font-medium">Budget from<Input value={low} onChange={(e) => setLow(e.target.value.replace(/[^\d]/g, ""))} inputMode="numeric" placeholder="$" className="mt-1" /></label>
            <label className="block text-sm font-medium">to<Input value={high} onChange={(e) => setHigh(e.target.value.replace(/[^\d]/g, ""))} inputMode="numeric" placeholder="$" className="mt-1" /></label>
          </div>
        </div>

        {/* Who */}
        <div className="mt-5">
          <p className="text-sm font-semibold">Who it goes to</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {picked.map((p) => (
              <span key={`${p.profileId ?? ""}-${p.signupId ?? ""}`} className="inline-flex items-center gap-2 rounded-full border border-border py-1 pl-1 pr-2 text-sm">
                {p.picture ? <img src={p.picture} alt="" className="h-6 w-6 rounded-full object-cover" /> : <span className="h-6 w-6 rounded-full bg-muted" />}
                {p.name}
                <button type="button" onClick={() => setPicked((v) => v.filter((x) => x !== p))} className="text-muted-foreground hover:text-foreground" aria-label={`Remove ${p.name}`}><X className="h-3.5 w-3.5" /></button>
              </span>
            ))}
            {usable.length > 0 && (
              <select value={listId ?? ""} onChange={(e) => setListId(Number(e.target.value) || null)} className="h-9 rounded-full border border-input bg-background px-3 text-sm" aria-label="Add a saved list" data-testid="rq-list">
                <option value="">{picked.length ? "+ a saved list" : "Pick a saved list"}</option>
                {usable.map((l) => <option key={l.id} value={l.id}>{l.name} ({l.count} on MilitaryVoices)</option>)}
              </select>
            )}
          </div>
          {!picked.length && !usable.length && <p className="mt-2 text-sm text-muted-foreground">Open a creator in Find creators and press Send a request, or save creators to a list first.</p>}
        </div>

        <div className="mt-6 flex items-center justify-between gap-3">
          <span className="text-sm text-muted-foreground">{total ? `${total} ${total === 1 ? "creator" : "creators"}` : ""}</span>
          <Button onClick={() => void send()} disabled={pending || sending || !title.trim() || details.trim().length < 20 || !total} className="h-11 gap-2 rounded-full bg-[#F0A71F] px-6 font-semibold text-[#1a1200] hover:bg-[#f5b944]" data-testid="rq-send">
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Send request
          </Button>
        </div>
      </div>
    </div>
  );
}
