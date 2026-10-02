import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, ImagePlus, Loader2, Mail, Trash2, UserPlus, Users } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { IconTile } from "@/components/ui/icon-tile";

/**
 * Guests on a slot: who's appearing with the podcaster, each with their own
 * link into the green room (no account needed). The podcaster adds them on
 * their event page; the crew can add them for a podcaster from the signup.
 */

export type Guest = { id: number; signupId: number; name: string; title: string; intro: string; photoUrl: string; email: string; link: string; invitedAt: string; joinedAt: string };

const when = (iso: string) => (iso ? new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "");

export function GuestsEditor({ signupId, admin = false, compact = false }: { signupId: number; admin?: boolean; compact?: boolean }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const base = admin ? "/api/admin/guests" : "/api/host/guests";
  const key = [base, signupId];
  const { data, isLoading } = useQuery<{ guests: Guest[] }>({ queryKey: key, queryFn: async () => (await apiRequest("GET", `${base}?signupId=${signupId}`)).json() });
  const guests = data?.guests ?? [];
  const put = (g: Guest) => qc.setQueryData<{ guests: Guest[] }>(key, (d) => ({ guests: (d?.guests ?? []).map((x) => (x.id === g.id ? g : x)) }));
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ name: "", title: "", email: "" });
  const [busy, setBusy] = useState(false);
  const say = (e: unknown) => (e as Error).message.replace(/^\d+:\s*/, "").replace(/^\{"message":"|"\}$/g, "");

  const add = async () => {
    if (!draft.name.trim()) return;
    setBusy(true);
    try {
      const r = await apiRequest("POST", base, { signupId, ...draft });
      const { guest } = (await r.json()) as { guest: Guest };
      qc.setQueryData<{ guests: Guest[] }>(key, (d) => ({ guests: [...(d?.guests ?? []), guest] }));
      setDraft({ name: "", title: "", email: "" });
      setAdding(false);
      toast({ title: `${guest.name} added`, description: "Copy their link, or email it to them." });
    } catch (e) {
      toast({ title: "Guest not added", description: say(e), variant: "destructive" });
    } finally { setBusy(false); }
  };

  return (
    <div className="space-y-3" data-testid="guests-editor">
      {!compact && (
        <div className="flex items-start gap-3">
          <IconTile icon={Users} />
          <div>
            <p className="text-base font-bold">{admin ? "Their guests" : "Your guests"}</p>
            <p className="text-sm text-muted-foreground">Everyone appearing with {admin ? "them" : "you"}. Each gets their own link into the green room: no account, and they come on stage with {admin ? "the host" : "you"}.</p>
          </div>
        </div>
      )}
      {isLoading ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : guests.map((g) => <GuestCard key={g.id} g={g} base={base} onSaved={put} onGone={() => qc.setQueryData<{ guests: Guest[] }>(key, (d) => ({ guests: (d?.guests ?? []).filter((x) => x.id !== g.id) }))} />)}
      {adding ? (
        <div className="space-y-2 rounded-2xl border-2 border-dashed border-[#053877]/30 p-3" data-testid="guest-add-form">
          <div className="grid gap-2 sm:grid-cols-2">
            <Input autoFocus value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Their name (as read on air)" maxLength={80} data-testid="guest-name" />
            <Input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} placeholder="Title: Founder, Veterans First" maxLength={120} data-testid="guest-title" />
          </div>
          <Input type="email" value={draft.email} onChange={(e) => setDraft({ ...draft, email: e.target.value })} onKeyDown={(e) => { if (e.key === "Enter") void add(); }} placeholder="Their email (optional, to send them their link)" maxLength={200} data-testid="guest-email" />
          <p className="text-[11px] text-muted-foreground">You can add a few lines to introduce them and a photo next; both can come later.</p>
          <div className="flex gap-2">
            <Button onClick={() => void add()} disabled={busy || !draft.name.trim()} className="gap-1.5 rounded-full bg-[#053877] hover:bg-[#0a4a99]" data-testid="guest-save">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Add guest</Button>
            <Button variant="outline" onClick={() => setAdding(false)} className="rounded-full">Cancel</Button>
          </div>
        </div>
      ) : (
        <Button variant="outline" onClick={() => setAdding(true)} className="w-full gap-1.5 rounded-xl border-dashed" data-testid="guest-add"><UserPlus className="h-4 w-4" /> Add a guest</Button>
      )}
    </div>
  );
}

function GuestCard({ g, base, onSaved, onGone }: { g: Guest; base: string; onSaved: (g: Guest) => void; onGone: () => void }) {
  const { toast } = useToast();
  const [f, setF] = useState({ name: g.name, title: g.title, intro: g.intro, email: g.email });
  const [busy, setBusy] = useState<"" | "photo" | "invite" | "remove">("");
  const [copied, setCopied] = useState(false);
  const photoIn = useRef<HTMLInputElement>(null);
  const say = (e: unknown) => (e as Error).message.replace(/^\d+:\s*/, "").replace(/^\{"message":"|"\}$/g, "");
  // Saved as they leave each box.
  const save = async (k: keyof typeof f) => {
    if (f[k] === g[k]) return;
    try {
      const r = await apiRequest("PATCH", `${base}/${g.id}`, { [k]: f[k] });
      onSaved(((await r.json()) as { guest: Guest }).guest);
    } catch (e) {
      toast({ title: "Not saved", description: say(e), variant: "destructive" });
      setF((x) => ({ ...x, [k]: g[k] }));
    }
  };
  const photo = async (file: File) => {
    setBusy("photo");
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await fetch(`${base}/${g.id}/photo`, { method: "POST", body: fd, credentials: "include" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.message || "Couldn't use that photo.");
      onSaved(j.guest);
    } catch (e) {
      toast({ title: "Photo not added", description: say(e), variant: "destructive" });
    } finally { setBusy(""); if (photoIn.current) photoIn.current.value = ""; }
  };
  const invite = async () => {
    await save("email");
    setBusy("invite");
    try {
      const r = await apiRequest("POST", `${base}/${g.id}/invite`, {});
      onSaved(((await r.json()) as { guest: Guest }).guest);
      toast({ title: `Link sent to ${g.name}`, description: f.email });
    } catch (e) {
      toast({ title: "Not sent", description: say(e), variant: "destructive" });
    } finally { setBusy(""); }
  };
  const remove = async () => {
    if (!window.confirm(`Remove ${g.name}? Their link stops working.`)) return;
    setBusy("remove");
    try { await apiRequest("DELETE", `${base}/${g.id}`); onGone(); } catch (e) { toast({ title: "Not removed", description: say(e), variant: "destructive" }); setBusy(""); }
  };
  return (
    <div className="space-y-2.5 rounded-2xl border border-border bg-background p-3" data-testid="guest-card">
      <div className="flex gap-3">
        <input ref={photoIn} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => e.target.files?.[0] && void photo(e.target.files[0])} />
        <button type="button" onClick={() => photoIn.current?.click()} className="group relative flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-full border-2 border-dashed border-border bg-muted/40" aria-label={g.photoUrl ? "Change their photo" : "Add their photo"} data-testid="guest-photo">
          {g.photoUrl ? <img src={g.photoUrl} alt="" className="h-full w-full object-cover" /> : <ImagePlus className="h-5 w-5 text-muted-foreground" />}
          {busy === "photo" && <span className="absolute inset-0 flex items-center justify-center bg-black/40"><Loader2 className="h-4 w-4 animate-spin text-white" /></span>}
        </button>
        <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-2">
          <Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} onBlur={() => void save("name")} placeholder="Their name" maxLength={80} aria-label="Their name" />
          <Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} onBlur={() => void save("title")} placeholder="Their title, as shown on screen" maxLength={120} aria-label="Their title" />
        </div>
      </div>
      <Textarea value={f.intro} onChange={(e) => setF({ ...f, intro: e.target.value })} onBlur={() => void save("intro")} rows={2} maxLength={1200} placeholder="A few lines to introduce them (optional, can come later)" aria-label="Their intro" data-testid="guest-intro" />
      <Input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} onBlur={() => void save("email")} placeholder="Their email, to send them their link" maxLength={200} aria-label="Their email" />
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => void navigator.clipboard.writeText(g.link).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1600); })} className="gap-1.5 rounded-full" data-testid="guest-copy">{copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />} {copied ? "Copied" : "Copy their link"}</Button>
        <Button type="button" size="sm" onClick={() => void invite()} disabled={!f.email.trim() || busy === "invite"} className="gap-1.5 rounded-full bg-[#F0A71F] font-semibold text-[#1a1200] hover:bg-[#f5b94a]" data-testid="guest-invite">{busy === "invite" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Mail className="h-3.5 w-3.5" />} {g.invitedAt ? "Email it again" : "Email it to them"}</Button>
        <span className="text-[11px] text-muted-foreground">{g.joinedAt ? `✓ In the green room ${when(g.joinedAt)}` : g.invitedAt ? `Sent ${when(g.invitedAt)}` : ""}</span>
        <button type="button" onClick={() => void remove()} disabled={busy === "remove"} className="ml-auto rounded-full p-1.5 text-muted-foreground hover:bg-red-50 hover:text-destructive dark:hover:bg-red-950" aria-label={`Remove ${g.name}`}><Trash2 className="h-4 w-4" /></button>
      </div>
    </div>
  );
}

/** The crew's read-only look (run of show): who's on with this booking, and their intros. */
export function GuestsList({ signupId }: { signupId: number }) {
  const { data } = useQuery<{ guests: Guest[] }>({ queryKey: ["/api/admin/guests", signupId], queryFn: async () => (await apiRequest("GET", `/api/admin/guests?signupId=${signupId}`)).json() });
  const guests = data?.guests ?? [];
  if (!guests.length) return null;
  return (
    <div className="space-y-2" data-testid="guests-list">
      {guests.map((g) => (
        <div key={g.id} className="flex gap-2.5">
          {g.photoUrl ? <img src={g.photoUrl} alt="" className="h-9 w-9 shrink-0 rounded-full object-cover" /> : <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-bold">{g.name.slice(0, 1)}</span>}
          <div className="min-w-0 text-sm">
            <p className="font-semibold">{g.name}{g.title ? <span className="font-normal text-muted-foreground"> · {g.title}</span> : null}{g.joinedAt ? <span className="ml-1.5 text-[11px] font-semibold text-emerald-600">in the green room</span> : null}</p>
            {g.intro && <p className="whitespace-pre-line text-xs text-muted-foreground">{g.intro}</p>}
          </div>
        </div>
      ))}
    </div>
  );
}

