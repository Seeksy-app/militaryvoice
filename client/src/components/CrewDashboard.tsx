import { useMemo, useRef, useState } from "react";
import { Link } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { PublicSignup } from "@shared/schema";
import { slotStart, slotEnd } from "@/lib/schedule";
import { CalendarDays, ListOrdered, PlayCircle, UserRound, LayoutDashboard, ImagePlus, Check, Mic2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { PhotoCropDialog } from "@/components/PhotoCropDialog";
import { StudioIcon } from "@/components/GreenRoomButton";
import { CohostDashboard, type CohostInfo } from "@/components/CohostDashboard";
import { formatTimeInZone, formatDateInZone } from "@/lib/schedule";

const HEADLINE_FONT = { fontFamily: "'General Sans', 'Inter', sans-serif" } as const;
const ET = "America/New_York";

export interface CrewInfo {
  isCrew: boolean;
  member: { id: number; name: string; title: string; photoUrl: string; email: string } | null;
  event: { id: number; name: string; startAtUtc: string; slotMinutes: number; durationHours: number; slug: string } | null;
  /** Every event they are crew on; more than one means they choose. */
  events: { id: number; name: string; startAtUtc: string }[];
  studioId: number | null;
}

/**
 * The dashboard for someone on the crew rather than the lineup.
 *
 * A producer has no show, no slot and nothing to promote, so the podcaster's
 * dashboard asked them for a podcast name they did not have and stopped
 * there. Theirs is three things: who they are, the day itself, and the door
 * to the green room. Everything else on the podcaster side is a show's
 * business and stays out of the way.
 */
export function CrewDashboard({ crew, email, onPickEvent, cohost }: { crew: CrewInfo; email: string; onPickEvent: (id: number) => void; cohost?: CohostInfo }) {
  const [screen, setScreen] = useState<"dashboard" | "about" | "cohost">("dashboard");
  const cohostHours = cohost?.isCohost ? (cohost.hours?.length ?? 0) + ((cohost.shared?.length ?? 0) > 0 ? 1 : 0) : 0;
  const ev = crew.event;
  const start = ev ? new Date(ev.startAtUtc) : null;
  const now = new Date();
  const daysToGo = start ? Math.max(0, Math.ceil((start.getTime() - now.getTime()) / 86_400_000)) : null;
  const greeting = now.getHours() < 12 ? "Good morning" : now.getHours() < 17 ? "Good afternoon" : "Good evening";
  const first = (crew.member?.name || "").trim().split(/\s+/)[0] || "there";
  const greenRoom = crew.studioId ? `/studio?studioId=${crew.studioId}` : "/studio";
  const callTime = start ? formatTimeInZone(new Date(start.getTime() - 30 * 60000), ET) : null;

  const nav: { key: "dashboard" | "about" | "cohost"; label: string; hint: string; icon: typeof LayoutDashboard }[] = [
    { key: "dashboard", label: "Dashboard", hint: "The day at a glance", icon: LayoutDashboard },
    ...(cohostHours > 0 ? [{ key: "cohost" as const, label: "Co-host dashboard", hint: `Your ${cohostHours} ${cohostHours === 1 ? "hour" : "hours"} at the desk`, icon: Mic2 }] : []),
    { key: "about", label: "About you", hint: "Name, role and photo", icon: UserRound },
  ];
  const links: { label: string; hint: string; icon: typeof ListOrdered; href: string; external?: boolean; green?: boolean }[] = [
    { label: "Green room", hint: "Where the crew gathers", icon: ListOrdered, href: greenRoom, external: true, green: true },
    { label: "Full agenda", hint: "Every show, every time", icon: CalendarDays, href: "#crew-agenda" },
    { label: "Watch page", hint: "What the audience sees", icon: PlayCircle, href: "/watch", external: true },
  ];

  return (
    <div className="lg:grid lg:grid-cols-[232px_minmax(0,1fr)] lg:gap-8" data-testid="crew-dashboard">
      <nav className="sticky top-6 hidden self-start lg:block lg:min-h-[calc(100vh-10rem)]" aria-label="Crew sections">
        <div className="flex min-h-[calc(100vh-10rem)] flex-col gap-5 rounded-2xl border border-border bg-card p-3 shadow-sm">
          <div>
            <p className="mb-1.5 px-3 text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">You</p>
            <div className="flex flex-col gap-0.5">
              {nav.map((it) => {
                const Icon = it.icon;
                const active = screen === it.key;
                return (
                  <button key={it.key} type="button" onClick={() => setScreen(it.key)} className={`flex items-center gap-2.5 rounded-xl px-3 py-2 text-left transition-colors ${active ? "bg-[#053877] text-white shadow-sm" : "text-foreground hover:bg-[#053877]/[0.06]"}`} data-testid={`nav-crew-${it.key}`}>
                    <Icon className={`h-4 w-4 shrink-0 ${active ? "text-white" : "text-[#053877]"}`} />
                    <span className="min-w-0 flex-1">
                      <span className="block text-[15px] font-semibold tracking-[-0.01em]">{it.label}</span>
                      <span className={`block text-xs ${active ? "text-white/80" : "text-foreground/80"}`}>{it.hint}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
          <div>
            <p className="mb-1.5 px-3 text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">The day</p>
            <div className="flex flex-col gap-0.5">
              {links.map((it) => {
                const Icon = it.icon;
                const inner = (
                  <>
                    {it.green ? <StudioIcon className="h-6 w-6 rounded-md" tone="green" /> : <Icon className="h-4 w-4 shrink-0 text-[#053877]" />}
                    <span className="min-w-0 flex-1">
                      <span className="block text-[15px] font-semibold tracking-[-0.01em]">{it.label}</span>
                      <span className="block text-xs text-foreground/80">{it.hint}</span>
                    </span>
                  </>
                );
                const cls = "flex items-center gap-2.5 rounded-xl px-3 py-2 text-left text-foreground transition-colors hover:bg-[#053877]/[0.06]";
                return it.external ? (
                  <a key={it.label} href={it.href} target="_blank" rel="noreferrer" className={cls} data-testid={`nav-crew-${it.label.toLowerCase().replace(/\s+/g, "-")}`}>{inner}</a>
                ) : it.href.startsWith("#") ? (
                  <button key={it.label} type="button" onClick={() => { setScreen("dashboard"); requestAnimationFrame(() => document.getElementById(it.href.slice(1))?.scrollIntoView({ behavior: "smooth", block: "start" })); }} className={cls} data-testid={`nav-crew-${it.label.toLowerCase().replace(/\s+/g, "-")}`}>{inner}</button>
                ) : (
                  <Link key={it.label} href={it.href} className={cls} data-testid={`nav-crew-${it.label.toLowerCase().replace(/\s+/g, "-")}`}>{inner}</Link>
                );
              })}
            </div>
          </div>
        </div>
      </nav>

      <div className="min-w-0">
        {screen === "cohost" && cohost?.isCohost ? (
          <CohostDashboard info={cohost} onBack={() => setScreen("dashboard")} />
        ) : screen === "dashboard" ? (
          <>
            <section className="relative overflow-hidden rounded-2xl bg-[#04102b] p-6 text-white sm:p-8" data-testid="crew-command-center">
              <div className="flex items-start gap-5">
                {crew.member?.photoUrl ? (
                  <img src={crew.member.photoUrl} alt="" className="h-20 w-20 shrink-0 rounded-full object-cover ring-4 ring-[#F0A71F]/40 sm:h-24 sm:w-24" />
                ) : (
                  <span className="flex h-20 w-20 shrink-0 items-center justify-center rounded-full bg-white/10 text-2xl font-bold sm:h-24 sm:w-24">{first.slice(0, 1).toUpperCase()}</span>
                )}
                <div className="min-w-0">
                  <p className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.18em] text-[#F0A71F]">
                    <span className="h-1.5 w-1.5 rounded-full bg-[#F0A71F]" /> Crew · {crew.member?.title || "Crew"}
                  </p>
                  <h2 className="mt-1 text-3xl font-bold tracking-tight sm:text-4xl" style={HEADLINE_FONT}>{greeting}, {first} 👋</h2>
                  <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-white/85">
                    {crew.events.length > 1 ? (
                      <select
                        value={ev?.id ?? ""}
                        onChange={(e) => onPickEvent(Number(e.target.value))}
                        className="rounded-md border border-white/25 bg-white/10 px-2 py-1 text-sm font-semibold text-white"
                        data-testid="select-crew-event"
                      >
                        {crew.events.map((e) => <option key={e.id} value={e.id} className="text-foreground">{e.name.trim()}</option>)}
                      </select>
                    ) : (
                      <span className="font-semibold text-white">{ev?.name?.trim() || "The Podcast Marathon"}</span>
                    )}
                    <span>· {now.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}</span>
                  </p>
                  <p className="mt-1 text-sm text-white/70">{crew.member?.email || email}</p>
                </div>
              </div>
              <div className="mt-6 flex flex-wrap gap-2">
                <a href={greenRoom} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-full border border-emerald-500 bg-white px-3.5 py-2 text-sm font-medium text-foreground hover:bg-emerald-50" data-testid="door-crew-green-room">
                  <StudioIcon className="h-6 w-6 rounded-md" tone="green" /> Green room
                </a>
                <button type="button" onClick={() => document.getElementById("crew-agenda")?.scrollIntoView({ behavior: "smooth", block: "start" })} className="inline-flex items-center gap-2 rounded-full border border-white/25 bg-white/10 px-3.5 py-2 text-sm font-medium text-white hover:bg-white/15">
                  <ListOrdered className="h-4 w-4" /> Full agenda
                </button>
                <a href="/watch" target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-full border border-white/25 bg-white/10 px-3.5 py-2 text-sm font-medium text-white hover:bg-white/15">
                  <PlayCircle className="h-4 w-4" /> Watch page
                </a>
              </div>
            </section>

            <div className="mt-6 grid gap-4 lg:grid-cols-3">
              <div className="rounded-2xl border border-border bg-card p-5">
                <p className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-foreground">The day</p>
                {daysToGo != null && (
                  <p className="text-2xl font-bold tabular-nums tracking-tight text-[#053877]" data-testid="text-crew-days">{daysToGo === 0 ? "Today" : `${daysToGo} day${daysToGo === 1 ? "" : "s"} to go`}</p>
                )}
                {start && (
                  <p className="mt-1 text-sm text-foreground/85">
                    {formatDateInZone(start, ET)} · first show <span className="font-semibold text-foreground">{formatTimeInZone(start, ET)} Eastern</span>
                  </p>
                )}
              </div>
              <div className="rounded-2xl border border-border bg-card p-5">
                <p className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-foreground">Call time</p>
                <p className="text-sm text-foreground/85">
                  {callTime ? <>Be in the green room by <span className="font-semibold text-foreground tabular-nums">{callTime} Eastern</span>, half an hour before the first show. Alex, the AI producer, runs the rail; you can take scenes from the green room too.</> : "Your call time appears here once the day is set."}
                </p>
              </div>
              <div className="rounded-2xl border border-border bg-card p-5">
                <p className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-foreground">Before the day</p>
                <ul className="space-y-1.5 text-sm text-foreground/85">
                  <li className="flex items-start gap-2"><Check className={`mt-0.5 h-4 w-4 shrink-0 ${crew.member?.photoUrl ? "text-emerald-600" : "text-muted-foreground/40"}`} /> Add your photo <button type="button" onClick={() => setScreen("about")} className="ml-1 text-[#053877] underline underline-offset-2">About you</button></li>
                  <li className="flex items-start gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground/40" /> Open the green room once and turn your camera on, so the first time isn't show day</li>
                  <li className="flex items-start gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground/40" /> Read the agenda: who's live, who's pre-recorded</li>
                </ul>
              </div>
            </div>
            {ev && <CrewAgenda event={ev} />}
          </>
        ) : (
          <AboutYou crew={crew} email={email} />
        )}
      </div>
    </div>
  );
}

function AboutYou({ crew, email }: { crew: CrewInfo; email: string }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [name, setName] = useState(crew.member?.name ?? "");
  const [title, setTitle] = useState(crew.member?.title ?? "Producer");
  const [cropSrc, setCropSrc] = useState<string | null>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const [photoLink, setPhotoLink] = useState("");
  const fileRef = useRef<HTMLInputElement | null>(null);

  // A Google profile picture is a link, not a file on disk. Saved as the
  // card's photo as given; Google's image URLs are public and stable.
  const saveLink = useMutation({
    mutationFn: async () => (await apiRequest("PUT", "/api/host/crew", { photoUrl: photoLink.trim(), eventId: crew.event?.id })).json(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/host/crew"] });
      setLinkOpen(false);
      setPhotoLink("");
      toast({ title: "Photo saved" });
    },
    onError: (err: Error) => toast({ title: "Couldn't use that link", description: err.message, variant: "destructive" }),
  });

  const save = useMutation({
    mutationFn: async () => (await apiRequest("PUT", "/api/host/crew", { name: name.trim(), title: title.trim(), eventId: crew.event?.id })).json(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/host/crew"] });
      toast({ title: "Saved" });
    },
    onError: (err: Error) => toast({ title: "Couldn't save", description: err.message, variant: "destructive" }),
  });

  async function uploadPhoto(blob: Blob) {
    setCropSrc(null);
    const fd = new FormData();
    fd.append("photo", blob, "photo.jpg");
    const res = await fetch(`/api/host/crew/photo${crew.event ? `?eventId=${crew.event.id}` : ""}`, { method: "POST", body: fd, credentials: "include" });
    if (!res.ok) {
      toast({ title: "Couldn't save that photo", description: (await res.json().catch(() => ({ message: res.statusText }))).message, variant: "destructive" });
      return;
    }
    queryClient.invalidateQueries({ queryKey: ["/api/host/crew"] });
    toast({ title: "Photo saved" });
  }

  return (
    <section className="rounded-2xl border border-border bg-card p-6" data-testid="crew-about">
      <h2 className="text-xl font-bold tracking-tight" style={HEADLINE_FONT}>About you</h2>
      <p className="mt-1 text-sm text-foreground/80">Your name and role, as the crew and the studio see them.</p>
      {crew.member?.email && (
        <p className="mt-2 text-sm" data-testid="text-crew-email">
          <span className="font-semibold">Email:</span> {crew.member.email}
          {crew.member.email.toLowerCase() !== email.toLowerCase() && <span className="text-foreground/60"> · signed in as {email}</span>}
        </p>
      )}
      <div className="mt-6 flex flex-col gap-5 sm:flex-row sm:items-start">
        <div className="flex flex-col items-center gap-2">
          <button type="button" onClick={() => fileRef.current?.click()} className="group relative h-28 w-28 overflow-hidden rounded-full border-2 border-dashed border-border bg-muted hover:border-[#053877]" data-testid="button-crew-photo">
            {crew.member?.photoUrl ? <img src={crew.member.photoUrl} alt="" className="h-full w-full object-cover" /> : <ImagePlus className="mx-auto h-6 w-6 text-muted-foreground" />}
            <span className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition-opacity group-hover:opacity-100"><ImagePlus className="h-5 w-5 text-white" /></span>
          </button>
          <span className="text-xs text-foreground/70">{crew.member?.photoUrl ? "Change photo" : "Add a photo"}</span>
          <button type="button" onClick={() => setLinkOpen((v) => !v)} className="text-xs text-[#053877] underline underline-offset-2" data-testid="button-crew-photo-link">or paste an image link</button>
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) { const r = new FileReader(); r.onload = () => setCropSrc(String(r.result)); r.readAsDataURL(f); } e.target.value = ""; }} />
        </div>
        <form className="flex flex-1 flex-col gap-3" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
          {linkOpen && (
            <div className="rounded-xl border border-dashed border-border bg-muted/30 p-3">
              <Label htmlFor="crew-photo-link">Image link</Label>
              <p className="mb-2 text-xs text-foreground/70">On your Google account page, right-click your picture and copy the image address, then paste it here.</p>
              <div className="flex gap-2">
                <Input id="crew-photo-link" value={photoLink} onChange={(e) => setPhotoLink(e.target.value)} placeholder="https://…" data-testid="input-crew-photo-link" />
                <Button type="button" size="sm" className="rounded-full bg-[#053877] text-white hover:bg-[#0a4a99]" disabled={saveLink.isPending || !/^https?:\/\//.test(photoLink.trim())} onClick={() => saveLink.mutate()} data-testid="button-crew-photo-link-save">
                  {saveLink.isPending ? "Saving…" : "Use it"}
                </Button>
              </div>
            </div>
          )}
          <div>
            <Label htmlFor="crew-name">Name</Label>
            <Input id="crew-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" data-testid="input-crew-name" />
          </div>
          <div>
            <Label htmlFor="crew-title">Role</Label>
            <Input id="crew-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Producer" data-testid="input-crew-title" />
          </div>
          <div>
            <Button type="submit" className="rounded-full bg-[#053877] text-white hover:bg-[#0a4a99]" disabled={save.isPending || !name.trim()} data-testid="button-crew-save">
              {save.isPending ? "Saving…" : "Save"}
            </Button>
          </div>
        </form>
      </div>
      <PhotoCropDialog open={!!cropSrc} imageSrc={cropSrc} onCancel={() => setCropSrc(null)} onConfirm={uploadPhoto} />
    </section>
  );
}

/**
 * The day, in order, on the crew's own page. The public agenda, compact:
 * every slot with its time, the show and who is on, so a producer reads
 * the day here rather than in another tab.
 */
function CrewAgenda({ event }: { event: NonNullable<CrewInfo["event"]> }) {
  const { data: signups = [] } = useQuery<PublicSignup[]>({
    queryKey: ["/api/signups", event.id],
    queryFn: async () => (await apiRequest("GET", `/api/signups?eventId=${event.id}`)).json(),
    staleTime: 60_000,
  });
  const rows = useMemo(() => {
    const n = Math.floor((event.durationHours * 60) / event.slotMinutes);
    return Array.from({ length: n }, (_, i) => ({
      i,
      start: slotStart(event.startAtUtc, event.slotMinutes, i),
      end: slotEnd(event.startAtUtc, event.slotMinutes, i),
      signup: signups.find((s) => s.slotIndex === i) ?? null,
    }));
  }, [event, signups]);
  const nowMs = Date.now();
  return (
    <section id="crew-agenda" className="mt-6 scroll-mt-6 rounded-2xl border border-border bg-card" data-testid="crew-agenda">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-5 py-3">
        <p className="text-xs font-semibold uppercase tracking-[0.08em] text-foreground">Full agenda · {event.name.trim()}</p>
        <a href={`/agenda`} target="_blank" rel="noreferrer" className="text-xs font-medium text-[#053877] underline underline-offset-2">Open the public agenda</a>
      </div>
      <div className="divide-y divide-border">
        {rows.map((r) => {
          const live = nowMs >= r.start.getTime() && nowMs < r.end.getTime();
          const past = nowMs >= r.end.getTime();
          return (
            <div key={r.i} className={`flex items-center gap-3 px-5 py-2.5 ${past ? "opacity-50" : ""} ${live ? "bg-[#053877]/[0.05]" : ""}`} data-testid={`crew-agenda-${r.i}`}>
              <div className="w-24 shrink-0 text-sm font-semibold tabular-nums text-foreground">{formatTimeInZone(r.start, ET)}</div>
              {r.signup ? (
                <>
                  {r.signup.photoUrl ? (
                    <img src={r.signup.photoUrl} alt="" className="h-8 w-8 shrink-0 rounded-full object-cover object-[50%_28%]" />
                  ) : (
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-bold">{r.signup.hostName.slice(0, 1)}</span>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{r.signup.podcastName.trim()}</p>
                    <p className="truncate text-xs text-foreground/70">{r.signup.hostName}{r.signup.coHost ? ` · with ${r.signup.coHost.hostName}` : ""}</p>
                  </div>
                </>
              ) : (
                <p className="text-sm text-foreground/60">Open</p>
              )}
              {live && <span className="rounded-full bg-[#ED1C24] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">Live</span>}
            </div>
          );
        })}
      </div>
    </section>
  );
}
