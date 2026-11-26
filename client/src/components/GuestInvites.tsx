import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, Eye, Loader2, Send, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/room/Select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { CopyField } from "@/components/OwnEncoder";
import { WatchLinkCard } from "@/components/WatchLink";
import { Art3D, IconTile } from "@/components/ui/icon-tile";
import { otherLinkCopy } from "@shared/guestWhere";

type Invite = { id: number; guestName: string; guestEmail: string; whenText: string; zoomLink: string; note: string; status: "invited" | "answered"; answers: Record<string, string> & { custom?: { q: string; a: string }[] }; hasPhoto: boolean; whenIso?: string; linkedinUrl?: string; invitedAt: string; answeredAt: string; usedRec: number; link: string };
const say = (e: unknown) => ((e as Error).message ?? "").replace(/^\d+:\s*/, "").replace(/^\{"message":"|"\}$/g, "") || "Try again in a moment.";

/** "name@gmail.om" and the like: a big mail provider with the wrong ending. Returns the fixed address, or "". */
const typoFix = (email: string) => {
  const m = email.trim().toLowerCase().match(/^([^@\s]+)@(gmail|yahoo|hotmail|outlook|icloud|aol|live|msn)\.([a-z]+)$/);
  return m && m[3] !== "com" ? `${m[1]}@${m[2]}.com` : "";
};

/** Where an invitation stands. Once its day has passed (or its photo is on a recording) it's Done, answered or not. */
type State = "waiting" | "answered" | "done";
const stateOf = (g: Invite): State => (g.usedRec > 0 || (g.whenIso && Date.parse(g.whenIso) < Date.now()) ? "done" : g.status === "answered" ? "answered" : "waiting");
const initials = (name: string) => name.trim().split(/\s+/).filter(Boolean).map((w) => w[0]).slice(0, 2).join("").toUpperCase() || "?";
/** "Wed, Dec 2 · 6:30 PM": short enough to never be cut off. */
const shortWhen = (g: Invite) => (g.whenIso ? new Date(g.whenIso).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).replace(/, (\d+:\d+)/, " · $1").replace(/^(\w+), /, "$1, ") : g.whenText);
/** The "When" line the email carries, from the form's datetime-local value. */
const whenLabel = (v: string) => (v ? new Date(v).toLocaleString("en-US", { weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" }) : "");
const tabCls = (on: boolean) => `border-b-2 px-0.5 pb-2 text-sm font-medium transition-colors ${on ? "border-[#053877] font-semibold text-[#053877] dark:border-[#8fb5e8] dark:text-[#8fb5e8]" : "border-transparent text-muted-foreground hover:text-foreground"}`;
/** Where the interview is recorded or goes out live (Andrew, 25 Nov): our studio first, then Zoom, then the tools that stream in. */
type Where = "studio" | "zoom" | "streamyard" | "restream" | "obs" | "booth";
const OUTSIDE: Record<"streamyard" | "restream" | "obs", { name: string; link: string; steps: string }> = {
  streamyard: { name: "StreamYard", link: "StreamYard guest link", steps: "In StreamYard, open your broadcast, then Destinations → Add a destination → Custom RTMP. Paste these two and save." },
  restream: { name: "Restream", link: "Restream guest link", steps: "In Restream, open Channels → Add Channel → Custom RTMP. Paste these two and save." },
  obs: { name: "OBS", link: "Link your guest joins with", steps: "In OBS, open Settings → Stream and set Service to Custom. Paste these two." },
};
const isOutside = (w: Where): w is keyof typeof OUTSIDE => w in OUTSIDE;
const selCls = "h-9 w-full rounded-md border border-input bg-background pl-3 text-sm";

const STATUS: Record<State, { label: string; dot: string }> = {
  waiting: { label: "Waiting for them", dot: "bg-amber-500" },
  answered: { label: "Answered", dot: "bg-emerald-500" },
  done: { label: "Done", dot: "bg-slate-400" },
};
function StatusTag({ st }: { st: State }) {
  // A dot and plain words, no pastel fill (Andrew, 25 Nov: picked A).
  const s = STATUS[st];
  return <span className="inline-flex basis-full items-center gap-2 text-sm font-medium text-foreground/80 sm:basis-auto sm:pr-1"><span className={`h-2 w-2 rounded-full ${s.dot}`} />{s.label}</span>;
}

/** The guest's name for the card is theirs to type: an invitation from the host asks them, with the photo they want shown. */
export function GuestInvites({ prefill, shows = [], showId }: { prefill?: { name: string; email: string; n: number }; /** All their shows: two or more and the form asks which one it's for. */ shows?: { id: number; title: string }[]; /** The show they're working in, the picker's default. */ showId?: number } = {}) {
  // "For which show?" (Riccoh, 24 Nov 2026: two shows, and the invite went out under the wrong one). One show: nothing to pick.
  const many = shows.length > 1;
  const [forShow, setForShow] = useState<number | null>(null);
  const pickedShow = many ? forShow ?? (shows.some((x) => x.id === showId) ? showId! : shows[0].id) : null;
  const { toast } = useToast();
  const qc = useQueryClient();
  const list = useQuery<Invite[]>({ queryKey: ["/api/host/guest-invites"], queryFn: async () => (await apiRequest("GET", "/api/host/guest-invites")).json() });
  // People saved from the browser extension ("Add to my show"): one tap starts an invitation with their name filled in.
  const saved = useQuery<{ id: string; name: string; title: string; org: string; photoUrl: string; url: string }[]>({ queryKey: ["/api/host/captures"], queryFn: async () => (await apiRequest("GET", "/api/host/captures")).json() });
  const unsave = useMutation({ mutationFn: async (id: string) => apiRequest("DELETE", `/api/host/captures/${id}`), onSuccess: () => void qc.invalidateQueries({ queryKey: ["/api/host/captures"] }) });
  const [f, setF] = useState({ guestName: "", guestEmail: "", linkedin: "", when: "", zoomLink: "", note: "" });
  // Two sub-tabs (Andrew, 24 Nov): the form first, so a long list never buries it; the list with its own filter.
  const [sub, setSub] = useState<"new" | "list">("new");
  const [filter, setFilter] = useState<"all" | State>("all");
  const all = list.data ?? [];
  const count = (k: "all" | State) => (k === "all" ? all.length : all.filter((g) => stateOf(g) === k).length);
  const shown = filter === "all" ? all : all.filter((g) => stateOf(g) === filter);
  // On Zoom the guest needs the link from somewhere: pasted here, or the host sends it in an email of their own.
  const [linkLater, setLinkLater] = useState(false);
  const [needLink, setNeedLink] = useState(false);
  // Where it happens: on Zoom (paste a link), or in the host's own MilitaryVoices Radio booth (we make the guest's link).
  const [where, setWhere] = useState<Where>("studio");
  // Zoom and the host's own tools: the guest joins by a link the host pastes (or sends themselves).
  const byLink = where === "zoom" || isOutside(where);
  // Streaming in from StreamYard, Restream or OBS: the host's one stream key, from the same place as /stream-in.
  const streamIn = useQuery<{ configured: boolean; key: { url: string; streamKey: string } | null }>({ queryKey: ["/api/host/stream-in"], queryFn: async () => (await apiRequest("GET", "/api/host/stream-in")).json(), enabled: isOutside(where) });
  const getKey = useMutation({ mutationFn: async () => (await apiRequest("POST", "/api/host/stream-in")).json(), onSuccess: (j) => qc.setQueryData(["/api/host/stream-in"], j), onError: (e) => toast({ title: "Couldn't get your key", description: say(e), variant: "destructive" }) });
  const [bookingId, setBookingId] = useState<number | null>(null);
  const bookings = useQuery<{ id: number; show: string; startAtUtc: string; label: string }[]>({ queryKey: ["/api/host/guest-invites/bookings"], queryFn: async () => (await apiRequest("GET", "/api/host/guest-invites/bookings")).json() });
  const coming = bookings.data ?? [];
  const pickedBooking = where === "booth" ? bookingId ?? coming[0]?.id ?? null : null;
  const [open, setOpen] = useState<number | null>(null);
  const [fixing, setFixing] = useState<{ id: number; email: string } | null>(null);
  const resend = useMutation({
    mutationFn: async (v: { id: number; email: string }) => (await apiRequest("POST", `/api/host/guest-invites/${v.id}/resend`, { guestEmail: v.email })).json(),
    onSuccess: (_d, v) => { setFixing(null); void qc.invalidateQueries({ queryKey: ["/api/host/guest-invites"] }); toast({ title: "Sent again", description: `The invitation is on its way to ${v.email}.` }); },
    onError: (e) => toast({ title: "Couldn't send that", description: say(e), variant: "destructive" }),
  });
  const [questions, setQuestions] = useState<string[]>([]);
  // The note and own questions open from their "+ Add…" links; the email preview starts open (Andrew, 26 Nov).
  const [noteOpen, setNoteOpen] = useState(false);
  const [qsOpen, setQsOpen] = useState(false);
  const [preview, setPreview] = useState(true);
  const sender = useQuery<{ slug: string; address: string; replyTo: string; fromShow?: boolean; who?: string; show?: string; studioLink?: string }>({ queryKey: ["/api/host/guest-invites/sender", pickedShow], queryFn: async () => (await apiRequest("GET", `/api/host/guest-invites/sender${pickedShow ? `?show=${pickedShow}` : ""}`)).json() });
  const [editSlug, setEditSlug] = useState<string | null>(null);
  const saveSlug = useMutation({
    mutationFn: async () => (await apiRequest("PUT", "/api/host/guest-invites/sender", { slug: editSlug })).json(),
    onSuccess: () => { setEditSlug(null); void qc.invalidateQueries({ queryKey: ["/api/host/guest-invites/sender"] }); toast({ title: "Saved", description: "Invitations come from that address now." }); },
    onError: (e) => toast({ title: "Couldn't use that", description: say(e), variant: "destructive" }),
  });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  // From Invite to my show on a Book a guest profile: their name (and email, if found) filled in, the form in view.
  useEffect(() => {
    if (!prefill?.name) return;
    setF((x) => ({ ...x, guestName: prefill.name, guestEmail: prefill.email || "" }));
    requestAnimationFrame(() => document.querySelector("[data-testid='guest-invite-form']")?.scrollIntoView({ behavior: "smooth", block: "start" }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefill?.n]);
  const send = useMutation({
    mutationFn: async () => {
      const whenIso = f.when ? new Date(f.when).toISOString() : "";
      const whenText = whenLabel(f.when);
      return (await apiRequest("POST", "/api/host/guest-invites", { guestName: f.guestName, guestEmail: f.guestEmail, linkedin: f.linkedin.trim(), whenText, whenIso, zoomLink: byLink && !linkLater ? f.zoomLink.trim() : "", linkLater: byLink && linkLater, note: f.note, ...(where === "booth" ? { where: "booth", bookingId: pickedBooking } : where === "studio" ? { where: "studio" } : isOutside(where) ? { where } : {}), questions: questions.map((q) => q.trim()).filter(Boolean), ...(pickedShow ? { showId: pickedShow } : {}) })).json();
    },
    onSuccess: () => { setF({ guestName: "", guestEmail: "", linkedin: "", when: "", zoomLink: "", note: "" }); setQuestions([]); setNoteOpen(false); setQsOpen(false); setWhere("studio"); setLinkLater(false); setNeedLink(false); void qc.invalidateQueries({ queryKey: ["/api/host/guest-invites"] }); toast({ title: "Invitation sent", description: "They'll get an email from you through MilitaryVoices.ai, and you'll hear when they answer." }); },
    onError: (e) => toast({ title: "Couldn't send that", description: say(e), variant: "destructive" }),
  });
  const del = useMutation({ mutationFn: async (id: number) => apiRequest("DELETE", `/api/host/guest-invites/${id}`), onSuccess: () => void qc.invalidateQueries({ queryKey: ["/api/host/guest-invites"] }) });
  const copy = async (link: string) => { try { await navigator.clipboard.writeText(link); toast({ title: "Link copied" }); } catch { toast({ title: link }); } };

  return (
    <div className="space-y-6" data-testid="guest-invites">
      <div className="-mt-1 flex gap-5 overflow-x-auto whitespace-nowrap border-b border-border [scrollbar-width:none]" role="tablist">
        <button type="button" role="tab" aria-selected={sub === "new"} onClick={() => setSub("new")} className={tabCls(sub === "new")} data-testid="invite-sub-new">Invite a guest</button>
        <button type="button" role="tab" aria-selected={sub === "list"} onClick={() => setSub("list")} className={tabCls(sub === "list")} data-testid="invite-sub-list">Invitations <span className="tabular-nums text-muted-foreground">{all.length || ""}</span></button>
      </div>
      {(saved.data?.length ?? 0) > 0 && (
        <div data-testid="guest-saved">
          <h3 className="text-lg font-semibold">Saved from your browser</h3>
          <p className="text-xs text-muted-foreground">People you added with the MilitaryVoices extension. Press Invite to start their invitation.</p>
          <ul className="mt-3 space-y-2">
            {(saved.data ?? []).map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card p-3">
                {c.photoUrl ? <img src={c.photoUrl} alt="" className="h-10 w-10 rounded-full object-cover" referrerPolicy="no-referrer" /> : <div className="h-10 w-10 rounded-full bg-muted" />}
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">{c.name}</p>
                  <p className="truncate text-xs text-muted-foreground">{[c.title, c.org].filter(Boolean).join(" · ") || c.url}</p>
                </div>
                <Button type="button" size="sm" onClick={() => { setF((x) => ({ ...x, guestName: c.name, note: x.note || (c.url ? `Found you here: ${c.url}` : "") })); unsave.mutate(c.id); document.querySelector("[data-testid='guest-invite-form']")?.scrollIntoView({ behavior: "smooth", block: "start" }); }}>Invite</Button>
                <Button type="button" variant="ghost" size="sm" onClick={() => unsave.mutate(c.id)} aria-label={`Remove ${c.name}`}><Trash2 className="h-4 w-4" /></Button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {sub === "list" && (
      <div data-testid="guest-invites-list">
        <div className="flex flex-wrap gap-2" role="group" aria-label="Show">
          {([["all", "All"], ["waiting", "Waiting"], ["answered", "Answered"], ["done", "Done"]] as const).map(([k, l]) => (
            <button key={k} type="button" onClick={() => setFilter(k)} aria-pressed={filter === k} className={`inline-flex h-8 items-center gap-1.5 rounded-full border px-3.5 text-sm font-semibold ${filter === k ? "border-[#053877] bg-[#053877] text-white" : "border-border hover:bg-muted"}`} data-testid={`invite-filter-${k}`}>{l} <span className={`tabular-nums ${filter === k ? "text-white/75" : "text-muted-foreground"}`}>{count(k)}</span></button>
          ))}
        </div>
        {!all.length && <p className="mt-6 text-sm text-muted-foreground">No invitations yet. <button type="button" onClick={() => setSub("new")} className="font-semibold text-[#053877] underline underline-offset-2 dark:text-[#8fb5e8]">Invite a guest</button></p>}
        {(
          <ul className="mt-4 space-y-3">
            {shown.map((g) => { const st = stateOf(g); return (
              <li key={g.id} className="rounded-xl border border-border bg-card p-4" data-testid={`guest-invite-${g.id}`}>
                <div className="flex flex-wrap items-center gap-3">
                  {g.hasPhoto ? <img src={`/api/host/guest-invites/${g.id}/photo`} alt="" className="h-12 w-12 rounded-full object-cover" /> : <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[#053877]/10 text-sm font-bold text-[#053877] dark:bg-white/10 dark:text-white" aria-hidden>{initials(g.guestName)}</div>}
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">{g.guestName}</p>
                    <p className="flex flex-wrap gap-x-1 text-xs text-muted-foreground"><span className="max-w-full truncate" title={g.guestEmail}>{g.guestEmail}</span>{g.whenIso || g.whenText ? <span className="whitespace-nowrap">· {st === "done" ? `Was on ${shortWhen(g)}` : shortWhen(g)}</span> : null}</p>
                  </div>
                  {/* On a phone the status and buttons take their own line under the name (24 Nov). */}
                  <div className="flex w-full flex-wrap items-center gap-2 pl-[3.75rem] sm:w-auto sm:pl-0">
                  <StatusTag st={st} />
                  {st === "waiting" && <Button type="button" variant="outline" size="sm" onClick={() => setFixing(fixing?.id === g.id ? null : { id: g.id, email: g.guestEmail })} data-testid={`guest-invite-resend-${g.id}`}>Fix email or resend</Button>}
                  {st !== "done" && <Button type="button" variant="ghost" size="sm" className="h-9 w-9 p-0" onClick={() => void copy(g.link)} aria-label="Copy their link"><Copy className="h-4 w-4" /></Button>}
                  {g.status === "answered" && <Button type="button" variant="outline" size="sm" onClick={() => setOpen(open === g.id ? null : g.id)}>{open === g.id ? "Hide answers" : "See answers"}</Button>}
                  <Button type="button" variant="ghost" size="sm" className="h-9 w-9 p-0" onClick={() => del.mutate(g.id)} aria-label="Delete this invitation"><Trash2 className="h-4 w-4" /></Button>
                  </div>
                </div>
                {fixing?.id === g.id && (
                  <form className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3" onSubmit={(e) => { e.preventDefault(); resend.mutate(fixing); }}>
                    <Input type="email" value={fixing.email} onChange={(e) => setFixing({ id: g.id, email: e.target.value })} className="h-9 max-w-xs" aria-label="Their email" required />
                    <Button type="submit" size="sm" disabled={resend.isPending}>{resend.isPending ? "Sending…" : "Send it again"}</Button>
                    {typoFix(fixing.email) && <span className="text-xs text-amber-800">Did you mean <button type="button" onClick={() => setFixing({ id: g.id, email: typoFix(fixing.email) })} className="font-semibold underline">{typoFix(fixing.email)}</button>?</span>}
                  </form>
                )}
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
            ); })}
          </ul>
        )}
      </div>
      )}

      {sub === "new" && <>

      {/* Version A (Andrew, 26 Nov: "I like this format"): a slim header and the three steps, the form in two
          columns, the note and questions behind "+ Add…" links, and the email they'll get open underneath. */}
      <div data-testid="guest-invite-new">
        <div className="flex items-center gap-3">
          <IconTile art="send" size="sm" />
          <div className="min-w-0">
            <h2 className="text-xl font-bold tracking-tight">Invite a guest</h2>
            <p className="text-sm text-muted-foreground [text-wrap:pretty]">We email them from you. You get their answers and photo before the interview.</p>
          </div>
        </div>
        {/* Phones skip the steps: the line above already says it (UI/UX, 26 Nov). */}
        <div className="mt-3 hidden flex-wrap items-center gap-x-3.5 gap-y-1.5 rounded-xl border border-border bg-card px-3 py-2 text-[13px] font-medium text-muted-foreground sm:flex" data-testid="invite-steps">
          <span className="inline-flex items-center gap-1.5"><Art3D name="clipboard" size={18} />They answer a few questions</span>
          <span aria-hidden className="text-muted-foreground/50">→</span>
          <span className="inline-flex items-center gap-1.5"><Art3D name="camera" size={18} />Send their photo</span>
          <span aria-hidden className="text-muted-foreground/50">→</span>
          <span className="inline-flex items-center gap-1.5"><Art3D name="link" size={18} />Join with one link</span>
        </div>

      <div className="mt-3.5 rounded-2xl border border-border bg-card p-4 shadow-sm sm:p-5">
        <form data-testid="guest-invite-form" className="grid grid-cols-1 gap-x-4 gap-y-3.5 sm:grid-cols-2 [&>*]:min-w-0" onSubmit={(e) => { e.preventDefault(); const fix = typoFix(f.guestEmail); if (fix && window.confirm(`Is ${f.guestEmail} right? It looks like it should end in .com (${fix}).\n\nOK sends it to ${f.guestEmail}. Cancel lets you fix it.`) === false) return; if (byLink && !f.zoomLink.trim() && !linkLater) { setNeedLink(true); document.getElementById("gi-f-zoom")?.focus(); return; } send.mutate(); }}>
          {many && (
            <div className="flex flex-col gap-1.5 sm:col-span-2" data-testid="invite-show">
              <Label htmlFor="gi-f-show">For which show?</Label>
              <Select id="gi-f-show" wrap="w-full sm:max-w-sm" value={pickedShow ?? ""} onChange={(e) => setForShow(Number(e.target.value))} className={selCls} data-testid="invite-show-select">
                {shows.map((x) => <option key={x.id} value={x.id}>{x.title || "Untitled show"}</option>)}
              </Select>
            </div>
          )}
          <div className="space-y-1.5"><Label htmlFor="gi-f-name">Guest's name</Label><Input id="gi-f-name" value={f.guestName} onChange={set("guestName")} maxLength={80} required /></div>
          <div className="space-y-1.5"><Label htmlFor="gi-f-email">Guest's email</Label><Input id="gi-f-email" type="email" value={f.guestEmail} onChange={set("guestEmail")} required />{typoFix(f.guestEmail) && <p className="text-xs text-amber-800">Did you mean <button type="button" onClick={() => setF((x) => ({ ...x, guestEmail: typoFix(x.guestEmail) }))} className="font-semibold underline">{typoFix(f.guestEmail)}</button>?</p>}</div>
          {/* Where and When describe the session, so they sit together (UI/UX, 26 Nov). */}
          <div className="flex flex-col gap-1.5" data-testid="invite-where">
            <Label htmlFor="gi-f-where">Where will you record or go live?{where === "studio" && <span className="ml-1.5 rounded-full bg-[#FFF3D6] px-1.5 py-px align-[1px] text-[10.5px] font-bold text-[#8a5a00]">Built in</span>}</Label>
            <Select id="gi-f-where" wrap="w-full" value={where} onChange={(e) => { setWhere(e.target.value as Where); setNeedLink(false); }} className={selCls} data-testid="invite-where-select">
              <option value="studio">My Studio</option>
              <option value="zoom">Zoom</option>
              <option value="streamyard">StreamYard</option>
              <option value="restream">Restream</option>
              <option value="obs">OBS or another encoder</option>
              {coming.length > 0 && <option value="booth">My Radio show</option>}
            </Select>
          </div>
          {where === "booth" && coming.length > 0 ? (
            <div className="flex flex-col gap-1.5" data-testid="invite-booth">
              <Label htmlFor="gi-f-booking">Which show?</Label>
              <Select id="gi-f-booking" wrap="w-full" value={pickedBooking ?? ""} onChange={(e) => setBookingId(Number(e.target.value))} className={selCls}>
                {coming.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
              </Select>
            </div>
          ) : (
            <div className="flex flex-col gap-1.5"><Label htmlFor="gi-f-when">When is the interview?</Label><Input id="gi-f-when" type="datetime-local" value={f.when} onChange={set("when")} />{byLink && !f.when && <p className="text-xs text-amber-800" data-testid="invite-when-nudge">Add the day and time so your guest knows when to join.</p>}</div>
          )}
          <div className="space-y-1.5" data-testid="invite-linkedin"><Label htmlFor="gi-f-li">LinkedIn <span className="font-medium text-muted-foreground">(optional)</span></Label><Input id="gi-f-li" value={f.linkedin} onChange={set("linkedin")} placeholder="linkedin.com/in/their-name" inputMode="url" /></div>
          {where === "studio" && <p className="self-center text-xs text-muted-foreground [text-wrap:pretty] sm:pt-6" data-testid="invite-studio-note">Your guest gets the link to your studio. No account needed.</p>}
          {where === "booth" && coming.length > 0 && <p className="self-center text-xs text-muted-foreground [text-wrap:pretty] sm:pt-6">Your guest gets a private link into your Radio show, with the time filled in. They open it on the day, allow their camera and microphone, and they're in. No account needed.</p>}
          {byLink && (
            <div className="space-y-1.5">
              <Label htmlFor="gi-f-zoom">{where === "zoom" ? "Zoom link" : OUTSIDE[where as keyof typeof OUTSIDE].link}</Label>
              <Input id="gi-f-zoom" value={linkLater ? "" : f.zoomLink} onChange={(e) => { set("zoomLink")(e); setNeedLink(false); }} placeholder={linkLater ? "You'll send it yourself" : where === "zoom" ? "Paste the link from Zoom" : "Paste the link your guest opens"} disabled={linkLater} aria-invalid={needLink} data-testid="invite-zoom-link" />
              <label htmlFor="gi-f-later" className="flex items-center gap-2 pt-1 text-sm" data-testid="invite-link-later">
                <Checkbox id="gi-f-later" checked={linkLater} onCheckedChange={(v) => { setLinkLater(v === true); setNeedLink(false); }} />
                I'll send {where === "zoom" ? "the Zoom link" : "the link"} in a separate email
              </label>
              {needLink
                ? <p className="text-xs font-medium text-red-700" role="alert" data-testid="invite-need-link">{where === "zoom" ? "Paste your Zoom link" : "Paste the link your guest opens"}, or tick the box if you'll send it yourself.</p>
                : <p className="text-xs text-muted-foreground">{linkLater ? "We'll tell your guest the link is coming from you." : where === "zoom" ? "Make the meeting in Zoom and paste its link here." : `Your guest joins you in ${OUTSIDE[where as keyof typeof OUTSIDE].name} with this link.`}</p>}
            </div>
          )}
          {isOutside(where) && (
            <div className="space-y-3 rounded-xl border border-border/70 p-4 sm:col-span-2 [&>*]:max-w-2xl" data-testid="invite-stream-in">
              <div>
                <p className="text-sm font-semibold">Send it to your Library too</p>
                <p className="mt-0.5 text-xs text-muted-foreground [text-wrap:pretty]">Add MilitaryVoices to {OUTSIDE[where].name} once, and every show you make there also records into your Library, ready for clips.</p>
              </div>
              <p className="text-sm [text-wrap:pretty]">{OUTSIDE[where].steps}</p>
              {streamIn.data?.key ? (
                <div className="grid gap-4 sm:grid-cols-2">
                  <CopyField label="Server URL" value={streamIn.data.key.url} />
                  <CopyField label="Stream key" value={streamIn.data.key.streamKey} secret />
                </div>
              ) : streamIn.data && !streamIn.data.configured ? (
                <p className="text-sm text-muted-foreground">Streaming in isn't switched on yet. Your invitation still goes out.</p>
              ) : (
                <Button type="button" variant="outline" size="sm" className="rounded-full" disabled={getKey.isPending || streamIn.isLoading} onClick={() => getKey.mutate()} data-testid="invite-get-key">{getKey.isPending ? "Setting up…" : "Get my stream key"}</Button>
              )}
              <p className="text-xs text-muted-foreground">Already added it? You're set: the same key works every time. {where === "streamyard" && "StreamYard lists Custom RTMP on its paid plans. "}<a href="/stream-in" target="_blank" rel="noreferrer" className="font-semibold text-[#053877] underline underline-offset-2 dark:text-[#8fb5e8]">Your stream key page</a></p>
            </div>
          )}
          {(noteOpen || f.note) && <div className="space-y-1.5 sm:col-span-2"><Label htmlFor="gi-f-note">A note to your guest (optional)</Label><Textarea id="gi-f-note" value={f.note} onChange={set("note")} rows={3} maxLength={1200} placeholder="What the interview is about, how long it runs, what to have ready." autoFocus={noteOpen && !f.note} /></div>}
          {(qsOpen || questions.length > 0) && (
          <div className="space-y-3 rounded-xl border border-border/70 p-4 sm:col-span-2" data-testid="guest-invite-questions">
            <Label>Your own questions for the guest (optional)</Label>
            <p className="text-xs text-muted-foreground">We already ask their name, bio, topics, links and photo. Add anything else you want to know before the interview.</p>
            {questions.map((q, i) => (
              <div key={i} className="flex items-center gap-2">
                <Input value={q} onChange={(e) => setQuestions((qs) => qs.map((x, j) => (j === i ? e.target.value : x)))} maxLength={300} placeholder="For example: What's the story you've never told on a podcast?" aria-label={`Question ${i + 1}`} autoFocus={i === questions.length - 1 && !q} />
                <Button type="button" variant="ghost" size="sm" onClick={() => setQuestions((qs) => qs.filter((_, j) => j !== i))} aria-label={`Remove question ${i + 1}`}><Trash2 className="h-4 w-4" /></Button>
              </div>
            ))}
            {questions.length < 10 && <Button type="button" variant="outline" size="sm" className="rounded-full" onClick={() => setQuestions((qs) => [...qs, ""])} data-testid="guest-invite-add-question">+ Add a question</Button>}
          </div>
          )}
          {(!(noteOpen || f.note) || !(qsOpen || questions.length > 0)) && (
            <div className="flex flex-wrap gap-x-5 gap-y-2 sm:col-span-2">
              {!(noteOpen || f.note) && <button type="button" onClick={() => setNoteOpen(true)} className="text-sm font-semibold text-[#053877] hover:underline dark:text-[#8fb5e8]" data-testid="invite-add-note">+ Add a note</button>}
              {!(qsOpen || questions.length > 0) && <button type="button" onClick={() => { setQsOpen(true); setQuestions([""]); }} className="text-sm font-semibold text-[#053877] hover:underline dark:text-[#8fb5e8]" data-testid="invite-add-questions">+ Add your own questions</button>}
            </div>
          )}
          {/* Where people watch the show (25 Nov: "Yes, build it", the watch page for everyone): a studio or stream-in show plays there. */}
          {(where === "studio" || isOutside(where)) && <div className="sm:col-span-2"><WatchLinkCard note="send it to your guest so they can share it" testId="invite-watch" /></div>}
          <div className="flex flex-col gap-3 border-t border-border pt-4 sm:col-span-2 sm:flex-row sm:items-center sm:gap-4">
            <Button type="submit" disabled={send.isPending || !f.guestName.trim() || !f.guestEmail.trim()} className="h-11 shrink-0 rounded-full bg-[#F0A71F] px-6 text-[15px] font-bold text-[#1d1300] hover:bg-[#e09612]" data-testid="guest-invite-submit">{send.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}Send invite</Button>
            <div className="min-w-0 flex-1 text-xs text-muted-foreground" data-testid="invite-sender">
              {editSlug === null ? (
                <p className="[text-wrap:pretty]">From <b className="text-foreground">{sender.data?.address ?? "…"}</b>. Replies come to you. {!sender.data?.fromShow && <button type="button" onClick={() => setEditSlug(sender.data?.slug ?? "")} className="font-semibold text-[#053877] underline underline-offset-2 dark:text-[#8fb5e8]" data-testid="invite-sender-edit">Change</button>}</p>
              ) : (
                <div className="flex flex-wrap items-center gap-2">
                  <span>From</span>
                  <Input value={editSlug} onChange={(e) => setEditSlug(e.target.value.toLowerCase())} className="h-8 w-48" maxLength={30} data-testid="invite-sender-input" />
                  <span>@militaryvoices.ai</span>
                  <Button type="button" size="sm" className="h-8 rounded-full" disabled={saveSlug.isPending || editSlug.trim().length < 3} onClick={() => saveSlug.mutate()}>Save</Button>
                  <Button type="button" size="sm" variant="ghost" className="h-8" onClick={() => setEditSlug(null)}>Cancel</Button>
                </div>
              )}
            </div>
            <button type="button" onClick={() => setPreview((v) => !v)} className="inline-flex shrink-0 items-center gap-1.5 self-start text-sm font-semibold text-[#053877] hover:underline sm:self-auto dark:text-[#8fb5e8]" aria-expanded={preview} data-testid="invite-preview-toggle"><Eye className="h-4 w-4" />{preview ? "Hide the email" : "Preview the email"}</button>
          </div>
        </form>
        {preview && <InvitePreview who={sender.data?.who ?? "Your host"} show={sender.data?.show ?? ""} studioLink={sender.data?.studioLink ?? ""} guestName={f.guestName} when={f.when} where={where} link={f.zoomLink.trim()} linkLater={linkLater} note={f.note} />}
      </div>
      </div>
      </>}
    </div>
  );
}

/**
 * The email the guest gets, drawn from what's in the form (Andrew, 26 Nov: "Show them what it will look like").
 * The words are sendInterviewInvite's in server/email.ts: change them there and here together.
 */
function InvitePreview({ who, show, studioLink, guestName, when, where, link, linkLater, note }: { who: string; show: string; studioLink: string; guestName: string; when: string; where: Where; link: string; linkLater: boolean; note: string }) {
  const first = guestName.trim().split(/\s+/)[0] || "there";
  const whenText = whenLabel(when);
  const other = isOutside(where) ? otherLinkCopy(where, who) : null;
  const url = (u: string) => <span className="break-all text-[#053877] underline underline-offset-2 dark:text-[#8fb5e8]">{u}</span>;
  return (
    <div className="mt-4 rounded-xl border border-border bg-[#fbfcfe] p-4 text-[13px] leading-relaxed dark:bg-white/5" data-testid="invite-preview">
      <p className="border-b border-border pb-2 text-xs text-muted-foreground"><b className="text-foreground">{who} via MilitaryVoices.ai</b> · {who} invites you to be a guest on {show || "their podcast"}</p>
      <p className="mt-2.5 text-[10.5px] font-bold uppercase tracking-[0.14em] text-[#B9770E]">You're invited</p>
      <p className="mt-0.5 text-[15px] font-bold [text-wrap:balance]">Hi {first}, you're invited to {show || "the podcast"}</p>
      <p className="mt-1.5">{who} would like you as a guest.</p>
      {whenText && <p className="mt-1"><b>When:</b> {whenText}</p>}
      {where === "studio" && <>
        <p className="mt-1"><b>Your link to join:</b> {studioLink ? url(studioLink) : "your studio link"}</p>
        <p className="mt-1 text-foreground/80">Open it at the time, allow your camera and microphone, and you're in the studio with {who}. No account needed.</p>
      </>}
      {where === "booth" && <>
        <p className="mt-1"><b>Your link to join:</b> a private link into your Radio show</p>
        <p className="mt-1 text-foreground/80">Open it on the day, allow your camera and microphone, and you're on the Radio with {who}. No account needed. It's live on MilitaryVoices Radio.</p>
      </>}
      {where === "zoom" && (link ? <p className="mt-1"><b>Zoom:</b> {url(link)}</p> : linkLater ? <p className="mt-1"><b>Zoom:</b> {who} will send you the Zoom link in a separate email.</p> : null)}
      {other && (link ? <>
        <p className="mt-1"><b>{other.label}:</b> {url(link)}</p>
        {other.help && <p className="mt-1 text-foreground/80">{other.help}</p>}
      </> : linkLater ? <p className="mt-1"><b>{other.label}:</b> {other.later}</p> : null)}
      {note.trim() && <p className="mt-2.5 whitespace-pre-line">{note}</p>}
      <p className="mt-2.5">To get ready, please answer a few quick questions and add the photo you'd like shown with your name. It takes about five minutes.</p>
      <span className="mt-2.5 inline-block rounded-full bg-[#053877] px-3.5 py-1.5 text-xs font-semibold text-white">Answer a few questions</span>
      <p className="mt-3 text-[11px] text-muted-foreground">Sent for {who} through MilitaryVoices.ai. Reply to this email to reach them.</p>
    </div>
  );
}
