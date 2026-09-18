import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ShareYourSlot } from "@/components/ShareYourSlot";
import { CampaignPlanner } from "@/components/CampaignPlanner";
import { MyClips } from "@/components/MyClips";
import { apiRequest, API_BASE } from "@/lib/queryClient";
import { formatDateInZone, formatTimeInZone, detectLocalTimeZone, slotStart, onAirWindow } from "@/lib/schedule";
import type { PublicEvent } from "@shared/schema";
import { Users, Download, CalendarClock, ChevronDown } from "lucide-react";

// Everything that puts an audience in front of a show, in one place.
//
// These pieces used to sit at the bottom of an event, underneath the work.
// People finished the work and left — which is the wrong way round, because
// promotion is what decides whether anyone is watching. The clips belong here
// too: they were filed under Recordings, which reads as "after the show", but
// a clip is not an archive, it is next week's post.

interface EventEntry {
  event: PublicEvent;
  show: { showName: string } | null;
  slotIndex: number | null;
  signupId: number | null;
}

interface Contact {
  id: number;
  name: string;
  email: string;
  phone: string;
  createdAt: string;
}


/** The people who asked to be told when this show is on. */
function FansPanel({ contacts, open, onToggle }: { contacts: Contact[]; open: boolean; onToggle: () => void }) {
  return (
    <div className="rounded-2xl border border-border bg-card">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full flex-wrap items-center justify-between gap-3 px-5 py-4 text-left transition-colors hover:bg-[#053877]/[0.04]"
        aria-expanded={open}
        data-testid="button-toggle-fans"
      >
        <span className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <Users className="h-4 w-4 text-primary" /> Fans who asked for a reminder
          <span className="rounded-full bg-[#053877]/10 px-2 py-0.5 text-xs font-bold text-[#053877] dark:bg-white/10 dark:text-white">
            {contacts.length}
          </span>
        </span>
        <span className="inline-flex items-center gap-1 text-sm font-medium text-primary">
          {open ? "Hide" : "See their emails"} <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-180" : ""}`} />
        </span>
      </button>

      {open && (
        <div className="border-t border-border p-5 pt-4">
          {contacts.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nobody yet. The share card above is what starts this — everyone who taps it can ask to be told when
              you're on.
            </p>
          ) : (
            <>
              <div className="mb-3 flex justify-end">
                <a href={`${API_BASE}/api/host/export.csv`} data-testid="link-host-export-csv">
                  <Button variant="outline" size="sm" className="gap-1.5 rounded-full">
                    <Download className="h-3.5 w-3.5" /> Export CSV
                  </Button>
                </a>
              </div>
              <div className="overflow-x-auto rounded-xl border border-border">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-xs uppercase tracking-[0.08em] text-foreground">
                      <th className="px-4 py-2.5 font-medium">Name</th>
                      <th className="px-4 py-2.5 font-medium">Email</th>
                      <th className="px-4 py-2.5 font-medium">Phone</th>
                      <th className="px-4 py-2.5 font-medium">Signed up</th>
                    </tr>
                  </thead>
                  <tbody>
                    {contacts.map((c) => (
                      <tr key={c.id} className="border-b border-border last:border-0" data-testid={`row-contact-${c.id}`}>
                        <td className="px-4 py-2.5 font-medium text-card-foreground">{c.name || "—"}</td>
                        <td className="px-4 py-2.5 text-card-foreground">{c.email}</td>
                        <td className="px-4 py-2.5 text-muted-foreground">{c.phone || "—"}</td>
                        <td className="px-4 py-2.5 text-muted-foreground">{new Date(c.createdAt).toLocaleDateString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export function PromotionScreen({ contacts }: { contacts: Contact[] }) {
  const zone = useMemo(detectLocalTimeZone, []);
  const [fansOpen, setFansOpen] = useState(false);
  const [eventId, setEventId] = useState<number | null>(null);

  const { data: entries, isLoading } = useQuery<EventEntry[]>({
    queryKey: ["/api/host/events"],
    queryFn: async () => (await apiRequest("GET", "/api/host/events")).json(),
  });

  // Only events they actually hold a slot on have anything to promote.
  const booked = (entries ?? []).filter((e) => e.slotIndex != null && e.signupId != null);
  const chosen = booked.find((e) => e.event.id === eventId) ?? booked[0] ?? null;

  const whenLabel = chosen
    ? (() => {
        const air = onAirWindow(slotStart(chosen.event.startAtUtc, chosen.event.slotMinutes, chosen.slotIndex!), {
          onAirMinutes: chosen.event.onAirMinutes,
          bufferMinutes: chosen.event.bufferMinutes,
          bufferPosition: chosen.event.bufferPosition,
        });
        return `${formatDateInZone(air.start, zone)} · ${formatTimeInZone(air.start, zone)}`;
      })()
    : "";

  return (
    <section className="mt-6 flex flex-col gap-10">
      {/* --------------------------------------------------- share the slot */}
      {isLoading ? (
        <Skeleton className="h-40 w-full rounded-2xl" />
      ) : booked.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-muted/20 p-5">
          <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <CalendarClock className="h-4 w-4 text-primary" /> Nothing to promote yet
          </p>
          <p className="mt-1 max-w-xl text-sm text-muted-foreground">
            Take a time on an event and this fills up: a share card with your slot on it, a posting plan for the days
            before, and the clips we cut from your show afterwards.
          </p>
        </div>
      ) : (
        <>
          {booked.length > 1 && (
            <div className="flex flex-wrap gap-2">
              {booked.map((e) => {
                const on = chosen?.event.id === e.event.id;
                return (
                  <button
                    key={e.event.id}
                    type="button"
                    aria-pressed={on}
                    onClick={() => setEventId(e.event.id)}
                    className={`rounded-full border px-3 py-1.5 text-sm font-medium transition-colors ${
                      on ? "border-primary bg-primary/10 text-primary" : "border-border bg-card hover:bg-[#053877]/[0.04]"
                    }`}
                    data-testid={`filter-promotion-${e.event.id}`}
                  >
                    {e.event.name}
                  </button>
                );
              })}
            </div>
          )}

          {chosen && (
            <>
              {/* Both of these bring their own heading — a second one above
                  each just said the same words twice. */}
              <div id="section-share-slot" className="scroll-mt-24" />
              <ShareYourSlot
                signupId={chosen.signupId!}
                podcastName={chosen.show?.showName || chosen.event.name}
                whenLabel={whenLabel}
              />

              {/* Where the share card leads. Everybody who taps it can ask to
                  be told when this show is on, and that list is the one thing
                  on this page that is a result rather than a task — so it is
                  named here, next to the thing that produces it. */}
              <button
                type="button"
                onClick={() => {
                  setFansOpen(true);
                  window.requestAnimationFrame(() =>
                    document.getElementById("section-fans")?.scrollIntoView({ behavior: "smooth", block: "center" }),
                  );
                }}
                className="-mt-4 inline-flex w-fit items-center gap-1.5 text-sm font-medium text-primary hover:underline"
                data-testid="link-see-fans"
              >
                <Users className="h-3.5 w-3.5" />
                {contacts.length === 0
                  ? "Nobody has asked for a reminder yet"
                  : `${contacts.length} ${contacts.length === 1 ? "person has" : "people have"} asked for a reminder — see their emails`}
              </button>
              <CampaignPlanner signupId={chosen.signupId!} />
            </>
          )}
        </>
      )}

      {/* ---------------------------------------------------------- the fans */}
      {/* A list of email addresses is a thing you go and get, not a thing you
          read on the way past. It was a permanent block under the work; it is
          a line now, and it opens when somebody wants it — which also keeps
          it out of the nav, where it would be a seventh tab for a table. */}
      <div id="section-fans" className="scroll-mt-24">
        <FansPanel contacts={contacts} open={fansOpen} onToggle={() => setFansOpen((v) => !v)} />
      </div>

    </section>
  );
}
