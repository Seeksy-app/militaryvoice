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
import { Scissors, Users, Download, CalendarClock } from "lucide-react";

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

function SectionHeading({ icon: Icon, children }: { icon: typeof Scissors; children: React.ReactNode }) {
  return (
    <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.08em] text-foreground">
      <Icon className="h-4 w-4" /> {children}
    </h2>
  );
}

export function PromotionScreen({ contacts }: { contacts: Contact[] }) {
  const zone = useMemo(detectLocalTimeZone, []);
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
              <CampaignPlanner signupId={chosen.signupId!} />
            </>
          )}
        </>
      )}

      {/* --------------------------------------------------------- the clips */}
      <div>
        <SectionHeading icon={Scissors}>Clips cut for you</SectionHeading>
        <p className="mb-4 max-w-2xl text-sm text-muted-foreground">
          After your slot the studio reads back what was said and cuts the moments that stand on their own — vertical,
          square and wide, with the words in a subtitle file. Nothing to request and nothing to edit.
        </p>
        <MyClips />
      </div>

      {/* ------------------------------------------------------------- fans */}
      <div>
        <div className="mb-3 flex items-center justify-between gap-3">
          <SectionHeading icon={Users}>Fans who asked for a reminder ({contacts.length})</SectionHeading>
          {contacts.length > 0 && (
            <a href={`${API_BASE}/api/host/export.csv`} data-testid="link-host-export-csv">
              <Button variant="outline" size="sm" className="gap-1.5 rounded-full">
                <Download className="h-3.5 w-3.5" /> Export CSV
              </Button>
            </a>
          )}
        </div>
        {contacts.length === 0 ? (
          <div className="rounded-xl border border-border bg-card p-5 text-sm text-muted-foreground">
            Nobody has asked for a reminder yet. The share card above is what starts that — every person who taps it
            can ask to be told when you're on.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-border bg-card">
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
        )}
      </div>
    </section>
  );
}
