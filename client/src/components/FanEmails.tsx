import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Mail, Plus, Trash2, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { CampaignBuilder } from "@/components/CampaignBuilder";

type Campaign = { id: number; subject: string; preheader: string; bodyText: string; status: "draft" | "scheduled" | "sending" | "sent"; scheduledFor: string; recipientCount: number; sentCount: number; sentAt: string; updatedAt: string; opened?: number; clicked?: number };
type Data = { showName: string; hasPage: boolean; audience: number; sample: { email: string; name: string }[]; campaigns: Campaign[] };

const pct = (n = 0, of = 0) => (of ? `${Math.round((n / of) * 100)}%` : "–");
const when = (iso: string) => new Date(iso).toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/**
 * Email your fans: the people who signed up on your SmartLink. Write it with the same
 * blocks and live preview as any email here; it goes from "<Your show> via
 * MilitaryVoices.ai", replies come to you, and each fan can unsubscribe from your list.
 */
export function FanEmails() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const q = useQuery<Data>({ queryKey: ["/api/host/campaigns"], queryFn: async () => (await apiRequest("GET", "/api/host/campaigns")).json(), refetchInterval: (x) => ((x.state.data as Data | undefined)?.campaigns.some((c) => c.status === "sending") ? 10_000 : false) });
  const [open, setOpen] = useState<Campaign | "new" | null>(null);

  if (q.isLoading || !q.data) return <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  const d = q.data;

  if (open) {
    const c = open === "new" ? null : open;
    return (
      <CampaignBuilder
        key={c?.id ?? "new"}
        eventId={0}
        initial={c ? { id: c.id, subject: c.subject, bodyText: c.bodyText, preheader: c.preheader, segment: "", sender: "", banner: "", status: c.status, scheduledFor: c.scheduledFor || null } : null}
        segmentOptions={[]}
        teamMembers={[]}
        creator={{ showName: d.showName, audience: d.audience, sample: d.sample }}
        onClose={() => { setOpen(null); void qc.invalidateQueries({ queryKey: ["/api/host/campaigns"] }); }}
      />
    );
  }

  const remove = async (c: Campaign) => {
    if (!window.confirm(`Delete "${c.subject || "this draft"}"?`)) return;
    try { await apiRequest("DELETE", `/api/host/campaigns/${c.id}`); void qc.invalidateQueries({ queryKey: ["/api/host/campaigns"] }); }
    catch (e) { toast({ title: "Couldn't delete it", description: (e as Error).message, variant: "destructive" }); }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-5" data-testid="fan-emails">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Email your fans</h1>
          <p className="mt-1 text-sm text-muted-foreground">Write to everyone who signed up on your SmartLink. It comes from {d.showName} via MilitaryVoices.ai, and replies come to you.</p>
        </div>
        {d.audience > 0 && <Button onClick={() => setOpen("new")} className="gap-1.5 rounded-full bg-[#053877] text-white hover:bg-[#0a4a99]" data-testid="fans-new"><Plus className="h-4 w-4" /> New email</Button>}
      </div>

      <section className="flex items-center gap-4 rounded-2xl border border-border bg-card p-5 shadow-sm">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[#053877]/10 text-[#053877] dark:text-white"><Users className="h-6 w-6" /></span>
        <div className="min-w-0 flex-1">
          <p className="text-2xl font-bold tabular-nums">{d.audience}</p>
          <p className="text-sm text-muted-foreground">{d.audience === 1 ? "fan has" : "fans have"} signed up on your SmartLink{d.audience ? "" : " yet"}.</p>
        </div>
        {d.audience === 0 && <a href="/host/dashboard/page" className="shrink-0 text-sm font-semibold text-[#053877] hover:underline dark:text-white">{d.hasPage ? "Add a Stay in touch block" : "Make your SmartLink"} →</a>}
      </section>

      {d.campaigns.length > 0 ? (
        <ul className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
          {d.campaigns.map((c) => {
            const editable = c.status === "draft" || c.status === "scheduled";
            const line = c.status === "sent" ? `Sent ${when(c.sentAt)} · ${c.sentCount} people · ${pct(c.opened, c.sentCount)} opened · ${pct(c.clicked, c.sentCount)} clicked`
              : c.status === "sending" ? `Sending: ${c.sentCount} of ${c.recipientCount}`
              : c.status === "scheduled" ? `Goes out ${when(c.scheduledFor)}`
              : `Draft · ${when(c.updatedAt || new Date().toISOString())}`;
            return (
              <li key={c.id} className="flex items-center gap-3 border-b border-border px-4 py-3 last:border-0">
                <Mail className="h-5 w-5 shrink-0 text-muted-foreground" />
                <button type="button" disabled={!editable} onClick={() => setOpen(c)} className="min-w-0 flex-1 text-left disabled:cursor-default">
                  <span className={`block truncate font-semibold ${editable ? "hover:underline" : ""}`}>{c.subject || "Untitled"}</span>
                  <span className="block truncate text-sm text-muted-foreground">{line}</span>
                </button>
                {c.status === "sending" && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
                {editable && <button type="button" onClick={() => void remove(c)} className="rounded p-1.5 text-muted-foreground hover:text-destructive" aria-label="Delete"><Trash2 className="h-4 w-4" /></button>}
              </li>
            );
          })}
        </ul>
      ) : d.audience > 0 ? (
        <button type="button" onClick={() => setOpen("new")} className="w-full rounded-2xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground hover:border-[#053877] hover:bg-accent">Write your first email to your fans →</button>
      ) : null}
      <p className="text-xs text-muted-foreground">One email a day to your list, so your fans hear from you, not at you. Anyone can unsubscribe from your emails in one click.</p>
    </div>
  );
}
