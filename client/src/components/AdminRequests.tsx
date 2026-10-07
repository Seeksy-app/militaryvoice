import { useQuery, useQueryClient } from "@tanstack/react-query";
import { adminGet, adminSend } from "@/lib/adminApi";
import { Switch } from "@/components/ui/switch";
import { REQUEST_KINDS } from "@shared/schema";

// Every brand request on the platform (7 Oct), who it went to, and where each
// stands; plus the owner's switch for the "a brand sent you a request" email.

type Row = { id: number; org: string; kind: string; title: string; status: string; createdAt: string; recipients: { id: number; name: string; email: string; status: string; rate: string; seen: boolean }[] };
const TONE: Record<string, string> = { new: "bg-muted text-muted-foreground", interested: "bg-[#F0A71F]/20 text-[#8a5a00]", declined: "bg-muted text-muted-foreground line-through", connected: "bg-emerald-100 text-emerald-800" };

export function AdminRequests() {
  const qc = useQueryClient();
  const q = useQuery<{ emailsOn: boolean; requests: Row[] }>({ queryKey: ["/api/admin/requests"], queryFn: () => adminGet("/api/admin/requests") });
  const setEmails = async (on: boolean) => { await adminSend("POST", "/api/admin/requests/emails", { on }); void qc.invalidateQueries({ queryKey: ["/api/admin/requests"] }); };
  const rows = q.data?.requests ?? [];
  return (
    <div className="space-y-5" data-testid="admin-requests">
      <label className="flex items-start gap-3 rounded-2xl border border-border bg-card p-4">
        <Switch checked={!!q.data?.emailsOn} onCheckedChange={(v) => void setEmails(v)} className="mt-0.5" />
        <span className="text-sm"><span className="block font-semibold">Email creators when a brand sends them a request</span><span className="text-muted-foreground">"[Brand] sent you a request on MilitaryVoices.ai", with a link to their Opportunities. Off: they only see it on their dashboard.</span></span>
      </label>
      {rows.length === 0 ? <p className="rounded-2xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">No requests yet.</p> : (
        <ul className="space-y-3">
          {rows.map((r) => (
            <li key={r.id} className="rounded-2xl border border-border bg-card p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">{r.org} · {REQUEST_KINDS[r.kind as keyof typeof REQUEST_KINDS] ?? r.kind} · {new Date(r.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}{r.status === "closed" ? " · closed" : ""}</p>
              <p className="mt-1 font-semibold">{r.title}</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {r.recipients.map((x) => <span key={x.id} className={`rounded-full px-2.5 py-0.5 text-xs ${TONE[x.status] ?? "bg-muted"}`} title={x.email}>{x.name}{x.rate ? ` · ${x.rate}` : ""}{x.status === "new" && !x.seen ? " · unopened" : ""}</span>)}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
