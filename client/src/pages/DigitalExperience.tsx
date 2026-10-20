import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { NavBar } from "@/components/NavBar";
import { SiteFooter } from "@/components/SiteFooter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Turnstile, useTurnstileSiteKey } from "@/components/Turnstile";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, apiUpload } from "@/lib/queryClient";
import { Bot, Check, Clock, Loader2, Share2 } from "lucide-react";
import { BoothButton, CalendarButtons } from "@/components/DxTimes";
import { DxShare } from "@/components/DxShare";

// The MilitaryVoices Digital Experience: a live channel, weekdays 7 am to
// 10 pm Eastern. Pick a time, choose 30 or 60 minutes, book it here (an
// emailed code signs them in, so it lands in their account), then add it to
// their calendar. Server: server/digitalExperience.ts.

type Slot = { index: number; startAtUtc: string; past: boolean; taken: { id: number; show: string; host: string; photo: string; first: boolean; span: number } | null };
type Day = { eventId: number; name: string; startAtUtc: string; slotMinutes: number; onAirMinutes: number; bufferMinutes: number; closed: boolean; slots: Slot[] };
type Cal = { google: string; outlook: string; ics: string };
type Booking = { id: number; eventId: number; day: string; slotIndex: number; span: number; show: string; host: string; photo: string; startAtUtc: string; endAtUtc: string; calendar: Cal };
type Mine = { email: string; profile: { hostName: string; phone: string; photoUrl: string; podcastName: string; link: string } | null; bookings: Booking[] };

const ET = "America/New_York";
const time = (iso: string, tz = ET) => new Date(iso).toLocaleTimeString("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" });
const dayLabel = (iso: string) => new Date(iso).toLocaleDateString("en-US", { timeZone: ET, weekday: "long", month: "short", day: "numeric" });
const shortDay = (iso: string) => new Date(iso).toLocaleDateString("en-US", { timeZone: ET, weekday: "short", month: "short", day: "numeric" });
const plus = (iso: string, min: number) => new Date(Date.parse(iso) + min * 60_000).toISOString();
const localZone = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return ET; } })();
const sameClock = (iso: string) => time(iso) === time(iso, localZone);

function BookDialog({ day, slot, onClose, onBooked }: { day: Day; slot: Slot; onClose: () => void; onBooked: () => void }) {
  const { toast } = useToast();
  const siteKey = useTurnstileSiteKey();
  const next = day.slots[slot.index + 1];
  const hourOk = !!next && !next.taken && !next.past;
  const [span, setSpan] = useState<1 | 2>(1);
  const session = useQuery<{ email: string } | null>({ queryKey: ["dx-session"], queryFn: async () => { const r = await fetch("/api/host/session", { credentials: "include" }); return r.ok ? r.json() : null; } });
  const mine = useQuery<Mine>({ queryKey: ["/api/dx/mine"], enabled: !!session.data, queryFn: async () => (await apiRequest("GET", "/api/dx/mine")).json() });
  const [step, setStep] = useState<"email" | "code" | "details" | "done">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [human, setHuman] = useState<string | null>(null);
  const [humanReset, setHumanReset] = useState(0);
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState({ hostName: "", showName: "", link: "", phone: "", about: "" });
  const [photo, setPhoto] = useState<File | null>(null);
  const [done, setDone] = useState<{ id: number; show: string; host: string; photo: string; startAtUtc: string; endAtUtc: string; calendar: Cal } | null>(null);
  useEffect(() => { if (session.data && step !== "done") setStep("details"); }, [session.data]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const p = mine.data?.profile;
    if (p) setF((x) => ({ hostName: x.hostName || p.hostName, showName: x.showName || p.podcastName, link: x.link || p.link, phone: x.phone || p.phone, about: x.about }));
  }, [mine.data]);
  const hasPhoto = !!mine.data?.profile?.photoUrl;
  const end = plus(slot.startAtUtc, day.slotMinutes * span);
  const onAir = `${time(plus(slot.startAtUtc, day.bufferMinutes / 2))}–${time(plus(end, -day.bufferMinutes / 2))}`;

  const run = async (fn: () => Promise<void>, fail: string) => {
    setBusy(true);
    try { await fn(); } catch (e) { toast({ title: fail, description: (e as Error).message, variant: "destructive" }); setHumanReset((n) => n + 1); } finally { setBusy(false); }
  };
  const sendCode = () => run(async () => { await apiRequest("POST", "/api/host/request-code", { email: email.trim(), turnstileToken: human }); setStep("code"); }, "Couldn't send a code");
  const verify = () => run(async () => { await apiRequest("POST", "/api/host/verify-code", { email: email.trim(), code: code.trim(), remember: true }); await session.refetch(); setStep("details"); }, "That code didn't work");
  const book = () => run(async () => {
    const fd = new FormData();
    fd.set("eventId", String(day.eventId));
    fd.set("slotIndex", String(slot.index));
    fd.set("span", String(span));
    fd.set("timezone", localZone);
    for (const [k, v] of Object.entries(f)) fd.set(k, v.trim());
    if (photo) fd.set("photo", photo);
    const r = (await (await apiUpload("POST", "/api/dx/book", fd)).json()) as { id: number; show: string; host: string; photo: string; startAtUtc: string; endAtUtc: string; calendar: Cal };
    setDone(r);
    setStep("done");
    onBooked();
  }, "Couldn't book that");

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="[text-wrap:balance]">{step === "done" ? "You're on the schedule" : `${dayLabel(slot.startAtUtc)}, ${time(slot.startAtUtc)} ET`}</DialogTitle>
          <DialogDescription>{step === "done" ? "We've emailed your confirmation." : "MilitaryVoices Digital Experience · free during the beta"}</DialogDescription>
        </DialogHeader>

        {step !== "done" && (
          <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="How long">
            {([1, 2] as const).map((n) => {
              const off = n === 2 && !hourOk;
              return (
                <button key={n} type="button" role="radio" aria-checked={span === n} disabled={off} onClick={() => setSpan(n)}
                  className={`rounded-xl border-2 p-3 text-left transition-colors ${span === n ? "border-[#053877] bg-[#053877]/5" : "border-border hover:border-[#053877]/40"} ${off ? "cursor-not-allowed opacity-50" : ""}`} data-testid={`dx-span-${n}`}>
                  <span className="block text-base font-bold">{n === 1 ? "30 minutes" : "60 minutes"}</span>
                  <span className="block text-xs text-muted-foreground">{off ? (next ? "The next half-hour is taken" : "The day ends at 10 pm") : `${time(slot.startAtUtc)}–${time(plus(slot.startAtUtc, day.slotMinutes * n))} ET`}</span>
                </button>
              );
            })}
            <p className="col-span-2 text-xs text-muted-foreground">You're live {onAir} ET. The station's 3-minute intro plays before you and its outro after.{!sameClock(slot.startAtUtc) ? ` That's ${time(slot.startAtUtc, localZone)} your time.` : ""}</p>
          </div>
        )}

        {step === "email" && (
          <div className="space-y-3">
            <div>
              <Label htmlFor="dx-email">Your email</Label>
              <Input id="dx-email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@yourshow.com" className="mt-1" />
              <p className="mt-1 text-xs text-muted-foreground">We'll send a code to sign you in, so the booking goes in your MilitaryVoices account.</p>
            </div>
            {siteKey ? <Turnstile siteKey={siteKey} onToken={setHuman} resetSignal={humanReset} /> : null}
            <Button className="w-full" disabled={busy || !/\S+@\S+\.\S+/.test(email) || (!!siteKey && !human)} onClick={() => void sendCode()} data-testid="dx-send-code">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Send me a code"}</Button>
          </div>
        )}
        {step === "code" && (
          <div className="space-y-3">
            <div>
              <Label htmlFor="dx-code">The 6-digit code we emailed to {email}</Label>
              <Input id="dx-code" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} className="mt-1 text-center text-lg tracking-[0.3em]" />
            </div>
            <Button className="w-full" disabled={busy || code.length !== 6} onClick={() => void verify()} data-testid="dx-verify">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Continue"}</Button>
            <button type="button" className="w-full text-xs text-muted-foreground underline" onClick={() => setStep("email")}>Use a different email</button>
          </div>
        )}
        {step === "details" && (
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div><Label htmlFor="dx-name">Your name</Label><Input id="dx-name" value={f.hostName} onChange={(e) => setF({ ...f, hostName: e.target.value })} className="mt-1" /></div>
              <div><Label htmlFor="dx-show">Show or segment name</Label><Input id="dx-show" value={f.showName} onChange={(e) => setF({ ...f, showName: e.target.value })} className="mt-1" /></div>
            </div>
            <div><Label htmlFor="dx-about">What you'll do <span className="font-normal text-muted-foreground">(optional)</span></Label><Textarea id="dx-about" rows={2} value={f.about} onChange={(e) => setF({ ...f, about: e.target.value })} placeholder="A live episode, an interview, the day's news…" className="mt-1" /></div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div><Label htmlFor="dx-link">Link to your show <span className="font-normal text-muted-foreground">(optional)</span></Label><Input id="dx-link" value={f.link} onChange={(e) => setF({ ...f, link: e.target.value })} placeholder="https://" className="mt-1" /></div>
              <div><Label htmlFor="dx-phone">Mobile <span className="font-normal text-muted-foreground">(for show-day texts)</span></Label><Input id="dx-phone" type="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} className="mt-1" /></div>
            </div>
            <div>
              <Label htmlFor="dx-photo">Your photo {hasPhoto ? <span className="font-normal text-muted-foreground">(we have one; add a new one to change it)</span> : <span className="font-normal text-muted-foreground">(shows on screen while you're on)</span>}</Label>
              <div className="mt-1 flex items-center gap-3">
                {(photo || hasPhoto) && <img src={photo ? URL.createObjectURL(photo) : mine.data!.profile!.photoUrl} alt="" className="h-12 w-12 shrink-0 rounded-full object-cover" />}
                <Input id="dx-photo" type="file" accept="image/*" onChange={(e) => setPhoto(e.target.files?.[0] ?? null)} />
              </div>
            </div>
            <Button className="w-full bg-[#F0A71F] text-[#1a1200] hover:bg-[#f5b94a]" disabled={busy || !f.hostName.trim() || !f.showName.trim() || (!hasPhoto && !photo)} onClick={() => void book()} data-testid="dx-book">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : `Book ${span === 2 ? "60" : "30"} minutes`}
            </Button>
          </div>
        )}
        {step === "done" && done && (
          <div className="space-y-4">
            <div className="rounded-xl border border-[#F0A71F] bg-[#fff7e6] p-4 dark:bg-[#F0A71F]/10">
              <p className="text-xs font-bold uppercase tracking-wide text-[#053877] dark:text-[#F0A71F]">Your time</p>
              <p className="text-lg font-bold">{dayLabel(done.startAtUtc)}</p>
              <p className="text-sm">{time(done.startAtUtc)}–{time(done.endAtUtc)} ET{!sameClock(done.startAtUtc) ? ` (${time(done.startAtUtc, localZone)} your time)` : ""}</p>
            </div>
            <div>
              <p className="mb-1 flex items-center gap-1.5 text-sm font-bold"><Share2 className="h-4 w-4" /> Tell your audience</p>
              <p className="mb-3 text-xs text-muted-foreground">Your graphics, a caption and your own link, ready to post.</p>
              <DxShare b={done} />
            </div>
            <details className="text-sm">
              <summary className="cursor-pointer font-semibold">Add it to your calendar</summary>
              <div className="mt-2"><CalendarButtons cal={done.calendar} /></div>
            </details>
            <p className="text-sm text-muted-foreground">It's saved in your account: on <a href="/host/dashboard" className="font-semibold text-[#053877] underline dark:text-[#F0A71F]">your dashboard</a> and at the top of this page, with the link to your booth. It opens an hour before your time.</p>
            <Button variant="outline" className="w-full" onClick={onClose}>Done</Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default function DigitalExperience() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery<{ days: Day[] }>({ queryKey: ["/api/dx"], queryFn: async () => (await apiRequest("GET", "/api/dx")).json(), refetchInterval: 60_000 });
  const session = useQuery<{ email: string } | null>({ queryKey: ["dx-session"], queryFn: async () => { const r = await fetch("/api/host/session", { credentials: "include" }); return r.ok ? r.json() : null; } });
  const mine = useQuery<Mine>({ queryKey: ["/api/dx/mine"], enabled: !!session.data, queryFn: async () => (await apiRequest("GET", "/api/dx/mine")).json() });
  const days = data?.days ?? [];
  // A shared link (?show=<booking>) opens on that show's day, with it marked.
  const shared = useMemo(() => Number(new URLSearchParams(window.location.search).get("show")) || 0, []);
  const sharedDay = days.find((d) => d.slots.some((s) => s.taken?.id === shared));
  const sharedSlot = sharedDay?.slots.find((s) => s.taken?.id === shared && s.taken.first);
  const [sharing, setSharing] = useState<number | null>(null);
  const [dayId, setDayId] = useState<number | null>(null);
  useEffect(() => { if (sharedDay && dayId === null) setDayId(sharedDay.eventId); }, [sharedDay, dayId]);
  const day = days.find((d) => d.eventId === dayId) ?? days.find((d) => d.slots.some((s) => !s.taken && !s.past)) ?? days[0];
  const [pick, setPick] = useState<Slot | null>(null);
  const open = (d: Day) => d.slots.filter((s) => !s.taken && !s.past).length;
  const first = days[0]?.startAtUtc, last = days[days.length - 1]?.startAtUtc;
  const range = useMemo(() => (first && last ? `${shortDay(first).replace(/^\w+, /, "")}–${new Date(last).toLocaleDateString("en-US", { timeZone: ET, day: "numeric" })}` : ""), [first, last]);
  const booked = () => { void qc.invalidateQueries({ queryKey: ["/api/dx"] }); void qc.invalidateQueries({ queryKey: ["/api/dx/mine"] }); };

  return (
    <div className="min-h-screen bg-background">
      <NavBar />
      <section className="bg-[#000741] text-white">
        <div className="mx-auto grid max-w-6xl gap-8 px-4 py-10 sm:px-6 sm:py-14 lg:grid-cols-[1.1fr_0.9fr] lg:items-center">
          <div>
          {/* The artwork says the name and the dates; said once, not twice (Andrew, 20 Oct). The title stays for search and screen readers. */}
          <h1 className="sr-only">MilitaryVoices Digital Experience · {range || "October"} · beta week, free</h1>
          <p className="max-w-xl text-lg text-white/85 [text-wrap:pretty] sm:text-2xl sm:leading-snug">A live channel of military and veteran voices, Monday to Friday, 7 am to 10 pm Eastern. Take 30 or 60 minutes for a live episode, an interview, the day's news, or whatever your voice brings to the community.</p>
          <a href="#pick-a-time" className="mt-6 inline-flex h-12 items-center rounded-full bg-[#F0A71F] px-7 text-base font-bold text-[#1a1200] hover:bg-[#f5b94a]" data-testid="dx-pick-cta">Pick your time ↓</a>
          </div>
          <img src="/dx/hero.jpg" alt="MilitaryVoices Digital Experience: military and veteran voices, live weekdays 7 am to 10 pm ET" className="order-first w-full rounded-2xl shadow-2xl ring-1 ring-white/10 lg:order-none" />
          <ul className="grid gap-3 text-sm sm:grid-cols-3 lg:col-span-2">
            {[[Clock, "30 or 60 minutes", "Pick a time below; an hour takes two half-hours."], [Bot, "Our AI producer runs the show", "It brings you on and off, with a 3-minute intro before you and an outro after."], [Share2, "Ready to share", "Your own link and ready-made graphics for social, the moment you book."]].map(([I, t, d]) => {
              const Icon = I as typeof Clock;
              return <li key={t as string} className="flex gap-3 rounded-xl bg-white/[0.06] p-3"><Icon className="mt-0.5 h-5 w-5 shrink-0 text-[#F0A71F]" /><span><span className="block font-semibold">{t as string}</span><span className="text-white/70">{d as string}</span></span></li>;
            })}
          </ul>
        </div>
      </section>

      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        {!!mine.data?.bookings.length && (
          <div className="mb-6 rounded-2xl border border-[#F0A71F]/60 bg-[#fff7e6] p-4 dark:bg-[#F0A71F]/10" data-testid="dx-mine">
            <p className="text-sm font-bold">Your times</p>
            <ul className="mt-2 space-y-3">
              {mine.data.bookings.map((b) => (
                <li key={b.id} className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm"><span className="font-semibold">{dayLabel(b.startAtUtc)}</span>, {time(b.startAtUtc)}–{time(b.endAtUtc)} ET · {b.show}</span>
                  <span className="flex flex-wrap gap-2"><BoothButton id={b.id} /><button type="button" onClick={() => setSharing(sharing === b.id ? null : b.id)} className="inline-flex h-9 items-center gap-1.5 rounded-full border border-border bg-background px-3.5 text-sm font-semibold hover:bg-muted"><Share2 className="h-4 w-4" /> Share</button><CalendarButtons cal={b.calendar} /></span>
                  {sharing === b.id && <div className="w-full rounded-xl bg-background p-3"><DxShare b={b} /></div>}
                </li>
              ))}
            </ul>
          </div>
        )}

        {sharedSlot && (
          <div className="mb-6 flex items-center gap-4 rounded-2xl border-2 border-[#F0A71F] bg-[#fff7e6] p-4 dark:bg-[#F0A71F]/10" data-testid="dx-shared">
            {sharedSlot.taken!.photo && <img src={sharedSlot.taken!.photo} alt="" className="h-14 w-14 shrink-0 rounded-full object-cover" />}
            <p className="text-sm"><span className="block text-base font-bold">{sharedSlot.taken!.show}</span>with {sharedSlot.taken!.host} · live {dayLabel(sharedSlot.startAtUtc)} at {time(sharedSlot.startAtUtc)} ET on the MilitaryVoices Digital Experience</p>
          </div>
        )}
        <h2 id="pick-a-time" className="scroll-mt-24 text-lg font-bold">Pick a time</h2>
        <p className="text-sm text-muted-foreground">All times Eastern.{localZone !== ET ? " Each booking shows your own time too." : ""}</p>
        {isLoading ? <div className="flex justify-center p-10"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div> : (
          <>
            <div className="mt-4 flex gap-2 overflow-x-auto pb-1" role="tablist">
              {days.map((d) => (
                <button key={d.eventId} type="button" role="tab" aria-selected={day?.eventId === d.eventId} onClick={() => setDayId(d.eventId)}
                  className={`shrink-0 rounded-xl border-2 px-4 py-2 text-left ${day?.eventId === d.eventId ? "border-[#053877] bg-[#053877] text-white" : "border-border hover:border-[#053877]/40"}`} data-testid={`dx-day-${d.eventId}`}>
                  <span className="block text-sm font-bold">{shortDay(d.startAtUtc)}</span>
                  <span className={`block text-xs ${day?.eventId === d.eventId ? "text-white/75" : "text-muted-foreground"}`}>{d.closed ? "Closed" : `${open(d)} open`}</span>
                </button>
              ))}
            </div>
            {day && (
              <ul className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5" data-testid="dx-slots">
                {day.slots.map((s) => {
                  const free = !s.taken && !s.past && !day.closed;
                  return (
                    <li key={s.index}>
                      <button type="button" disabled={!free} onClick={() => setPick(s)}
                        className={`flex h-full w-full flex-col items-start rounded-xl border p-3 text-left transition-colors ${free ? "border-border bg-card hover:border-[#F0A71F] hover:bg-[#F0A71F]/10" : "cursor-default border-transparent bg-muted/60"} ${shared && s.taken?.id === shared ? "ring-2 ring-[#F0A71F]" : ""}`} data-testid={`dx-slot-${s.index}`}>
                        <span className="text-sm font-bold tabular-nums">{time(s.startAtUtc)}</span>
                        {s.taken ? (
                          <span className="mt-1 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                            {s.taken.photo && <img src={s.taken.photo} alt="" className="h-5 w-5 shrink-0 rounded-full object-cover" />}
                            <span className="truncate">{s.taken.first ? s.taken.show : `${s.taken.show}, cont.`}</span>
                          </span>
                        ) : <span className={`mt-1 text-xs font-semibold ${free ? "text-[#8a5a00] dark:text-[#F0A71F]" : "text-muted-foreground"}`}>{s.past ? "Past" : day.closed ? "Closed" : "Open"}</span>}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        )}
        {session.data && <p className="mt-6 text-xs text-muted-foreground"><Check className="mr-1 inline h-3.5 w-3.5" />Signed in as {session.data.email}</p>}
      </main>
      {pick && day && <BookDialog day={day} slot={pick} onClose={() => setPick(null)} onBooked={booked} />}
      <SiteFooter />
    </div>
  );
}
