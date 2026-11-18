import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, Loader2, Send, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

type Invite = { id: number; guestName: string; guestEmail: string; whenText: string; zoomLink: string; note: string; status: "invited" | "answered"; answers: Record<string, string> & { custom?: { q: string; a: string }[] }; hasPhoto: boolean; invitedAt: string; answeredAt: string; usedRec: number; link: string };
const say = (e: unknown) => ((e as Error).message ?? "").replace(/^\d+:\s*/, "").replace(/^\{"message":"|"\}$/g, "") || "Try again in a moment.";

/** The guest's name for the card is theirs to type: an invitation from the host asks them, with the photo they want shown. */
export function GuestInvites() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const list = useQuery<Invite[]>({ queryKey: ["/api/host/guest-invites"], queryFn: async () => (await apiRequest("GET", "/api/host/guest-invites")).json() });
  const [f, setF] = useState({ guestName: "", guestEmail: "", when: "", zoomLink: "", note: "" });
  const [open, setOpen] = useState<number | null>(null);
  const [questions, setQuestions] = useState<string[]>([]);
  const sender = useQuery<{ slug: string; address: string; replyTo: string }>({ queryKey: ["/api/host/guest-invites/sender"], queryFn: async () => (await apiRequest("GET", "/api/host/guest-invites/sender")).json() });
  const [editSlug, setEditSlug] = useState<string | null>(null);
  const saveSlug = useMutation({
    mutationFn: async () => (await apiRequest("PUT", "/api/host/guest-invites/sender", { slug: editSlug })).json(),
    onSuccess: () => { setEditSlug(null); void qc.invalidateQueries({ queryKey: ["/api/host/guest-invites/sender"] }); toast({ title: "Saved", description: "Invitations come from that address now." }); },
    onError: (e) => toast({ title: "Couldn't use that", description: say(e), variant: "destructive" }),
  });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  const send = useMutation({
    mutationFn: async () => {
      const whenIso = f.when ? new Date(f.when).toISOString() : "";
      const whenText = f.when ? new Date(f.when).toLocaleString("en-US", { weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" }) : "";
      return (await apiRequest("POST", "/api/host/guest-invites", { guestName: f.guestName, guestEmail: f.guestEmail, whenText, whenIso, zoomLink: f.zoomLink, note: f.note, questions: questions.map((q) => q.trim()).filter(Boolean) })).json();
    },
    onSuccess: () => { setF({ guestName: "", guestEmail: "", when: "", zoomLink: "", note: "" }); setQuestions([]); void qc.invalidateQueries({ queryKey: ["/api/host/guest-invites"] }); toast({ title: "Invitation sent", description: "They'll get an email from you through MilitaryVoices.ai, and you'll hear when they answer." }); },
    onError: (e) => toast({ title: "Couldn't send that", description: say(e), variant: "destructive" }),
  });
  const del = useMutation({ mutationFn: async (id: number) => apiRequest("DELETE", `/api/host/guest-invites/${id}`), onSuccess: () => void qc.invalidateQueries({ queryKey: ["/api/host/guest-invites"] }) });
  const copy = async (link: string) => { try { await navigator.clipboard.writeText(link); toast({ title: "Link copied" }); } catch { toast({ title: link }); } };

  return (
    <div className="space-y-6" data-testid="guest-invites">
      <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
        <h3 className="text-lg font-semibold">Invite a guest</h3>
        <p className="mt-1 text-sm text-muted-foreground [text-wrap:pretty]">We email your guest from you. They answer a few questions and add the photo they want shown, and you get it all before the interview. Their name and photo go on your episode's guest card.</p>
        <form className="mt-5 grid gap-5 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); send.mutate(); }}>
          <div className="space-y-1.5"><Label htmlFor="gi-f-name">Guest's name</Label><Input id="gi-f-name" value={f.guestName} onChange={set("guestName")} maxLength={80} required /></div>
          <div className="space-y-1.5"><Label htmlFor="gi-f-email">Guest's email</Label><Input id="gi-f-email" type="email" value={f.guestEmail} onChange={set("guestEmail")} required /></div>
          <div className="space-y-1.5"><Label htmlFor="gi-f-when">When is the interview?</Label><Input id="gi-f-when" type="datetime-local" value={f.when} onChange={set("when")} /></div>
          <div className="space-y-1.5"><Label htmlFor="gi-f-zoom">Zoom link</Label><Input id="gi-f-zoom" value={f.zoomLink} onChange={set("zoomLink")} placeholder="Paste the link from Zoom" /><p className="text-xs text-muted-foreground">Make the meeting in Zoom and paste its link here.</p></div>
          <div className="space-y-1.5 sm:col-span-2"><Label htmlFor="gi-f-note">A note to your guest (optional)</Label><Textarea id="gi-f-note" value={f.note} onChange={set("note")} rows={3} maxLength={1200} placeholder="What the interview is about, how long it runs, what to have ready." /></div>
          <div className="space-y-3 rounded-xl border border-border/70 p-4 sm:col-span-2" data-testid="guest-invite-questions">
            <Label>Your own questions for the guest (optional)</Label>
            <p className="text-xs text-muted-foreground">We already ask their name, bio, topics, links and photo. Add anything else you want to know before the interview.</p>
            {questions.map((q, i) => (
              <div key={i} className="flex items-center gap-2">
                <Input value={q} onChange={(e) => setQuestions((qs) => qs.map((x, j) => (j === i ? e.target.value : x)))} maxLength={300} placeholder="For example: What's the story you've never told on a podcast?" aria-label={`Question ${i + 1}`} />
                <Button type="button" variant="ghost" size="sm" onClick={() => setQuestions((qs) => qs.filter((_, j) => j !== i))} aria-label={`Remove question ${i + 1}`}><Trash2 className="h-4 w-4" /></Button>
              </div>
            ))}
            {questions.length < 10 && <Button type="button" variant="outline" size="sm" className="rounded-full" onClick={() => setQuestions((qs) => [...qs, ""])} data-testid="guest-invite-add-question">+ Add a question</Button>}
          </div>
          <div className="sm:col-span-2"><Button type="submit" disabled={send.isPending || !f.guestName.trim() || !f.guestEmail.trim()} className="rounded-full bg-[#053877] text-white hover:bg-[#0a4a99]" data-testid="guest-invite-submit">{send.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}Send the invitation</Button></div>
          <div className="space-y-1 sm:col-span-2 text-xs text-muted-foreground" data-testid="invite-sender">
            {editSlug === null ? (
              <p>* The email comes from <b className="text-foreground">{sender.data?.address ?? "…"}</b>. When your guest replies, it comes to you ({sender.data?.replyTo ?? "your email"}). <button type="button" onClick={() => setEditSlug(sender.data?.slug ?? "")} className="font-semibold text-[#053877] underline underline-offset-2 dark:text-[#8fb5e8]" data-testid="invite-sender-edit">Change the name</button></p>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <span>* From</span>
                <Input value={editSlug} onChange={(e) => setEditSlug(e.target.value.toLowerCase())} className="h-8 w-48" maxLength={30} data-testid="invite-sender-input" />
                <span>@militaryvoices.ai</span>
                <Button type="button" size="sm" className="h-8 rounded-full" disabled={saveSlug.isPending || editSlug.trim().length < 3} onClick={() => saveSlug.mutate()}>Save</Button>
                <Button type="button" size="sm" variant="ghost" className="h-8" onClick={() => setEditSlug(null)}>Cancel</Button>
              </div>
            )}
          </div>
        </form>
      </div>

      <div>
        <h3 className="text-lg font-semibold">Your invitations</h3>
        {list.isLoading ? <p className="mt-2 text-sm text-muted-foreground">Loading…</p> : !list.data?.length ? <p className="mt-2 text-sm text-muted-foreground">None yet.</p> : (
          <ul className="mt-3 space-y-3">
            {list.data.map((g) => (
              <li key={g.id} className="rounded-xl border border-border bg-card p-4" data-testid={`guest-invite-${g.id}`}>
                <div className="flex flex-wrap items-center gap-3">
                  {g.hasPhoto ? <img src={`/api/host/guest-invites/${g.id}/photo`} alt="" className="h-12 w-12 rounded-full object-cover" /> : <div className="h-12 w-12 rounded-full bg-muted" />}
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">{g.guestName}</p>
                    <p className="truncate text-xs text-muted-foreground">{g.guestEmail}{g.whenText ? ` · ${g.whenText}` : ""}</p>
                  </div>
                  {g.status === "answered"
                    ? <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-800"><Check className="h-3.5 w-3.5" /> Answered</span>
                    : <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-900">Waiting for them</span>}
                  <Button type="button" variant="ghost" size="sm" onClick={() => void copy(g.link)} aria-label="Copy their link"><Copy className="h-4 w-4" /></Button>
                  {g.status === "answered" && <Button type="button" variant="outline" size="sm" onClick={() => setOpen(open === g.id ? null : g.id)}>{open === g.id ? "Hide answers" : "See answers"}</Button>}
                  <Button type="button" variant="ghost" size="sm" onClick={() => del.mutate(g.id)} aria-label="Delete this invitation"><Trash2 className="h-4 w-4" /></Button>
                </div>
                {open === g.id && (
                  <dl className="mt-3 space-y-2 border-t border-border pt-3 text-sm">
                    {([["title", "What they do"], ["bio", "Bio"], ["topics", "Topics"], ["links", "Where to find them"], ["avoid", "Rather not discuss"]] as const).filter(([k]) => g.answers[k]).map(([k, label]) => (
                      <div key={k}><dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</dt><dd className="whitespace-pre-line">{g.answers[k]}</dd></div>
                    ))}
                    {(g.answers.custom ?? []).filter((c) => c.a).map((c, i) => (
                      <div key={`c${i}`}><dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{c.q}</dt><dd className="whitespace-pre-line">{c.a}</dd></div>
                    ))}
                  </dl>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
