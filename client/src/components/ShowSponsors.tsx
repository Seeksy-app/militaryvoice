import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Handshake, Trash2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { adminGet, adminSend } from "@/lib/adminApi";

export type ShowSponsorView = {
  id: number;
  sponsorId: number;
  sponsorName: string;
  logoUrl: string;
  url: string;
  signupId: number | null;
  slotIndex: number | null;
  slotLabel: string;
  podcastName: string;
  hostName: string;
  readLine: string;
  createdAt: string;
  clicks: number;
  clicksBySource: Record<string, number>;
  trackedUrl: string;
};

/**
 * Show sponsors: which company backs which slot. What the sponsor page
 * sells at $250 a show, delivered — the name on the agenda card, the logo on
 * the coming-up bumper, the line Alex reads, and the run of show marked.
 */
export function ShowSponsorsCard({ eventId }: { eventId: number }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [sponsorId, setSponsorId] = useState<string>("");
  const [signupId, setSignupId] = useState<string>("");
  const [readLine, setReadLine] = useState("");

  const { data: rows = [] } = useQuery<ShowSponsorView[]>({
    queryKey: ["/api/admin/show-sponsors", eventId],
    queryFn: () => adminGet<ShowSponsorView[]>(`/api/admin/show-sponsors?eventId=${eventId}`),
  });
  const { data: sponsors = [] } = useQuery<{ id: number; name: string }[]>({
    queryKey: ["/api/admin/sponsors", eventId, "names"],
    queryFn: () => adminGet<{ id: number; name: string }[]>(`/api/admin/sponsors?eventId=${eventId}`),
  });
  const { data: slots = [] } = useQuery<{ id: number; slotIndex: number; label: string; podcastName: string; hostName: string }[]>({
    queryKey: ["/api/admin/show-sponsors", eventId, "slots"],
    queryFn: () => adminGet<{ id: number; slotIndex: number; label: string; podcastName: string; hostName: string }[]>(`/api/admin/show-sponsors/slots?eventId=${eventId}`),
  });
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/admin/show-sponsors", eventId] });
    queryClient.invalidateQueries({ queryKey: ["/api/admin/sponsor-packages"] });
  };

  const add = useMutation({
    mutationFn: async () => adminSend("POST", "/api/admin/show-sponsors", { eventId, sponsorId: Number(sponsorId), signupId: signupId ? Number(signupId) : null, readLine: readLine.trim() }).then((r) => r.json()),
    onSuccess: () => { refresh(); setSignupId(""); setReadLine(""); toast({ title: "Show sponsor added" }); },
    onError: (err: Error) => toast({ title: "Couldn't add that", description: err.message, variant: "destructive" }),
  });
  async function remove(id: number) {
    if (!window.confirm("Remove this sponsorship from the slot?")) return;
    await adminSend("DELETE", `/api/admin/show-sponsors/${id}`);
    refresh();
  }
  const taken = new Set(rows.map((r) => r.signupId).filter((x): x is number => x != null));

  return (
    <Card data-testid="show-sponsors">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base"><Handshake className="h-4 w-4 text-primary" /> Show sponsors</CardTitle>
        <CardDescription>
          A company on a slot. They're named on that show's agenda card and on the coming-up bumper, their logo goes with it, Alex reads their line at the handoff, and the run of show is marked.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <form onSubmit={(e) => { e.preventDefault(); if (sponsorId) add.mutate(); }} className="grid gap-2 rounded-xl border border-dashed border-border bg-muted/30 p-3 sm:grid-cols-[1fr_1fr_1.4fr_auto] sm:items-end">
          <label className="text-xs">
            <span className="mb-1 block font-medium">Sponsor</span>
            <select value={sponsorId} onChange={(e) => setSponsorId(e.target.value)} className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm" data-testid="show-sponsor-pick">
              <option value="">Choose…</option>
              {sponsors.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
          <label className="text-xs">
            <span className="mb-1 block font-medium">Show</span>
            <select value={signupId} onChange={(e) => setSignupId(e.target.value)} className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm" data-testid="show-sponsor-slot">
              <option value="">Any slot — we choose</option>
              {slots.map((s) => <option key={s.id} value={s.id} disabled={taken.has(s.id)}>{s.label} · {s.podcastName.trim() || s.hostName}{taken.has(s.id) ? " (taken)" : ""}</option>)}
            </select>
          </label>
          <label className="text-xs">
            <span className="mb-1 block font-medium">What Alex reads (optional)</span>
            <Input value={readLine} onChange={(e) => setReadLine(e.target.value)} placeholder="This segment is brought to you by…" className="h-9 text-sm" />
          </label>
          <Button type="submit" size="sm" className="h-9 gap-1.5" disabled={!sponsorId || add.isPending} data-testid="show-sponsor-add"><Plus className="h-3.5 w-3.5" /> Add</Button>
        </form>

        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No show sponsors yet.</p>
        ) : (
          <div className="divide-y divide-border overflow-hidden rounded-xl border border-border">
            {rows.map((r) => (
              <div key={r.id} className="flex items-center gap-3 px-4 py-3" data-testid={`show-sponsor-${r.id}`}>
                {r.logoUrl ? <span className="flex h-8 w-14 shrink-0 items-center justify-center rounded bg-[#04102b] px-1"><img src={r.logoUrl} alt="" className="max-h-6 max-w-full object-contain" /></span> : <span className="flex h-8 w-14 shrink-0 items-center justify-center rounded bg-muted text-xs font-bold">{r.sponsorName.slice(0, 2)}</span>}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{r.sponsorName} <span className="font-normal text-muted-foreground">presents</span> {r.signupId ? r.podcastName.trim() || r.hostName : "a slot to be chosen"}</p>
                  <p className="truncate text-xs text-muted-foreground">{r.slotLabel}{r.readLine ? ` · "${r.readLine}"` : ""}</p>
                  <p className="truncate text-[11px] text-muted-foreground">
                    <span className="font-semibold text-foreground">{r.clicks}</span> click{r.clicks === 1 ? "" : "s"}
                    {Object.keys(r.clicksBySource).length > 0 && ` (${Object.entries(r.clicksBySource).map(([k, v]) => `${k} ${v}`).join(", ")})`}
                    {" · "}
                    <button type="button" onClick={() => { navigator.clipboard?.writeText(`${r.trackedUrl}?src=email`); }} className="underline underline-offset-2 hover:text-foreground" title="Copy the counted link for emails and posts">copy tracked link</button>
                  </p>
                </div>
                <button type="button" onClick={() => remove(r.id)} className="rounded-md p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive" title="Remove"><Trash2 className="h-3.5 w-3.5" /></button>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
