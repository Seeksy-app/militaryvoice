import { useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { Search, Headphones, Youtube, Globe, Send, Users, BadgeCheck } from "lucide-react";
import { NavBar } from "@/components/NavBar";
import { SiteFooter } from "@/components/SiteFooter";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SocialIconRow, parseSocialAccounts, formatFollowers } from "@/components/SocialIcons";
import { apiRequest, resolveUploadUrl } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { SERVICE_BRANCHES } from "@shared/schema";

/**
 * The MilitaryVoices directory: everyone's directory card in one place.
 *
 * The account comes first and events are something you can be invited to,
 * so there has to be somewhere an organizer can look. Public, like the
 * lineup: a name, a face, a show if they have one, where to follow them.
 * Organizers (admins, for now) can invite anyone on it to an event.
 */
interface Card {
  id: number;
  hostName: string;
  podcastName: string;
  photoUrl: string;
  branch: string;
  serviceStatus: string;
  podcaster: boolean;
  rssUrl: string;
  youtubeUrl: string;
  socialLinks: string;
  socialAccounts: string;
  onLineup: string;
}

const HEADLINE = { fontFamily: "'General Sans', 'Inter', sans-serif" } as const;

export default function Directory() {
  const [q, setQ] = useState("");
  const [kind, setKind] = useState<"all" | "podcasters" | "others">("all");
  const [branch, setBranch] = useState("any");
  const [open, setOpen] = useState<Card | null>(null);

  const { data: cards, isLoading } = useQuery<Card[]>({ queryKey: ["/api/directory"] });
  // Organizers see the invite button; the check fails quietly for everyone else.
  const { data: me } = useQuery<{ email: string } | null>({
    queryKey: ["/api/admin/me", "directory"],
    queryFn: async () => {
      const r = await fetch("/api/admin/me", { credentials: "include" });
      return r.ok ? r.json() : null;
    },
    retry: false,
  });

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (cards ?? []).filter((c) => {
      if (kind === "podcasters" && !c.podcaster) return false;
      if (kind === "others" && c.podcaster) return false;
      if (branch !== "any" && c.branch !== branch) return false;
      if (!needle) return true;
      return [c.hostName, c.podcastName, c.branch, c.serviceStatus].some((v) => v?.toLowerCase().includes(needle));
    });
  }, [cards, q, kind, branch]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <NavBar />

      <section className="bg-[#04102b] text-white">
        <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6 sm:py-16">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#F0A71F]">The directory</p>
          <h1 className="mt-2 max-w-3xl text-3xl font-bold tracking-tight sm:text-5xl" style={HEADLINE}>
            Military and veteran voices, ready to invite.
          </h1>
          <p className="mt-4 max-w-2xl text-base text-white/75 sm:text-lg">
            Podcasters, speakers and creators from the MilitaryVoices community. Every card is set up by the person on it.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link href="/host/dashboard">
              <Button className="rounded-full bg-[#F0A71F] font-semibold text-[#1a1200] hover:bg-[#f5b944]" data-testid="button-directory-join">
                Get your card in the directory
              </Button>
            </Link>
            <Link href="/platform">
              <Button variant="outline" className="rounded-full border-white/25 bg-white/10 text-white hover:bg-white/20 hover:text-white">
                Organizing an event?
              </Button>
            </Link>
          </div>
        </div>
      </section>

      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        {/* Search and filters */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name, show or branch" className="h-11 rounded-full pl-9" data-testid="input-directory-search" />
          </div>
          <div className="flex rounded-full border border-border bg-card p-1">
            {([["all", "Everyone"], ["podcasters", "Podcasters"], ["others", "Speakers & creators"]] as const).map(([k, label]) => (
              <button
                key={k}
                type="button"
                onClick={() => setKind(k)}
                className={`rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors ${kind === k ? "bg-[#053877] text-white" : "text-muted-foreground hover:text-foreground"}`}
                data-testid={`filter-directory-${k}`}
              >
                {label}
              </button>
            ))}
          </div>
          <Select value={branch} onValueChange={setBranch}>
            <SelectTrigger className="h-11 w-full rounded-full sm:w-48" data-testid="select-directory-branch">
              <SelectValue placeholder="Any branch" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="any">Any branch</SelectItem>
              {SERVICE_BRANCHES.filter((b) => b !== "Not applicable").map((b) => (
                <SelectItem key={b} value={b}>{b}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <p className="mt-4 text-sm text-muted-foreground" data-testid="text-directory-count">
          {isLoading ? "Loading…" : `${shown.length} ${shown.length === 1 ? "person" : "people"}`}
        </p>

        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {shown.map((c) => (
            <DirectoryCard key={c.id} card={c} onOpen={() => setOpen(c)} />
          ))}
        </div>

        {!isLoading && shown.length === 0 && (
          <div className="mt-6 rounded-2xl border border-dashed border-border p-10 text-center text-muted-foreground">
            Nobody matches that yet. Try a different search.
          </div>
        )}
      </main>

      <SiteFooter />

      <CardDialog card={open} onClose={() => setOpen(null)} canInvite={!!me} />
    </div>
  );
}

function who(c: Card) {
  return [c.serviceStatus, c.branch !== "Not applicable" ? c.branch : ""].filter(Boolean).join(" · ");
}

function DirectoryCard({ card: c, onOpen }: { card: Card; onOpen: () => void }) {
  const accounts = parseSocialAccounts(c.socialAccounts);
  const reach = accounts.reduce((n, a) => n + (a.followers ?? 0), 0);
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group flex h-full flex-col items-center rounded-2xl border border-border bg-card p-5 text-center shadow-sm transition-all hover:-translate-y-0.5 hover:border-[#053877]/40 hover:shadow-md"
      data-testid={`directory-card-${c.id}`}
    >
      <img src={resolveUploadUrl(c.photoUrl)} alt="" loading="lazy" className="h-24 w-24 rounded-full object-cover ring-4 ring-[#053877]/10" />
      <p className="mt-3 line-clamp-2 font-semibold leading-tight text-foreground" style={HEADLINE}>
        {c.podcaster ? c.podcastName : c.hostName}
      </p>
      {c.podcaster && <p className="mt-0.5 truncate text-sm text-muted-foreground">{c.hostName}</p>}
      {who(c) && <p className="mt-1 text-xs text-[#053877] dark:text-[#8ab4f8]">{who(c)}</p>}
      <div className="mt-auto flex flex-col items-center gap-2 pt-3">
        <SocialIconRow accounts={accounts} size="sm" variant="filled" className="justify-center" />
        <div className="flex flex-wrap justify-center gap-1.5">
          {reach > 0 && <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-foreground/80">{formatFollowers(reach)} followers</span>}
          {c.onLineup && <span className="rounded-full bg-[#F0A71F]/15 px-2 py-0.5 text-[11px] font-semibold text-[#8a5a00] dark:text-[#F0A71F]">On {c.onLineup}</span>}
        </div>
      </div>
    </button>
  );
}

function CardDialog({ card: c, onClose, canInvite }: { card: Card | null; onClose: () => void; canInvite: boolean }) {
  const { toast } = useToast();
  const [inviting, setInviting] = useState(false);
  const [eventId, setEventId] = useState<string>("");
  const [note, setNote] = useState("");
  const { data: events } = useQuery<{ id: number; name: string; startAtUtc: string }[]>({ queryKey: ["/api/events"], enabled: canInvite && !!c });
  const upcoming = (events ?? []).filter((e) => Date.parse(e.startAtUtc) > Date.now() - 86_400_000);
  const invite = useMutation({
    mutationFn: async () => (await apiRequest("POST", `/api/admin/directory/${c!.id}/invite`, { eventId: Number(eventId), message: note })).json(),
    onSuccess: () => {
      toast({ title: "Invitation sent", description: `${c?.hostName} has an email with the way in.` });
      setInviting(false);
      setNote("");
      onClose();
    },
    onError: (e: Error) => toast({ title: "Couldn't send it", description: e.message, variant: "destructive" }),
  });
  if (!c) return null;
  const accounts = parseSocialAccounts(c.socialAccounts);
  const listen = [
    c.rssUrl && { href: c.rssUrl, label: "Podcast feed", icon: Headphones },
    c.youtubeUrl && { href: c.youtubeUrl, label: "YouTube", icon: Youtube },
    c.socialLinks && { href: /^https?:\/\//.test(c.socialLinks) ? c.socialLinks : `https://${c.socialLinks}`, label: "Website", icon: Globe },
  ].filter(Boolean) as { href: string; label: string; icon: typeof Globe }[];

  return (
    <Dialog open={!!c} onOpenChange={(v) => { if (!v) { setInviting(false); onClose(); } }}>
      <DialogContent className="max-w-md" data-testid="dialog-directory-card">
        <DialogHeader className="items-center text-center">
          <img src={resolveUploadUrl(c.photoUrl)} alt="" className="h-28 w-28 rounded-full object-cover ring-4 ring-[#053877]/10" />
          <DialogTitle className="mt-3 text-xl" style={HEADLINE}>{c.podcaster ? c.podcastName : c.hostName}</DialogTitle>
          <DialogDescription>
            {c.podcaster ? `${c.hostName}${who(c) ? ` · ${who(c)}` : ""}` : who(c) || "MilitaryVoices member"}
          </DialogDescription>
        </DialogHeader>

        {c.onLineup && (
          <p className="flex items-center justify-center gap-1.5 text-sm font-medium text-[#8a5a00] dark:text-[#F0A71F]">
            <BadgeCheck className="h-4 w-4" /> On the lineup for {c.onLineup}
          </p>
        )}

        {accounts.length > 0 && (
          <div className="flex flex-col gap-1.5">
            {accounts.map((a) => (
              <a key={`${a.platform}-${a.username}`} href={a.url} target="_blank" rel="noreferrer" className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-sm hover:border-[#053877]/40">
                <span className="flex min-w-0 items-center gap-2">
                  <SocialIconRow accounts={[a]} size="sm" variant="filled" />
                  <span className="truncate">{a.displayName || a.username}</span>
                </span>
                {a.followers != null && <span className="shrink-0 tabular-nums text-muted-foreground">{formatFollowers(a.followers)}</span>}
              </a>
            ))}
          </div>
        )}

        {listen.length > 0 && (
          <div className="flex flex-wrap justify-center gap-2">
            {listen.map((l) => (
              <a key={l.label} href={l.href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-sm hover:border-[#053877]/40">
                <l.icon className="h-4 w-4 text-[#053877]" /> {l.label}
              </a>
            ))}
          </div>
        )}

        {canInvite ? (
          inviting ? (
            <div className="flex flex-col gap-2 rounded-xl border border-border bg-muted/30 p-3">
              <Select value={eventId} onValueChange={setEventId}>
                <SelectTrigger data-testid="select-invite-event"><SelectValue placeholder="Which event?" /></SelectTrigger>
                <SelectContent>
                  {upcoming.map((e) => <SelectItem key={e.id} value={String(e.id)}>{e.name}</SelectItem>)}
                </SelectContent>
              </Select>
              <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="A line from you (optional)" rows={3} maxLength={1500} data-testid="input-invite-note" />
              <div className="flex gap-2">
                <Button className="flex-1 gap-1.5 rounded-full" disabled={!eventId || invite.isPending} onClick={() => invite.mutate()} data-testid="button-send-invite">
                  <Send className="h-4 w-4" /> {invite.isPending ? "Sending…" : "Send invitation"}
                </Button>
                <Button variant="outline" className="rounded-full" onClick={() => setInviting(false)}>Cancel</Button>
              </div>
              <p className="text-[11px] text-muted-foreground">They get an email from MilitaryVoices with the event and a link to set up their show for it.</p>
            </div>
          ) : (
            <Button className="w-full gap-1.5 rounded-full" onClick={() => setInviting(true)} data-testid="button-invite">
              <Users className="h-4 w-4" /> Invite to an event
            </Button>
          )
        ) : (
          <p className="text-center text-xs text-muted-foreground">
            Organizing an event? <Link href="/platform" className="font-medium text-[#053877] hover:underline dark:text-[#8ab4f8]">Plan it with us</Link> and invite anyone here.
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
