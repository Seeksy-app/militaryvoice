import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarDays, Check, CheckCheck, RotateCcw, SkipForward, Sparkles, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { adminGet, adminSend } from "@/lib/adminApi";
import { PlatformIcon } from "@/components/SocialIcons";

type SocialPost = {
  id: number;
  signupId: number;
  scheduledAt: string;
  platforms: string;
  caption: string;
  status: "proposed" | "scheduled" | "posted" | "skipped" | "failed";
  jobId: string;
  error: string;
  approvedBy: string;
  podcastName: string;
  hostName: string;
  slotIndex: number;
  imageUrl: string;
  whenLabel: string;
  dayKey: string;
};

const STATUS: Record<SocialPost["status"], { label: string; cls: string }> = {
  proposed: { label: "Waiting for approval", cls: "bg-[#F0A71F]/15 text-[#8a5a00]" },
  scheduled: { label: "Scheduled", cls: "bg-[#053877]/10 text-[#053877]" },
  posted: { label: "Posted", cls: "bg-[#15834f]/10 text-[#15834f]" },
  skipped: { label: "Skipped", cls: "bg-muted text-muted-foreground" },
  failed: { label: "Failed", cls: "bg-destructive/10 text-destructive" },
};

/** An ISO instant as the value a datetime-local input wants, in Eastern. */
function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(d);
  const g = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  return `${g("year")}-${g("month")}-${g("day")}T${g("hour") === "24" ? "00" : g("hour")}:${g("minute")}`;
}
/** The reverse: an Eastern wall-clock value back to an ISO instant. */
function fromLocalInput(v: string): string {
  const [date, time] = v.split("T");
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  const guess = new Date(Date.UTC(y, m - 1, d, hh, mm));
  const offsetMin = (guess.getTime() - new Date(guess.toLocaleString("en-US", { timeZone: "America/New_York" })).getTime()) / 60_000;
  return new Date(guess.getTime() + offsetMin * 60_000).toISOString();
}

/**
 * The social calendar under an event: one post per podcaster, their agenda
 * card, from Riccoh's Facebook, Instagram and LinkedIn. We plan it two a day
 * at 9 and 3 Eastern; he reads each one and approves it, and only then is it
 * handed to the scheduler. Anything can be edited, moved or skipped before
 * that, and taken back after.
 */
export function SocialCalendar({ eventId }: { eventId: number }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState<{ caption: string; when: string }>({ caption: "", when: "" });

  const { data: posts = [], isLoading } = useQuery<SocialPost[]>({
    queryKey: ["/api/admin/social-posts", eventId],
    queryFn: () => adminGet<SocialPost[]>(`/api/admin/social-posts?eventId=${eventId}`),
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["/api/admin/social-posts", eventId] });
  const act = useMutation({
    mutationFn: async (v: { path: string; body?: unknown; method?: "POST" | "PATCH" }) => {
      const r = await adminSend(v.method ?? "POST", v.path, v.body);
      if (!r.ok) throw new Error(((await r.json().catch(() => ({}))) as { message?: string }).message ?? "That didn't work.");
      return r.json();
    },
    onSuccess: () => refresh(),
    onError: (err: Error) => toast({ title: "Couldn't do that", description: err.message, variant: "destructive" }),
  });

  const days = useMemo<Array<[string, SocialPost[]]>>(() => {
    const m = new Map<string, SocialPost[]>();
    for (const p of posts) m.set(p.dayKey, [...(m.get(p.dayKey) ?? []), p]);
    return Array.from(m.entries());
  }, [posts]);
  const waiting = posts.filter((p) => p.status === "proposed").length;
  const scheduled = posts.filter((p) => p.status === "scheduled").length;
  const posted = posts.filter((p) => p.status === "posted").length;

  return (
    <Card data-testid="social-calendar">
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-base"><CalendarDays className="h-4 w-4 text-primary" /> Social calendar</CardTitle>
            <CardDescription>
              One post per podcaster, their agenda card, from Riccoh's Facebook, Instagram and LinkedIn. Two a day, 9 AM and 3 PM Eastern. Nothing goes out until it's approved here.
            </CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" className="gap-1.5 rounded-full" onClick={() => act.mutate({ path: "/api/admin/social-posts/plan", body: { eventId } })} disabled={act.isPending} data-testid="button-social-plan">
              <Sparkles className="h-3.5 w-3.5" /> Plan the posts
            </Button>
            {waiting > 0 && (
              <Button size="sm" className="gap-1.5 rounded-full bg-[#053877] text-white hover:bg-[#0a4a99]" onClick={() => { if (window.confirm(`Approve all ${waiting} waiting posts? They go to the scheduler and post at their times.`)) act.mutate({ path: "/api/admin/social-posts/approve-all", body: { eventId } }); }} disabled={act.isPending} data-testid="button-social-approve-all">
                <CheckCheck className="h-3.5 w-3.5" /> Approve all {waiting}
              </Button>
            )}
          </div>
        </div>
        {posts.length > 0 && (
          <p className="mt-2 text-xs text-muted-foreground">
            <span className="font-semibold text-[#8a5a00]">{waiting}</span> waiting · <span className="font-semibold text-[#053877]">{scheduled}</span> scheduled · <span className="font-semibold text-[#15834f]">{posted}</span> posted
          </p>
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : posts.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing planned yet. Press "Plan the posts" and every podcaster gets a day and a time.</p>
        ) : (
          days.map(([day, rows]) => (
            <div key={day}>
              <h4 className="mb-2 text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground">{rows[0].whenLabel.split(" · ")[0]}</h4>
              <div className="divide-y divide-border overflow-hidden rounded-xl border border-border">
                {rows.map((p) => {
                  const st = STATUS[p.status];
                  const isEditing = editing === p.id;
                  return (
                    <div key={p.id} className={`flex flex-col gap-3 p-3 sm:flex-row ${p.status === "skipped" ? "opacity-60" : ""}`} data-testid={`social-post-${p.id}`}>
                      <a href={p.imageUrl} target="_blank" rel="noreferrer" className="shrink-0" title="The card as it will post">
                        <img src={p.imageUrl} alt="" className="h-24 w-24 rounded-lg border border-border object-cover" loading="lazy" />
                      </a>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-bold tabular-nums">{p.whenLabel.split(" · ")[1]}</span>
                          <span className="truncate text-sm font-semibold">{p.podcastName.trim() || p.hostName}</span>
                          <span className="truncate text-xs text-muted-foreground">with {p.hostName}</span>
                          <span className={`ml-auto rounded-full px-2 py-0.5 text-[11px] font-semibold ${st.cls}`}>{st.label}</span>
                        </div>
                        <div className="mt-1 flex items-center gap-1.5">
                          {p.platforms.split(",").filter(Boolean).map((pl) => (
                            <span key={pl} className="flex h-5 w-5 items-center justify-center rounded-full bg-muted text-foreground/80" title={pl}><PlatformIcon platform={pl as Parameters<typeof PlatformIcon>[0]["platform"]} className="h-3 w-3" /></span>
                          ))}
                          {p.error && <span className="truncate text-xs text-destructive">{p.error}</span>}
                        </div>
                        {isEditing ? (
                          <div className="mt-2 flex flex-col gap-2">
                            <Textarea value={draft.caption} onChange={(e) => setDraft({ ...draft, caption: e.target.value })} rows={5} className="text-sm" />
                            <div className="flex flex-wrap items-center gap-2">
                              <label className="text-xs text-muted-foreground">Post at (Eastern)</label>
                              <input type="datetime-local" value={draft.when} onChange={(e) => setDraft({ ...draft, when: e.target.value })} className="h-8 rounded-md border border-border bg-background px-2 text-xs" />
                              <Button size="sm" className="h-8" onClick={() => { act.mutate({ method: "PATCH", path: `/api/admin/social-posts/${p.id}`, body: { caption: draft.caption, scheduledAt: fromLocalInput(draft.when) } }); setEditing(null); }}>Save</Button>
                              <Button size="sm" variant="ghost" className="h-8" onClick={() => setEditing(null)}>Cancel</Button>
                            </div>
                          </div>
                        ) : (
                          <p className="mt-2 whitespace-pre-line text-xs leading-relaxed text-muted-foreground">{p.caption}</p>
                        )}
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          {p.status === "proposed" && (
                            <>
                              <Button size="sm" className="h-8 gap-1.5 rounded-full bg-[#15834f] text-white hover:bg-[#126e42]" onClick={() => act.mutate({ path: `/api/admin/social-posts/${p.id}/approve` })} disabled={act.isPending} data-testid={`button-social-approve-${p.id}`}><Check className="h-3.5 w-3.5" /> Approve</Button>
                              {!isEditing && <Button size="sm" variant="outline" className="h-8 gap-1.5 rounded-full" onClick={() => { setEditing(p.id); setDraft({ caption: p.caption, when: toLocalInput(p.scheduledAt) }); }}><Pencil className="h-3.5 w-3.5" /> Edit</Button>}
                              <Button size="sm" variant="ghost" className="h-8 gap-1.5 rounded-full text-muted-foreground" onClick={() => act.mutate({ path: `/api/admin/social-posts/${p.id}/skip` })}><SkipForward className="h-3.5 w-3.5" /> Skip</Button>
                            </>
                          )}
                          {(p.status === "scheduled" || p.status === "skipped" || p.status === "failed") && (
                            <Button size="sm" variant="outline" className="h-8 gap-1.5 rounded-full" onClick={() => act.mutate({ path: `/api/admin/social-posts/${p.id}/reopen` })} disabled={act.isPending}><RotateCcw className="h-3.5 w-3.5" /> {p.status === "scheduled" ? "Take it back" : "Put it back"}</Button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}
