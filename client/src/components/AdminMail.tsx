import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { AlertTriangle, Archive, ArchiveRestore, ArrowDownLeft, ArrowUpRight, Check, CheckCheck, Eye, Inbox, Loader2, Mail, MailOpen, Megaphone, MousePointerClick, PenSquare, Search, Send, SendHorizontal, Sparkles, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { ContactProfile } from "@/components/AdminContact";

/**
 * Mail: our side of email, like a mail app. Folders on the left (Needs a reply, Inbox, Sent,
 * Campaigns, Didn't send, All mail), the list in the middle, and one person's whole
 * conversation on the right: what they wrote, everything we sent them and what happened to
 * it (delivered, opened, clicked, bounced), and a box to write back.
 */

type Events = { delivered: boolean; opened: boolean; clicked: boolean; bounced: boolean; complained: boolean } | null;
type Item = { key: string; dir: "in" | "out" | "campaign"; email: string; name: string; subject: string; snippet: string; at: string; kind: string; status: string; ok: boolean; events: Events; inboundId?: number; broadcastId?: number; count?: number; opened?: number; clicked?: number; unread?: boolean; archived?: boolean };
type Msg = { key: string; dir: "in" | "out"; at: string; subject: string; body: string; from: string; kind: string; ok?: boolean; error?: string; events?: Events;
  inbound?: { id: number; status: string; draftFrom: string; draftSubject: string; draftText: string; summary: string } };
type Thread = { email: string; name: string; contact: { status: string; lifecycleStage: string; source: string } | null; messages: Msg[] };
type Folder = "needs" | "inbox" | "sent" | "campaigns" | "failed" | "all" | "archive";

/** What each kind of email we send is, in words. */
const KIND: Record<string, string> = {
  reply: "Reply", ack: "Automatic acknowledgement", "chat-send": "Written in Chat with Alex", "admin-send": "One-off email", "one-off": "One-off email",
  "directory-invite": "Directory invite", "inbound-forward": "Forwarded to the team inbox", "reminder-notice": "Reminder notice to the host", "crew-invite": "Crew invite",
  compose: "Written here", campaign: "Campaign", cadence: "Automation", sendBroadcastEmail: "Campaign",
  sendConfirmationEmail: "Slot confirmation", sendLoginCodeEmail: "Sign-in code", sendListenerQuestionEmail: "A listener's question, to the host",
  sendListenerReplyEmail: "The host's reply to a listener", sendGuestInviteEmail: "Guest invite", sendPodcastOwnerCodeEmail: "Podcast owner code",
  sendReminderConfirmationEmail: "Reminder set", sendSponsorThanksEmail: "Sponsor thanks", sendSponsorInquiryEmail: "Sponsor inquiry, to the team",
  sendPlatformInterestEmail: "Platform interest, to the team", sendPrepNudge: "Prep nudge", sendFinalNudge: "Final nudge", sendOnAirNudge: "On-air nudge",
  sendBookingAlert: "Booking alert", sendScheduleReference: "Schedule", sendHelpRequestAlert: "Help request, to the team", sendListenerStartingSoon: "Starting soon, to a listener",
  sendImportReadyEmail: "Import ready", other: "Email",
};
const kindOf = (k: string) => KIND[k] ?? (k.startsWith("cadence") ? "Automation" : k === "manual" ? "Campaign" : "Email");
const when = (iso: string) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const today = new Date();
  return d.toDateString() === today.toDateString() ? d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }) : d.toLocaleDateString(undefined, { month: "short", day: "numeric", ...(d.getFullYear() !== today.getFullYear() ? { year: "numeric" } : {}) });
};
const full = (iso: string) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? "" : d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }); };
const clean = (m: string) => m.replace(/^\d+:\s*/, "").replace(/^\{"message":"|"\}$/g, "");

/** What happened to an email we sent, as small chips. */
function Fate({ ok = true, events, error }: { ok?: boolean; events?: Events; error?: string }) {
  if (!ok) return <span className="inline-flex items-center gap-1 rounded-full bg-destructive/10 px-2 py-0.5 text-[11px] font-semibold text-destructive" title={error}><AlertTriangle className="h-3 w-3" /> Didn't send</span>;
  const e = events;
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {e?.bounced ? <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-[11px] font-semibold text-destructive">Bounced</span>
        : e?.clicked ? <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 dark:text-emerald-400"><MousePointerClick className="h-3 w-3" /> Clicked</span>
        : e?.opened ? <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 dark:text-emerald-400"><Eye className="h-3 w-3" /> Opened</span>
        : e?.delivered ? <span className="inline-flex items-center gap-1 rounded-full bg-[#053877]/10 px-2 py-0.5 text-[11px] font-semibold text-[#053877] dark:text-[#8fb5e8]"><CheckCheck className="h-3 w-3" /> Delivered</span>
        : <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground"><Check className="h-3 w-3" /> Sent</span>}
    </span>
  );
}

export function AdminMail() {
  const qc = useQueryClient();
  const [folder, setFolder] = useState<Folder>("needs");
  const [q, setQ] = useState("");
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState<Item | null>(null);
  // Opened from a link (Slack's "Open in Mail"): straight to that conversation.
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const withEmail = (p.get("with") ?? "").trim().toLowerCase();
    if (!withEmail.includes("@")) return;
    setOpen({ key: p.get("focus") ?? "", dir: "in", email: withEmail } as Item);
  }, []);
  const [composing, setComposing] = useState(false);
  const [profile, setProfile] = useState<string | null>(null);
  const { toast } = useToast();
  // Ticked items, for doing several at once (as in a mail app).
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const counts = useQuery<{ needs: number; unread: number; sentToday: number; failedWeek: number }>({ queryKey: ["/api/admin/mail/counts"], queryFn: async () => (await apiRequest("GET", "/api/admin/mail/counts")).json(), refetchInterval: 60_000 });
  const list = useQuery<{ items: Item[] }>({ queryKey: ["/api/admin/mail", folder, search], queryFn: async () => (await apiRequest("GET", `/api/admin/mail?folder=${folder}&q=${encodeURIComponent(search)}`)).json(), refetchInterval: 60_000 });
  useEffect(() => { setOpen(null); setPicked(new Set()); }, [folder, search]);
  const bulk = async (action: string, keys = Array.from(picked), quiet = false) => {
    if (!keys.length) return;
    if (action === "delete" && !window.confirm(`Delete ${keys.length === 1 ? "this email" : `these ${keys.length} emails`}? What came in is gone for good; anything we sent leaves the list (it was still sent).`)) return;
    try {
      await apiRequest("POST", "/api/admin/mail/bulk", { keys, action });
      if (!quiet) toast({ title: { read: "Marked as read", unread: "Marked as unread", archive: "Archived", unarchive: "Back in the Inbox", noreply: "Marked: no reply needed", delete: "Deleted" }[action] ?? "Done", description: keys.length > 1 ? `${keys.length} emails` : undefined });
      if (!quiet) setPicked(new Set());
      if (action === "delete" || action === "archive" || action === "unarchive") setOpen((o) => (o && keys.includes(o.key) ? null : o));
      refresh();
    } catch (e) { toast({ title: "Didn't work", description: clean((e as Error).message), variant: "destructive" }); }
  };
  const openItem = (it: Item) => { setOpen(it); setComposing(false); if (it.dir === "in" && it.unread) void bulk("read", [it.key], true); };
  const refresh = () => { void qc.invalidateQueries({ queryKey: ["/api/admin/mail"] }); void qc.invalidateQueries({ queryKey: ["/api/admin/mail/counts"] }); void qc.invalidateQueries({ queryKey: ["/api/admin/mail/thread"] }); void qc.invalidateQueries({ queryKey: ["/api/admin/inbound"] }); };
  const folders: { k: Folder; label: string; icon: typeof Inbox; n?: number; tone?: string }[] = [
    { k: "needs", label: "Needs a reply", icon: PenSquare, n: counts.data?.needs, tone: "bg-[#F0A71F] text-[#1a1200]" },
    { k: "inbox", label: "Inbox", icon: Inbox, n: counts.data?.unread },
    { k: "sent", label: "Sent", icon: SendHorizontal, n: counts.data?.sentToday },
    { k: "campaigns", label: "Campaigns", icon: Megaphone },
    { k: "failed", label: "Didn't send", icon: AlertTriangle, n: counts.data?.failedWeek, tone: "bg-destructive text-white" },
    { k: "all", label: "All mail", icon: ArrowUpRight },
    { k: "archive", label: "Archive", icon: Archive },
  ];
  const items = list.data?.items ?? [];
  const pickable = folder !== "campaigns";
  const allPicked = items.length > 0 && items.every((i) => picked.has(i.key));
  const pickedItems = items.filter((i) => picked.has(i.key));
  const anyIn = pickedItems.some((i) => i.dir === "in");
  const anyWaiting = pickedItems.some((i) => i.dir === "in" && (i.status === "new" || i.status === "drafted"));
  return (
    <>
    {profile && <ContactProfile email={profile} onClose={() => setProfile(null)} />}
    <div className="grid min-h-[70vh] gap-0 overflow-hidden rounded-2xl border border-border bg-card shadow-sm lg:grid-cols-[13rem_minmax(18rem,26rem)_1fr]" data-testid="admin-mail">
      {/* Folders */}
      <aside className="border-b border-border bg-muted/30 p-3 lg:border-b-0 lg:border-r">
        <Button onClick={() => { setComposing(true); setOpen(null); }} className="mb-3 h-10 w-full gap-2 rounded-xl bg-[#053877] text-white hover:bg-[#0a4a99]" data-testid="mail-compose"><PenSquare className="h-4 w-4" /> Write an email</Button>
        <nav className="flex gap-1 overflow-x-auto lg:flex-col">
          {folders.map((f) => (
            <button key={f.k} type="button" onClick={() => { setFolder(f.k); setComposing(false); }} className={`flex shrink-0 items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm font-medium transition-colors ${folder === f.k ? "bg-[#053877]/10 text-[#053877] dark:bg-white/10 dark:text-white" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`} data-testid={`mail-folder-${f.k}`}>
              <f.icon className="h-4 w-4" /> <span className="flex-1">{f.label}</span>
              {!!f.n && <span className={`rounded-full px-1.5 text-[11px] font-bold ${f.tone ?? "bg-muted text-muted-foreground"}`}>{f.n}</span>}
            </button>
          ))}
        </nav>
        <p className="mt-4 hidden text-[11px] leading-relaxed text-muted-foreground lg:block">Every email we send is here, whatever sent it: replies, campaigns, reminders, guest invites, sign-in codes (without the code).</p>
      </aside>

      {/* The list */}
      <section className="flex min-h-0 flex-col border-b border-border lg:border-b-0 lg:border-r">
        <form onSubmit={(e) => { e.preventDefault(); setSearch(q.trim()); }} className="flex items-center gap-2 border-b border-border p-3">
          <div className="relative flex-1"><Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search mail: a name, an address, words" className="h-9 pl-8" data-testid="mail-search" /></div>
          {search && <button type="button" onClick={() => { setQ(""); setSearch(""); }} className="rounded p-1 text-muted-foreground hover:text-foreground" aria-label="Clear search"><X className="h-4 w-4" /></button>}
        </form>
        {pickable && items.length > 0 && (
          <div className="flex min-h-[44px] flex-nowrap items-center gap-1 border-b border-border px-3 py-1.5" data-testid="mail-bulkbar">
            <input type="checkbox" checked={allPicked} onChange={() => setPicked(allPicked ? new Set() : new Set(items.map((i) => i.key)))} className="mr-1 h-4 w-4 accent-[#053877]" aria-label="Select all" data-testid="mail-pick-all" />
            {picked.size === 0 ? <span className="text-xs text-muted-foreground">Select to mark read, archive or delete</span> : (
              <>
                <span className="mr-1 text-xs font-semibold">{picked.size} selected</span>
                {anyIn && <BulkIcon label="Mark as read" icon={MailOpen} onClick={() => void bulk("read")} testId="mail-bulk-read" />}
                {anyIn && <BulkIcon label="Mark as unread" icon={Mail} onClick={() => void bulk("unread")} />}
                {anyIn && (folder === "archive"
                  ? <BulkIcon label="Move to Inbox" icon={ArchiveRestore} onClick={() => void bulk("unarchive")} />
                  : <BulkIcon label="Archive" icon={Archive} onClick={() => void bulk("archive")} testId="mail-bulk-archive" />)}
                {anyWaiting && <BulkIcon label="No reply needed" icon={Check} onClick={() => void bulk("noreply")} />}
                <BulkIcon label="Delete" icon={Trash2} onClick={() => void bulk("delete")} testId="mail-bulk-delete" danger />
              </>
            )}
          </div>
        )}
        <ul className="flex-1 divide-y divide-border overflow-y-auto" style={{ maxHeight: "75vh" }}>
          {list.isLoading && <li className="flex justify-center p-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></li>}
          {!list.isLoading && !list.data?.items.length && <li className="p-8 text-center text-sm text-muted-foreground">{folder === "needs" ? "Nothing waiting. Everyone who wrote in has an answer." : folder === "failed" ? "Nothing failed to send." : folder === "archive" ? "Nothing archived." : "Nothing here."}</li>}
          {items.map((it) => {
            const on = open?.key === it.key;
            const waiting = it.dir === "in" && (it.status === "new" || it.status === "drafted");
            const bold = it.dir === "in" && it.unread;
            return (
              <li key={it.key} className={`flex items-start ${picked.has(it.key) ? "bg-[#F0A71F]/[0.08]" : ""}`}>
                {pickable && <input type="checkbox" checked={picked.has(it.key)} onChange={() => setPicked((p) => { const n = new Set(p); n.has(it.key) ? n.delete(it.key) : n.add(it.key); return n; })} className="ml-3 mt-3.5 h-4 w-4 shrink-0 accent-[#053877]" aria-label={`Select ${it.subject}`} data-testid="mail-pick" />}
                <button type="button" onClick={() => openItem(it)} className={`min-w-0 flex-1 px-3 py-2.5 text-left transition-colors ${on ? "bg-[#053877]/[0.07] dark:bg-white/[0.07]" : "hover:bg-muted/60"}`} data-testid="mail-item">
                  <div className="flex items-center gap-2">
                    {bold && <span className="h-2 w-2 shrink-0 rounded-full bg-[#2563eb]" aria-label="Unread" />}
                    {it.dir === "in" ? <ArrowDownLeft className="h-3.5 w-3.5 shrink-0 text-[#b36b00]" aria-label="Came in" /> : it.dir === "campaign" ? <Megaphone className="h-3.5 w-3.5 shrink-0 text-[#053877] dark:text-[#8fb5e8]" aria-label="Campaign" /> : <ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-[#053877] dark:text-[#8fb5e8]" aria-label="We sent" />}
                    <span className={`min-w-0 flex-1 truncate text-sm ${bold ? "font-bold" : waiting ? "font-semibold" : "font-medium text-foreground/85"}`}>{it.dir === "campaign" ? `${it.name} · ${it.count} ${it.count === 1 ? "person" : "people"}` : it.dir === "out" ? `To ${it.email}` : it.name}</span>
                    <span className="shrink-0 text-[11px] text-muted-foreground">{when(it.at)}</span>
                  </div>
                  <p className={`truncate text-[13px] ${bold ? "font-semibold" : ""}`}>{it.subject || "(no subject)"}</p>
                  <div className="mt-0.5 flex items-center gap-2">
                    <p className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{it.dir === "out" ? kindOf(it.kind) : it.dir === "campaign" ? `${it.opened ?? 0} opened · ${it.clicked ?? 0} clicked` : it.snippet}</p>
                    {waiting ? <span className="shrink-0 rounded-full bg-[#F0A71F]/20 px-2 py-0.5 text-[10px] font-bold text-[#8a5a00] dark:text-[#F0A71F]">Needs a reply</span>
                      : it.dir === "in" && it.status === "sent" ? <span className="shrink-0 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-bold text-emerald-700 dark:text-emerald-400">Answered</span>
                      : it.dir === "out" ? <Fate ok={it.ok} events={it.events} /> : null}
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      {/* Reading */}
      <section className="min-h-0 overflow-y-auto" style={{ maxHeight: "82vh" }}>
        {composing ? <Compose onSent={() => { setComposing(false); refresh(); }} />
          : open?.dir === "campaign" && open.broadcastId ? <CampaignView id={open.broadcastId} />
          : open ? <ThreadView email={open.email} focus={open.key} onChanged={refresh} onProfile={setProfile} />
          : <div className="flex h-full min-h-[40vh] items-center justify-center p-8 text-center text-sm text-muted-foreground">Pick an email to read the whole conversation.</div>}
      </section>
    </div>
    </>
  );
}

/** One person: every email both ways, oldest first, and a box to write back. */
export function ThreadView({ email, focus, onChanged, onProfile }: { email: string; focus: string; onChanged: () => void; onProfile?: (email: string) => void }) {
  const { toast } = useToast();
  const t = useQuery<Thread>({ queryKey: ["/api/admin/mail/thread", email], queryFn: async () => (await apiRequest("GET", `/api/admin/mail/thread?email=${encodeURIComponent(email)}`)).json() });
  const waiting = [...(t.data?.messages ?? [])].reverse().find((m) => m.dir === "in" && m.inbound && (m.inbound.status === "new" || m.inbound.status === "drafted"));
  const lastIn = [...(t.data?.messages ?? [])].reverse().find((m) => m.dir === "in");
  const [from, setFrom] = useState("team");
  const [subject, setSubject] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  // A waiting message opens with its suggested reply in the box.
  useEffect(() => {
    setFrom(waiting?.inbound?.draftFrom === "riccoh" ? "riccoh" : "team");
    setSubject(waiting?.inbound?.draftSubject || (lastIn ? (lastIn.subject.startsWith("Re:") ? lastIn.subject : `Re: ${lastIn.subject}`) : ""));
    setText(waiting?.inbound?.draftText ?? "");
  }, [email, waiting?.key, lastIn?.key]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (t.data) document.getElementById(`mail-${focus}`)?.scrollIntoView({ block: "center" }); }, [t.data, focus]);
  const send = async () => {
    if (!text.trim()) return;
    setBusy(true);
    try {
      if (waiting?.inbound && (from === "team" || from === "riccoh")) await apiRequest("POST", `/api/admin/inbound/${waiting.inbound.id}/reply`, { from, subject, text });
      else await apiRequest("POST", "/api/admin/chat/send", { to: email, from, subject: subject || "Hello from MilitaryVoices.ai", text });
      toast({ title: "Sent", description: `To ${email}. It's in Sent now.` });
      setText("");
      await t.refetch();
      onChanged();
    } catch (e) { toast({ title: "Not sent", description: clean((e as Error).message), variant: "destructive" }); } finally { setBusy(false); }
  };
  const noNeed = async () => {
    if (!waiting?.inbound) return;
    await apiRequest("POST", `/api/admin/inbound/${waiting.inbound.id}/ignore`, {}).catch(() => {});
    toast({ title: "Marked: no reply needed" });
    await t.refetch();
    onChanged();
  };
  if (t.isLoading) return <div className="flex justify-center p-10"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;
  if (!t.data) return null;
  return (
    <div className="flex min-h-full flex-col" data-testid="mail-thread">
      <header className="sticky top-0 z-10 border-b border-border bg-card/95 px-5 py-3 backdrop-blur">
        {onProfile ? <button type="button" onClick={() => onProfile(email)} className="text-base font-semibold hover:underline" data-testid="mail-open-profile">{t.data.name}</button> : <p className="text-base font-semibold">{t.data.name}</p>}
        <p className="text-xs text-muted-foreground">{t.data.email}{t.data.contact ? ` · ${t.data.contact.lifecycleStage || t.data.contact.status}` : ""} · {t.data.messages.length} {t.data.messages.length === 1 ? "email" : "emails"}</p>
      </header>
      <ol className="flex-1 space-y-3 p-5">
        {t.data.messages.map((m) => (
          <li key={m.key} id={`mail-${m.key}`} className={`flex ${m.dir === "out" ? "justify-end" : ""}`}>
            <div className={`w-full max-w-[42rem] rounded-2xl border p-4 ${m.dir === "out" ? "border-[#053877]/20 bg-[#053877]/[0.04] dark:bg-white/[0.04]" : "border-border bg-background"} ${m.key === focus ? "ring-2 ring-[#F0A71F]/60" : ""}`}>
              <div className="mb-1.5 flex flex-wrap items-center gap-2 text-xs">
                <span className="font-semibold">{m.dir === "in" ? m.from : kindOf(m.kind)}</span>
                <span className="text-muted-foreground">{full(m.at)}</span>
                <span className="ml-auto">{m.dir === "out" ? <Fate ok={m.ok} events={m.events} error={m.error} /> : m.inbound?.status === "sent" ? <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 dark:text-emerald-400">Answered</span> : m.inbound && (m.inbound.status === "new" || m.inbound.status === "drafted") ? <span className="rounded-full bg-[#F0A71F]/20 px-2 py-0.5 text-[11px] font-semibold text-[#8a5a00] dark:text-[#F0A71F]">Needs a reply</span> : null}</span>
              </div>
              <p className="text-sm font-semibold">{m.subject || "(no subject)"}</p>
              <p className="mt-1.5 whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground/90">{m.body || "(no words kept)"}</p>
              {m.dir === "in" && m.inbound && <Attachments inboundId={m.inbound.id} />}
            </div>
          </li>
        ))}
      </ol>
      {/* Write back: a waiting message's suggested reply is already in the box. */}
      <div className="sticky bottom-0 border-t border-border bg-card p-4" data-testid="mail-reply">
        {waiting && <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-[#8a5a00] dark:text-[#F0A71F]"><Sparkles className="h-3.5 w-3.5" /> Suggested reply to their last email. Change anything, then send.</p>}
        <div className="flex flex-wrap gap-2">
          <select value={from} onChange={(e) => setFrom(e.target.value)} className="h-9 rounded-md border border-input bg-background px-2 text-sm" aria-label="Send as">
            <option value="team">From the team (hello@)</option>
            <option value="riccoh">From Riccoh</option>
            <option value="michael">From Michael</option>
            <option value="alex">From Alex</option>
          </select>
          <Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Subject" className="h-9 min-w-0 flex-1" />
        </div>
        <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={waiting ? 8 : 4} placeholder={`Write to ${t.data.name}…`} className="mt-2 text-sm" data-testid="mail-reply-text" />
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Button onClick={() => void send()} disabled={busy || !text.trim() || !subject.trim()} className="h-9 gap-1.5 rounded-full bg-[#053877] text-white hover:bg-[#0a4a99]" data-testid="mail-send">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Send</Button>
          {waiting && <button type="button" onClick={() => void noNeed()} className="text-xs font-semibold text-muted-foreground underline underline-offset-2 hover:text-foreground">No reply needed</button>}
          <span className="ml-auto text-[11px] text-muted-foreground">It threads under their last email, and shows here straight away.</span>
        </div>
      </div>
    </div>
  );
}

/** A campaign: how it did, and what it said. */
function CampaignView({ id }: { id: number }) {
  const c = useQuery<{ subject: string; body: string; sentAt: string; recipients: number; source: string; delivered: number; opened: number; clicked: number; bounced: number; complained: number }>({ queryKey: ["/api/admin/mail/campaign", id], queryFn: async () => (await apiRequest("GET", `/api/admin/mail/campaign/${id}`)).json() });
  if (c.isLoading || !c.data) return <div className="flex justify-center p-10"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;
  const d = c.data;
  const pct = (n: number) => (d.recipients ? `${Math.round((n / d.recipients) * 100)}%` : "–");
  return (
    <div className="space-y-4 p-5" data-testid="mail-campaign">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">{d.source.startsWith("cadence") ? "Automation" : "Campaign"} · {full(d.sentAt)}</p>
        <h3 className="mt-1 text-xl font-semibold">{d.subject}</h3>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[["Sent to", String(d.recipients), "people"], ["Opened", String(d.opened), pct(d.opened)], ["Clicked", String(d.clicked), pct(d.clicked)], ["Bounced", String(d.bounced), pct(d.bounced)]].map(([l, v, s]) => (
          <div key={l} className="rounded-xl border border-border p-3"><p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{l}</p><p className="mt-1 text-2xl font-bold tabular-nums">{v}</p><p className="text-xs text-muted-foreground">{s}</p></div>
        ))}
      </div>
      <div className="rounded-2xl border border-border bg-background p-4">
        <p className="whitespace-pre-wrap text-sm leading-relaxed">{d.body || "(no words kept)"}</p>
      </div>
      <p className="text-xs text-muted-foreground">Who opened and clicked, and sending another, are in Campaigns.</p>
    </div>
  );
}

/** A new email to anyone. */
function Compose({ onSent }: { onSent: () => void }) {
  const { toast } = useToast();
  const [to, setTo] = useState("");
  const [from, setFrom] = useState("team");
  const [subject, setSubject] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const send = async () => {
    setBusy(true);
    try {
      await apiRequest("POST", "/api/admin/chat/send", { to: to.trim(), from, subject, text });
      toast({ title: "Sent", description: `To ${to.trim()}. It's in Sent now.` });
      onSent();
    } catch (e) { toast({ title: "Not sent", description: clean((e as Error).message), variant: "destructive" }); } finally { setBusy(false); }
  };
  return (
    <div className="space-y-3 p-5" data-testid="mail-compose-form">
      <h3 className="text-lg font-semibold">New email</h3>
      <Input value={to} onChange={(e) => setTo(e.target.value)} placeholder="To: their email" type="email" className="h-10" />
      <div className="flex flex-wrap gap-2">
        <select value={from} onChange={(e) => setFrom(e.target.value)} className="h-10 rounded-md border border-input bg-background px-2 text-sm" aria-label="Send as">
          <option value="team">From the team (hello@)</option>
          <option value="riccoh">From Riccoh</option>
          <option value="michael">From Michael</option>
          <option value="alex">From Alex</option>
        </select>
        <Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Subject" className="h-10 min-w-0 flex-1" />
      </div>
      <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={12} placeholder="Write your email…" className="text-sm" />
      <Button onClick={() => void send()} disabled={busy || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to.trim()) || !subject.trim() || !text.trim()} className="h-10 gap-1.5 rounded-full bg-[#053877] text-white hover:bg-[#0a4a99]">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Send</Button>
    </div>
  );
}

/** One bulk action: just the icon, its name on hover (and for screen readers). */
function BulkIcon({ label, icon: Icon, onClick, testId, danger }: { label: string; icon: typeof Mail; onClick: () => void; testId?: string; danger?: boolean }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button type="button" onClick={onClick} aria-label={label} data-testid={testId}
          className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md ${danger ? "text-destructive hover:bg-destructive/10" : "text-foreground hover:bg-muted"}`}>
          <Icon className="h-4 w-4" />
        </button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

/** Files that came with an inbound email: download them, or make a photo the sender's headshot. */
function Attachments({ inboundId }: { inboundId: number }) {
  const { toast } = useToast();
  const [busy, setBusy] = useState("");
  const q = useQuery<{ id: string; filename: string; contentType: string; size: number; url: string }[]>({
    queryKey: ["/api/admin/inbound", inboundId, "attachments"],
    queryFn: async () => (await apiRequest("GET", `/api/admin/inbound/${inboundId}/attachments`)).json(),
    staleTime: 5 * 60_000,
  });
  const files = q.data ?? [];
  if (!files.length) return null;
  const headshot = async (id: string) => {
    setBusy(id);
    try {
      await apiRequest("POST", `/api/admin/inbound/${inboundId}/attachments/${id}/headshot`);
      toast({ title: "Headshot updated", description: "It's their photo now, with a print copy for the magazine." });
    } catch (e) {
      toast({ title: "Couldn't use it", description: clean((e as Error).message), variant: "destructive" });
    } finally {
      setBusy("");
    }
  };
  return (
    <div className="mt-3 flex flex-wrap gap-2" data-testid="mail-attachments">
      {files.map((f) => (
        <div key={f.id} className="flex items-center gap-2 rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs">
          <a href={f.url} target="_blank" rel="noreferrer" className="max-w-[14rem] truncate font-semibold hover:underline">{f.filename}</a>
          <span className="text-muted-foreground">{f.size > 1048576 ? `${(f.size / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(f.size / 1024))} KB`}</span>
          {f.contentType.startsWith("image/") && (
            <button type="button" disabled={!!busy} onClick={() => void headshot(f.id)} className="rounded-md bg-[#053877] px-2 py-0.5 font-semibold text-white hover:bg-[#0a4a99] disabled:opacity-50" data-testid="mail-use-headshot">
              {busy === f.id ? "Saving…" : "Use as their headshot"}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
