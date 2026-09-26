import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EventShowForm, type EventShow } from "@/components/EventShowForm";
import { EventSlotPicker } from "@/components/EventSlotPicker";
import { useToast } from "@/hooks/use-toast";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { apiRequest } from "@/lib/queryClient";
import { formatDateInZone, formatTimeInZone, zoneLabel, detectLocalTimeZone, slotStart, slotEnd, onAirWindow, totalSlots } from "@/lib/schedule";
import { isLiveOnlyBlock } from "@shared/slots";
import type { PublicEvent } from "@shared/schema";
import { CalendarDays, ChevronRight, ArrowLeft, ArrowRight, Check, Clock, Trash2, Megaphone, Rocket, Mic2, Users } from "lucide-react";
import { GreenRoomButton } from "@/components/GreenRoomButton";
import { CohostSlots } from "@/components/CohostSlots";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { StudioIcon } from "@/components/GreenRoomButton";

// Choose an event, then set up the show you're bringing to it. Everything
// about one event lives behind its own card, so a podcaster in two events
// never has to wonder which one they're editing.

interface EventEntry {
  event: PublicEvent;
  show: EventShow | null;
  slotIndex: number | null;
  signupId: number | null;
}

export function EventSettings({
  profilePhotoUrl,
  onPickSlot,
  onOpenPromotion,
  onOpenGreenRoom,
  children,
}: {
  /** The green room screen: what to check, and the way in. */
  onOpenGreenRoom?: () => void;
  profilePhotoUrl?: string;
  /** Send them to the slot picker for this event. */
  onPickSlot: (eventId: number) => void;
  /** Promotion lives in its own tab; this is the way there. */
  onOpenPromotion: () => void;
  /** Show materials / Stream / Recordings, rendered once an event is chosen. */
  children?: (entry: EventEntry) => React.ReactNode;
}) {
  // Remembered while they step into Promotion or the green room and back.
  const [openId, setOpenIdState] = useState<number | null>(() => {
    try { const v = sessionStorage.getItem("mv_open_event"); return v ? Number(v) : null; } catch { return null; }
  });
  const setOpenId = (id: number | null) => {
    setOpenIdState(id);
    try { if (id == null) sessionStorage.setItem("mv_open_event", "list"); else sessionStorage.setItem("mv_open_event", String(id)); } catch { /* private window */ }
  };
  const zone = detectLocalTimeZone();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: entries, isLoading } = useQuery<EventEntry[]>({
    queryKey: ["/api/host/events"],
    queryFn: async () => (await apiRequest("GET", "/api/host/events")).json(),
  });

  const { data: openShow } = useQuery<EventShow>({
    queryKey: ["/api/host/shows", openId],
    queryFn: async () => (await apiRequest("GET", `/api/host/shows/${openId}`)).json(),
    enabled: openId != null,
  });

  const removeSlot = useMutation({
    mutationFn: async (signupId: number) => apiRequest("DELETE", `/api/host/signups/${signupId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/host/events"] });
      queryClient.invalidateQueries({ queryKey: ["/api/host/dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["/api/signups"] });
      toast({ title: "Time released", description: "That slot is back on the open schedule." });
    },
    onError: (err: Error) =>
      toast({ title: "Couldn't release that time", description: err.message, variant: "destructive" }),
  });

  // Is the open event full? Needed before the early return, so it keys on the
  // id rather than the resolved entry.
  const { data: openSignups } = useQuery<{ slotIndex: number; status: string }[]>({
    queryKey: ["/api/signups", openId],
    queryFn: async () => (await apiRequest("GET", `/api/signups?eventId=${openId}`)).json(),
    enabled: openId != null,
  });



  // One event of their own: open it. The list is for choosing, and with one there's nothing to choose.
  useEffect(() => {
    if (openId != null || !entries) return;
    let chose = false;
    try { chose = sessionStorage.getItem("mv_open_event") === "list"; } catch { /* private window */ }
    const mineOnly = entries.filter((e) => !!e.show?.showName);
    if (!chose && mineOnly.length === 1) setOpenIdState(mineOnly[0].event.id);
  }, [entries, openId]);

  const open = entries?.find((e) => e.event.id === openId) ?? null;
  const eventFull =
    !!open &&
    (openSignups ?? []).filter((x) => x.status !== "cancelled").length >=
      totalSlots(open.event.durationHours, open.event.slotMinutes);

  const onAirLabel =
    open?.slotIndex != null
      ? (() => {
          const air = onAirWindow(slotStart(open.event.startAtUtc, open.event.slotMinutes, open.slotIndex), {
            onAirMinutes: open.event.onAirMinutes,
            bufferMinutes: open.event.bufferMinutes,
            bufferPosition: open.event.bufferPosition,
          });
          return `${formatDateInZone(air.start, zone)} · ${formatTimeInZone(air.start, zone)}–${formatTimeInZone(air.end, zone)}`;
        })()
      : "";

  // The event's own studio is at /studio; anything that isn't the site's
  // featured event is reached through its slug.
  const greenRoomHref =
    open?.event.isFeatured === false && open.event.slug ? `/event/${open.event.slug}/studio` : "/studio";

  // Daytime slots have to be broadcast live, so the show form hides the
  // recorded-episode option for anyone holding one.
  const heldSlotIsLiveOnly =
    open?.slotIndex != null &&
    isLiveOnlyBlock(
      slotStart(open.event.startAtUtc, open.event.slotMinutes, open.slotIndex),
      slotEnd(open.event.startAtUtc, open.event.slotMinutes, open.slotIndex),
    );

  // The show is the thing to do on this page. The green room and co-hosting
  // come once it exists: before that they were the first two things anybody
  // saw, asking them to test a camera and take an extra hour for a show they
  // hadn't set up yet.
  const showReady = !!open?.show?.showName;
  const [cohostOpen, setCohostOpen] = useState(false);
  const { data: cohostBoard } = useQuery<{ blocks: { mine: boolean; takenBy: unknown; yourShow: boolean }[] }>({
    queryKey: ["/api/host/cohost-slots", open?.event.id],
    queryFn: async () => (await apiRequest("GET", `/api/host/cohost-slots/${open!.event.id}`)).json(),
    enabled: !!open && open.slotIndex != null && showReady,
  });
  const { data: plan } = useQuery<{ posts: { selected: boolean; status: string | null; postedAt: string | null }[] }>({
    queryKey: ["/api/host/campaign", open?.signupId],
    queryFn: async () => (await apiRequest("GET", `/api/host/campaign?signupId=${open!.signupId}`)).json(),
    enabled: open?.signupId != null,
    retry: false,
  });
  const planned = (plan?.posts ?? []).filter((p) => p.selected);
  const postedCount = planned.filter((p) => p.postedAt || p.status === "posted").length;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  const cohostOpenCount = (cohostBoard?.blocks ?? []).filter((b) => !b.takenBy && !b.mine && !b.yourShow).length;
  const cohostMine = (cohostBoard?.blocks ?? []).filter((b) => b.mine).length;
  // Once, the moment the show is first saved: offer the desk as a pop-up
  // rather than a section, because it is an extra and not the job.
  const hadShow = useRef<boolean | null>(null);
  useEffect(() => {
    if (!open) return;
    if (hadShow.current === null) { hadShow.current = showReady; return; }
    if (!hadShow.current && showReady && open.slotIndex != null) {
      const key = `mv_cohost_offer_${open.event.id}`;
      try {
        if (!localStorage.getItem(key)) { localStorage.setItem(key, "1"); setCohostOpen(true); }
      } catch { /* private window */ }
    }
    hadShow.current = showReady;
  }, [showReady, open]);

  if (isLoading) {
    return (
      <div className="mt-6 space-y-3">
        <Skeleton className="h-24 w-full rounded-2xl" />
        <Skeleton className="h-24 w-full rounded-2xl" />
      </div>
    );
  }
  // ------------------------------------------------------------ chooser
  if (!open) {
    const all = entries ?? [];
    // Setting up a show for an event is what joining it means — there is no
    // separate registration to keep in step with anything.
    const mine = all.filter((e) => !!e.show?.showName);
    const joinable = all.filter((e) => !e.show?.showName);

    const card = (entry: EventEntry) => {
      const ready = !!entry.show?.showName;
      const booked = entry.slotIndex != null;
      const timeLabel = booked
        ? formatTimeInZone(
            onAirWindow(slotStart(entry.event.startAtUtc, entry.event.slotMinutes, entry.slotIndex!), {
              onAirMinutes: entry.event.onAirMinutes,
              bufferMinutes: entry.event.bufferMinutes,
              bufferPosition: entry.event.bufferPosition,
            }).start,
            zone,
          )
        : null;

      return (
        <button
          key={entry.event.id}
          type="button"
          onClick={() => setOpenId(entry.event.id)}
          // A row, not a poster. One event or six, it reads the same.
          className="group flex w-full items-stretch overflow-hidden rounded-xl border border-border bg-card text-left transition-colors hover:border-primary/50 hover:bg-[#053877]/[0.02]"
          data-testid={`button-choose-event-${entry.event.id}`}
        >
          {entry.event.imageUrl && (
            <img
              src={entry.event.imageUrl}
              alt=""
              // Fixed 4:3 so the mark is never sliced by an odd container height.
              className="hidden aspect-[4/3] w-[132px] shrink-0 object-cover sm:block"
              loading="lazy"
            />
          )}

          <div className="flex min-w-0 flex-1 items-center gap-4 px-4 py-3.5">
            <div className="min-w-0 flex-1">
              <div className="truncate text-[15px] font-bold leading-tight text-foreground group-hover:text-primary">
                {entry.event.name}
              </div>
              <div className="mt-0.5 text-[15px] text-muted-foreground">
                {formatDateInZone(new Date(entry.event.startAtUtc), zone)} · {entry.event.durationHours} hours
              </div>

              <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[12px]">
                <span
                  className={`inline-flex max-w-full items-center gap-1 truncate rounded-full px-2 py-0.5 font-semibold ${
                    ready ? "bg-primary/10 text-primary" : "border border-dashed border-border text-muted-foreground"
                  }`}
                >
                  {ready && <Check className="h-3 w-3 shrink-0" />}
                  <span className="truncate">{ready ? entry.show!.showName : "Show not set up"}</span>
                </span>
                <span
                  className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 font-semibold ${
                    booked ? "bg-[#F0A71F]/25 text-[#7a5200]" : "border border-dashed border-border text-muted-foreground"
                  }`}
                >
                  <Clock className="h-3 w-3" />
                  {timeLabel ?? "No time yet"}
                </span>
              </div>
            </div>

            <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
          </div>
        </button>
      );
    };

    return (
      <section className="mt-6 flex flex-col gap-8">
        <div>
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.08em] text-foreground">
            <CalendarDays className="h-4 w-4" /> Your events
          </h2>
          {mine.length === 0 ? (
            <p className="rounded-2xl border border-border bg-card p-5 text-sm text-muted-foreground">
              You haven't joined an event yet. Pick one below and set your show up for it.
            </p>
          ) : (
            <div className="flex flex-col gap-3">
              {mine.map(card)}
              {/* The lineup is closed, so for most people this list is now one
                  card and nothing to do. The next thing they might want is
                  their own event, and this is the only place they are already
                  looking. */}
              <a
                href="/platform"
                className="group flex items-center gap-4 rounded-2xl border-2 border-dashed border-border bg-muted/20 p-5 text-left transition-colors hover:border-primary/40 hover:bg-muted/40"
                data-testid="link-host-your-own"
              >
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border-2 border-dashed border-border text-muted-foreground transition-colors group-hover:border-primary/40 group-hover:text-primary">
                  <Rocket className="h-5 w-5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-foreground">
                    Learn how to host your own event
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    The scheduling, the studio and the green room, run under your own name.
                  </span>
                </span>
                <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
              </a>
            </div>
          )}
        </div>

        {joinable.length > 0 && (
          <div>
            <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.08em] text-foreground">
              <CalendarDays className="h-4 w-4" /> Events you can join
            </h2>
            <div className="flex flex-col gap-3">{joinable.map(card)}</div>
          </div>
        )}
      </section>
    );
  }

  // ------------------------------------------------------- one event
  return (
    <section className="mt-6">
      <button
        type="button"
        onClick={() => setOpenId(null)}
        className="mb-1.5 inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
        data-testid="button-back-to-events"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> All events
      </button>

      {(() => {
        const air = open.slotIndex != null
          ? onAirWindow(slotStart(open.event.startAtUtc, open.event.slotMinutes, open.slotIndex), {
              onAirMinutes: open.event.onAirMinutes,
              bufferMinutes: open.event.bufferMinutes,
              bufferPosition: open.event.bufferPosition,
            })
          : null;
        const target = air ? air.start.getTime() : new Date(open.event.startAtUtc).getTime();
        const eventEnd = new Date(open.event.startAtUtc).getTime() + open.event.durationHours * 3600_000;
        const live = air ? now >= air.start.getTime() && now < air.end.getTime() : now >= target && now < eventEnd;
        const over = air ? now >= air.end.getTime() : now >= eventEnd;
        const left = Math.max(0, target - now);
        const d = Math.floor(left / 86_400_000), h = Math.floor((left % 86_400_000) / 3_600_000), m = Math.floor((left % 3_600_000) / 60_000);
        const countdown: [string, string][] = d > 0 ? [[String(d), d === 1 ? "day" : "days"], [String(h), h === 1 ? "hr" : "hrs"], [String(m).padStart(2, "0"), "min"]] : [[String(h), h === 1 ? "hr" : "hrs"], [String(m).padStart(2, "0"), "min"]];
        return (
          /* The event's own dashboard: a dark card like the home page's —
             what it is, when you're on, how long until — with the things to
             do as doors under it, not three tabs to guess between. */
          <div data-testid="event-dashboard">
            <div className="relative overflow-hidden rounded-2xl bg-[#04102b] px-5 pb-16 pt-5 text-white sm:px-7 sm:pt-6">
              <div className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full border border-white/[0.07]" aria-hidden="true" />
              <div className="pointer-events-none absolute -right-8 -top-8 h-72 w-72 rounded-full border border-white/[0.07]" aria-hidden="true" />
              <div className="relative flex flex-wrap items-center justify-between gap-6">
                <div className="flex min-w-0 items-center gap-4">
                  {open.event.imageUrl ? (
                    <img src={open.event.imageUrl} alt="" className="h-20 w-20 shrink-0 rounded-2xl object-cover ring-4 ring-white/10 sm:h-24 sm:w-24" />
                  ) : (
                    <span className="flex h-20 w-20 shrink-0 items-center justify-center rounded-2xl bg-white/10 sm:h-24 sm:w-24"><CalendarDays className="h-8 w-8 text-[#F0A71F]" /></span>
                  )}
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.18em] text-[#F0A71F]">
                      <span className={`h-1.5 w-1.5 rounded-full ${live ? "animate-pulse bg-red-500" : "bg-[#F0A71F]"}`} /> {live ? "Live now" : over ? "Event over" : "Your event"}
                    </p>
                    <h2 className="mt-1 text-2xl font-bold tracking-tight text-white [text-wrap:balance] sm:text-3xl">{open.event.name}</h2>
                    <p className="mt-1 text-sm text-white/75">
                      {formatDateInZone(new Date(open.event.startAtUtc), zone)} · {open.event.durationHours} hours
                    </p>
                    <div className="mt-2.5 flex flex-wrap items-center gap-1.5 text-xs">
                      <span className={`inline-flex max-w-full items-center gap-1 truncate rounded-full px-2.5 py-1 font-semibold ${showReady ? "bg-white/10 text-white" : "border border-dashed border-white/30 text-white/70"}`}>
                        {showReady && <Check className="h-3 w-3 shrink-0 text-emerald-400" />}
                        <span className="truncate">{showReady ? open.show!.showName : "Show not set up"}</span>
                      </span>
                      <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 font-semibold ${air ? "bg-[#F0A71F] text-[#1a1200]" : "border border-dashed border-white/30 text-white/70"}`}>
                        <Clock className="h-3 w-3" /> {air ? `${onAirLabel} · ${zoneLabel(zone)}` : "No time yet"}
                      </span>
                    </div>
                  </div>
                </div>
                {/* How long until: the number that matters on this page. */}
                {!over && (
                  <div className="shrink-0 text-right" data-testid="event-countdown">
                    <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-white/60">{live ? (air ? "You're on air" : "It's on") : air ? "You're on in" : "Starts in"}</p>
                    {live ? (
                      <p className="mt-1 text-3xl font-bold text-[#F0A71F]">Now</p>
                    ) : (
                      <p className="mt-1 flex items-baseline justify-end gap-3">
                        {countdown.map(([n, u]) => (
                          <span key={u} className="flex items-baseline gap-1">
                            <span className="text-4xl font-bold tabular-nums text-white sm:text-5xl">{n}</span>
                            <span className="text-xs font-semibold uppercase text-white/60">{u}</span>
                          </span>
                        ))}
                      </p>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* The doors, over the foot of the dark card. */}
            <div className="relative -mt-10 grid gap-3 px-3 sm:grid-cols-2 sm:px-5 xl:grid-cols-4" id="your-time-slot">
              <Door
                onClick={() => document.getElementById("event-show-form")?.scrollIntoView({ behavior: "smooth", block: "start" })}
                icon={<span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#053877]/10 text-[#053877] dark:text-[#8ab4f8]"><Mic2 className="h-5 w-5" /></span>}
                title="Your show"
                line={showReady ? "Name, artwork, format and guests" : "Set it up to take a time"}
                stat={showReady ? "Ready" : "To do"}
                good={showReady}
                testId="event-door-show"
              />
              <Door
                onClick={onOpenPromotion}
                icon={<span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#F0A71F]/15 text-[#b77a00]"><Megaphone className="h-5 w-5" /></span>}
                title="Promotion"
                line="Share card, posting plan and clips"
                stat={planned.length ? `${postedCount}/${planned.length} posts out` : air ? "Plan your posts" : "After you take a time"}
                good={planned.length > 0 && postedCount === planned.length}
                testId="event-door-promotion"
              />
              <Door
                onClick={onOpenGreenRoom}
                href={onOpenGreenRoom ? undefined : greenRoomHref}
                icon={<StudioIcon className="h-10 w-10 rounded-xl" tone="green" />}
                title="Green room"
                line="Check your camera and mic, then go live"
                stat={live ? "Go in now" : "Open any time"}
                good={live}
                testId="event-door-greenroom"
              />
              <Door
                onClick={air && showReady ? () => setCohostOpen(true) : undefined}
                icon={<span className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-600/10 text-emerald-700"><Users className="h-5 w-5" /></span>}
                title="Co-host"
                line="Sit in at the desk with Alex or Riccoh"
                stat={cohostMine > 0 ? `${cohostMine} hour${cohostMine === 1 ? "" : "s"} yours` : cohostBoard ? `${cohostOpenCount} open` : air && showReady ? "Take an hour" : "After your show's set"}
                good={cohostMine > 0}
                testId="event-door-cohost"
              />
            </div>
          </div>
        );
      })()}

      {/* Your time: change it or give it up. */}
      {open.slotIndex != null ? (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-border bg-card px-4 py-2.5 text-sm" data-testid="event-strip">
          <span className="flex items-center gap-2 text-muted-foreground">
            <Clock className="h-4 w-4" /> Your time: <span className="font-semibold text-foreground">{onAirLabel}</span> · {zoneLabel(zone)}
          </span>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="ghost" size="sm" className="shrink-0 gap-1.5 text-muted-foreground hover:text-destructive">
                  <Trash2 className="h-3.5 w-3.5" /> Give up this time
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Give up this time?</AlertDialogTitle>
                  <AlertDialogDescription>
                    {onAirLabel} goes back on the open schedule for anyone to claim, and you can pick a different
                    time straight after. Anyone who set a reminder for this slot won't be notified.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Keep it</AlertDialogCancel>
                  <AlertDialogAction
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    onClick={() => open.signupId != null && removeSlot.mutate(open.signupId)}
                    disabled={removeSlot.isPending}
                    data-testid="button-remove-slot"
                  >
                    {removeSlot.isPending ? "Removing…" : "Remove it"}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
        </div>
      ) : (
        <div className="mt-6 rounded-2xl border border-border bg-card p-5">
          <h3 className="text-sm font-semibold uppercase tracking-[0.08em] text-foreground">Choose a time</h3>
          <p className="mb-3 mt-1 text-sm text-muted-foreground">
            {open.show?.showName
              ? "Tap any open time to take it."
              : "Save your show below first — a slot needs a show attached to it."}
          </p>
          <EventSlotPicker
            event={open.event}
            disabled={!open.show?.showName}
            showFormat={openShow?.showFormat ?? open.show?.showFormat}
          />
        </div>
      )}

      {/* The desk, as a pop-up: offered once when the show is first saved,
          and from the co-host card any time after. */}
      <Dialog open={cohostOpen} onOpenChange={setCohostOpen}>
        {/* No auto-focus: the first focusable thing is the info icon, and
            focusing it opened its tooltip over the heading on arrival. */}
        <DialogContent className="max-h-[90vh] max-w-5xl overflow-y-auto" data-testid="dialog-cohost" onOpenAutoFocus={(e) => e.preventDefault()}>
          <DialogHeader>
            <DialogTitle>Your show's set up. Want to co-host an hour too?</DialogTitle>
            <DialogDescription>Optional. Sit in at the desk between shows with Alex or Riccoh — take one hour or several.</DialogDescription>
          </DialogHeader>
          {open.slotIndex != null && <CohostSlots eventId={open.event.id} zone={zone} />}
        </DialogContent>
      </Dialog>

      {/* Nothing to set up for an event you cannot get on to. Leaving the form
          live invites somebody to fill in a show, artwork and a format for a
          day that has no room for them. */}
      {openShow && open.slotIndex == null && eventFull && (
        <p className="mt-6 rounded-2xl border border-border bg-muted/40 p-5 text-sm">
          <span className="font-semibold text-foreground">This event is full.</span>{" "}
          <span className="text-muted-foreground">
            Every time is taken, so there is nothing to set up here yet. If a slot frees up it will
            appear above and this opens again.
          </span>
        </p>
      )}

      {openShow && !(open.slotIndex == null && eventFull) && (
        <div className="mt-6 scroll-mt-6" id="event-show-form">
          <EventShowForm
            eventId={open.event.id}
            eventName={open.event.name}
            show={openShow}
            profilePhotoUrl={profilePhotoUrl}
            liveOnlySlot={heldSlotIsLiveOnly}
            onSaved={() => {}}
          />
        </div>
      )}

      {children?.(open)}

      {/* What to do next, at the point they've finished.
          The page saves as it goes, so there is no Save button to end on and
          nothing telling anyone they're done — people got to the bottom of a
          long form, found no full stop, and left. This is the full stop, and
          it points at the thing that actually decides whether anyone watches. */}
      {open.slotIndex != null && open.signupId != null && (
        <div
          className="mt-8 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-primary/25 bg-primary/5 p-5"
          data-testid="link-to-promotion"
        >
          <div className="flex min-w-0 items-start gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Check className="h-4.5 w-4.5" />
            </span>
            <div className="min-w-0">
              <p className="font-semibold text-foreground">That's your show set up — it saves as you go.</p>
              <p className="mt-0.5 text-sm text-muted-foreground">
                Next: get people watching. Your share card, a posting plan for the days before, and the clips we cut
                afterwards.
              </p>
            </div>
          </div>
          <Button onClick={onOpenPromotion} className="shrink-0 gap-1.5 rounded-full" data-testid="button-next-promotion">
            <Megaphone className="h-4 w-4" /> Go to Promotion <ChevronRight className="h-3.5 w-3.5" />
          </Button>
        </div>
      )}
    </section>
  );
}

/** A door on the event's dashboard: what it is, a line, and where it stands. */
function Door({ onClick, href, icon, title, line, stat, good, testId }: {
  onClick?: () => void;
  href?: string;
  icon: React.ReactNode;
  title: string;
  line: string;
  stat: string;
  good?: boolean;
  testId: string;
}) {
  const inner = (
    <>
      <span className="flex items-start justify-between gap-2">
        {icon}
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${good ? "bg-emerald-600/10 text-emerald-700 dark:text-emerald-400" : "bg-muted text-muted-foreground"}`}>{stat}</span>
      </span>
      <span className="mt-3 flex items-center gap-1.5 text-base font-bold text-foreground">
        {title} {(onClick || href) && <ArrowRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-foreground" />}
      </span>
      <span className="mt-0.5 block text-sm text-muted-foreground">{line}</span>
    </>
  );
  const cls = `group flex flex-col rounded-2xl border border-border bg-card p-4 text-left shadow-sm transition-all ${onClick || href ? "hover:-translate-y-0.5 hover:border-[#053877]/30 hover:shadow-md" : "cursor-default opacity-80"}`;
  if (href) return <a href={href} target="_blank" rel="noreferrer" className={cls} data-testid={testId}>{inner}</a>;
  return <button type="button" onClick={onClick} disabled={!onClick} className={cls} data-testid={testId}>{inner}</button>;
}
