import { useRef, useState } from "react";
import { Link } from "wouter";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CalendarDays, ListOrdered, PlayCircle, UserRound, LayoutDashboard, ImagePlus, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { PhotoCropDialog } from "@/components/PhotoCropDialog";
import { StudioIcon } from "@/components/GreenRoomButton";
import { formatTimeInZone, formatDateInZone } from "@/lib/schedule";

const HEADLINE_FONT = { fontFamily: "'General Sans', 'Inter', sans-serif" } as const;
const ET = "America/New_York";

export interface CrewInfo {
  isCrew: boolean;
  member: { id: number; name: string; title: string; photoUrl: string; email: string } | null;
  event: { name: string; startAtUtc: string } | null;
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
export function CrewDashboard({ crew, email }: { crew: CrewInfo; email: string }) {
  const [screen, setScreen] = useState<"dashboard" | "about">("dashboard");
  const ev = crew.event;
  const start = ev ? new Date(ev.startAtUtc) : null;
  const now = new Date();
  const daysToGo = start ? Math.max(0, Math.ceil((start.getTime() - now.getTime()) / 86_400_000)) : null;
  const greeting = now.getHours() < 12 ? "Good morning" : now.getHours() < 17 ? "Good afternoon" : "Good evening";
  const first = (crew.member?.name || "").trim().split(/\s+/)[0] || "there";
  const greenRoom = crew.studioId ? `/studio?studioId=${crew.studioId}` : "/studio";
  const callTime = start ? formatTimeInZone(new Date(start.getTime() - 30 * 60000), ET) : null;

  const nav: { key: "dashboard" | "about"; label: string; hint: string; icon: typeof LayoutDashboard }[] = [
    { key: "dashboard", label: "Dashboard", hint: "The day at a glance", icon: LayoutDashboard },
    { key: "about", label: "About you", hint: "Name, role and photo", icon: UserRound },
  ];
  const links: { label: string; hint: string; icon: typeof ListOrdered; href: string; external?: boolean; green?: boolean }[] = [
    { label: "Green room", hint: "Where the crew gathers", icon: ListOrdered, href: greenRoom, external: true, green: true },
    { label: "Full agenda", hint: "Every show, every time", icon: CalendarDays, href: "/agenda" },
    { label: "Watch page", hint: "What the audience sees", icon: PlayCircle, href: "/watch" },
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
                ) : (
                  <Link key={it.label} href={it.href} className={cls} data-testid={`nav-crew-${it.label.toLowerCase().replace(/\s+/g, "-")}`}>{inner}</Link>
                );
              })}
            </div>
          </div>
        </div>
      </nav>

      <div className="min-w-0">
        {screen === "dashboard" ? (
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
                  <p className="mt-1 text-sm text-white/85">
                    <span className="font-semibold text-white">{ev?.name?.trim() || "The Podcast Marathon"}</span>
                    {" · "}
                    {now.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}
                  </p>
                  <p className="mt-1 text-sm text-white/70">{email}</p>
                </div>
              </div>
              <div className="mt-6 flex flex-wrap gap-2">
                <a href={greenRoom} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-full border border-emerald-500 bg-white px-3.5 py-2 text-sm font-medium text-foreground hover:bg-emerald-50" data-testid="door-crew-green-room">
                  <StudioIcon className="h-6 w-6 rounded-md" tone="green" /> Green room
                </a>
                <Link href="/agenda" className="inline-flex items-center gap-2 rounded-full border border-white/25 bg-white/10 px-3.5 py-2 text-sm font-medium text-white hover:bg-white/15">
                  <ListOrdered className="h-4 w-4" /> Full agenda
                </Link>
                <Link href="/watch" className="inline-flex items-center gap-2 rounded-full border border-white/25 bg-white/10 px-3.5 py-2 text-sm font-medium text-white hover:bg-white/15">
                  <PlayCircle className="h-4 w-4" /> Watch page
                </Link>
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
  const fileRef = useRef<HTMLInputElement | null>(null);

  const save = useMutation({
    mutationFn: async () => (await apiRequest("PUT", "/api/host/crew", { name: name.trim(), title: title.trim() })).json(),
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
    const res = await fetch("/api/host/crew/photo", { method: "POST", body: fd, credentials: "include" });
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
      <p className="mt-1 text-sm text-foreground/80">Your name and role, as the crew and the studio see them. Signed in as {email}.</p>
      <div className="mt-6 flex flex-col gap-5 sm:flex-row sm:items-start">
        <div className="flex flex-col items-center gap-2">
          <button type="button" onClick={() => fileRef.current?.click()} className="group relative h-28 w-28 overflow-hidden rounded-full border-2 border-dashed border-border bg-muted hover:border-[#053877]" data-testid="button-crew-photo">
            {crew.member?.photoUrl ? <img src={crew.member.photoUrl} alt="" className="h-full w-full object-cover" /> : <ImagePlus className="mx-auto h-6 w-6 text-muted-foreground" />}
            <span className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition-opacity group-hover:opacity-100"><ImagePlus className="h-5 w-5 text-white" /></span>
          </button>
          <span className="text-xs text-foreground/70">{crew.member?.photoUrl ? "Change photo" : "Add a photo"}</span>
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) { const r = new FileReader(); r.onload = () => setCropSrc(String(r.result)); r.readAsDataURL(f); } e.target.value = ""; }} />
        </div>
        <form className="flex flex-1 flex-col gap-3" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
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
