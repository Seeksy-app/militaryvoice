import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, Loader2, MonitorPlay, ShieldCheck, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { IconTile } from "@/components/ui/icon-tile";
import { useToast } from "@/hooks/use-toast";
import { adminGet, adminSend } from "@/lib/adminApi";

const LINKS = { studio: "https://www.militaryvoices.ai/studio/control", admin: "https://www.militaryvoices.ai/admin" };
const KIND = {
  studio: { endpoint: "/api/admin/studio-hosts", icon: MonitorPlay, title: "Studio hosts", empty: "No studio hosts yet.", testid: "studio-hosts",
    blurb: "This event's studio console: switch scenes, roll video, bring people on, go live. Nothing else in admin, and no other event. They sign in with their own email at the link." },
  admin: { endpoint: "/api/admin/event-admins", icon: ShieldCheck, title: "Event admins", empty: "No event admins yet.", testid: "event-admins",
    blurb: "Run this event in admin: its studio, lineup, sponsors, magazine, texts and money. Nothing of the platform (members, CRM, other events). They sign in with their own email at the link." },
} as const;

/**
 * Admin → (an event) → Team: that event's studio hosts. They get its studio
 * console (scenes, video, people, going live) at one link, signed in as
 * themselves; nothing else in admin, and nothing on any other event.
 */
export function StudioHostsCard({ eventId, kind = "studio" }: { eventId: number; kind?: "studio" | "admin" }) {
  const K = KIND[kind];
  const LINK = LINKS[kind];
  const { toast } = useToast();
  const qc = useQueryClient();
  const q = useQuery<{ email: string; name: string }[]>({ queryKey: [K.endpoint, eventId], queryFn: () => adminGet(`${K.endpoint}?eventId=${eventId}`) });
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const save = async (emails: string[]) => {
    setBusy(true);
    try {
      await adminSend("PUT", K.endpoint, { eventId, emails });
      await qc.invalidateQueries({ queryKey: [K.endpoint, eventId] });
      setEmail("");
    } catch (e) {
      toast({ title: "Couldn't save", description: (e as Error).message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };
  const list = q.data ?? [];
  return (
    <section className="rounded-2xl border border-border bg-card p-5" data-testid={K.testid}>
      <div className="flex flex-wrap items-start gap-4">
        <IconTile icon={K.icon} />
        <div className="min-w-0 flex-1">
          <h3 className="text-lg font-bold tracking-tight">{K.title}</h3>
          <p className="mt-0.5 text-sm text-muted-foreground [text-wrap:pretty]">{K.blurb}</p>
        </div>
        <Button variant="outline" className="gap-1.5 rounded-full" onClick={() => { void navigator.clipboard.writeText(LINK); setCopied(true); setTimeout(() => setCopied(false), 1500); }} data-testid="studio-hosts-copy">
          {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />} {copied ? "Copied" : "Copy their link"}
        </Button>
      </div>
      <ul className="mt-4 divide-y divide-border rounded-xl border border-border">
        {list.length === 0 && <li className="px-4 py-3 text-sm text-muted-foreground">{K.empty}</li>}
        {list.map((h) => (
          <li key={h.email} className="flex items-center gap-3 px-4 py-2.5">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{h.name || h.email}</p>
              {h.name && <p className="truncate text-xs text-muted-foreground">{h.email}</p>}
            </div>
            <Button variant="ghost" size="sm" className="gap-1 text-muted-foreground" disabled={busy} onClick={() => void save(list.map((x) => x.email).filter((e) => e !== h.email))} data-testid="studio-hosts-remove">
              <X className="h-3.5 w-3.5" /> Remove
            </Button>
          </li>
        ))}
      </ul>
      <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (email.trim()) void save([...list.map((x) => x.email), email.trim()]); }}>
        <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Their sign-in email" className="h-10" data-testid="studio-hosts-email" />
        <Button type="submit" disabled={busy || !email.trim()} className="h-10 rounded-full bg-[#053877] px-5 text-white hover:bg-[#0a4a99]" data-testid="studio-hosts-add">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Add"}
        </Button>
      </form>
    </section>
  );
}
