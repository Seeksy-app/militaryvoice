import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
import { useToast } from "@/hooks/use-toast";
import { RUN_ITEM_KINDS, type RunItemRow, type SignupRow, type ShowAssetRow, type EventRow } from "@shared/schema";
import { detectLocalTimeZone, formatDateInZone, formatTimeInZone, zoneLabel } from "@/lib/schedule";
import {
  ListOrdered,
  Wand2,
  Plus,
  Trash2,
  Pencil,
  Check,
  X,
  Paperclip,
  ExternalLink,
  Radio,
  Download,
  PlayCircle,
  Lock,
  RotateCcw,
  ChevronDown,
  ChevronUp,
} from "lucide-react";

interface Props {
  adminGet: <T>(path: string) => Promise<T>;
  adminSend: (method: string, path: string, body?: unknown) => Promise<Response>;
}

const KIND_STYLE: Record<string, string> = {
  "Pre-show": "bg-slate-200 text-slate-800",
  Sponsor: "bg-[#F0A71F] text-[#1a1200]",
  Intro: "bg-primary text-primary-foreground",
  Segment: "bg-emerald-600 text-white",
  Handoff: "bg-slate-300 text-slate-800",
  Break: "bg-slate-300 text-slate-800",
  Custom: "bg-muted text-foreground",
};

const COLLAPSED_ROWS = 8;

export function RunOfShow({ adminGet, adminSend }: Props) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const zone = useMemo(detectLocalTimeZone, []);
  // Forty-eight slots is a lot of page. Start folded and show the next few,
  // because on show day what matters is what's coming, not the whole day.
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState<Partial<RunItemRow>>({});

  const { data: event } = useQuery<EventRow>({ queryKey: ["/api/admin/event"], queryFn: () => adminGet<EventRow>("/api/admin/event") });
  const { data: items, isLoading } = useQuery<RunItemRow[]>({
    queryKey: ["/api/admin/run-of-show"],
    queryFn: () => adminGet<RunItemRow[]>("/api/admin/run-of-show"),
  });
  const { data: signups } = useQuery<SignupRow[]>({
    queryKey: ["/api/admin/signups"],
    queryFn: () => adminGet<SignupRow[]>("/api/admin/signups"),
  });
  const { data: assets } = useQuery<ShowAssetRow[]>({
    queryKey: ["/api/admin/assets"],
    queryFn: () => adminGet<ShowAssetRow[]>("/api/admin/assets"),
  });

  const signupById = useMemo(() => new Map((signups ?? []).map((s) => [s.id, s])), [signups]);
  const assetsByEmail = useMemo(() => {
    const m = new Map<string, ShowAssetRow[]>();
    for (const a of assets ?? []) {
      const k = a.email.toLowerCase();
      m.set(k, [...(m.get(k) ?? []), a]);
    }
    return m;
  }, [assets]);

  function refresh() {
    queryClient.invalidateQueries({ queryKey: ["/api/admin/run-of-show"] });
  }

  const generate = useMutation({
    mutationFn: async () => adminSend("POST", "/api/admin/run-of-show/generate", {}),
    onSuccess: () => {
      refresh();
      toast({ title: "Run of show rebuilt", description: "Generated from the current schedule and bookings." });
    },
    onError: (e: Error) => toast({ title: "Couldn't rebuild it", description: e.message, variant: "destructive" }),
  });

  const addItem = useMutation({
    mutationFn: async () =>
      adminSend("POST", "/api/admin/run-of-show", {
        item: { kind: "Custom", title: "New item", notes: "", startAtUtc: "", durationMinutes: 0, signupId: null },
      }),
    onSuccess: () => {
      refresh();
      toast({ title: "Row added", description: "Edit it to set the time and details." });
    },
  });

  const saveItem = useMutation({
    mutationFn: async ({ id, patch }: { id: number; patch: Partial<RunItemRow> }) =>
      adminSend("PATCH", `/api/admin/run-of-show/${id}`, patch),
    onSuccess: () => {
      refresh();
      setEditing(null);
      setDraft({});
    },
    onError: (e: Error) => toast({ title: "Couldn't save", description: e.message, variant: "destructive" }),
  });

  const resetItem = useMutation({
    mutationFn: async (id: number) => adminSend("PATCH", `/api/admin/run-of-show/${id}`, { resetToGenerated: true }),
    onSuccess: () => {
      refresh();
      setEditing(null);
      setDraft({});
      toast({ title: "Unpinned", description: "The next rebuild will rewrite this row." });
    },
  });

  const removeItem = useMutation({
    mutationFn: async (id: number) => adminSend("DELETE", `/api/admin/run-of-show/${id}`),
    onSuccess: () => {
      refresh();
      toast({ title: "Row removed" });
    },
  });

  function exportCsv() {
    const rows = [["Time", "Type", "Title", "Duration (min)", "Notes", "Podcaster", "Materials"]];
    for (const it of items ?? []) {
      const s = it.signupId ? signupById.get(it.signupId) : undefined;
      const mats = s ? (assetsByEmail.get(s.email.toLowerCase()) ?? []).map((a) => `${a.kind}: ${a.fileUrl || a.linkUrl}`).join(" | ") : "";
      rows.push([
        it.startAtUtc ? `${formatDateInZone(new Date(it.startAtUtc), zone)} ${formatTimeInZone(new Date(it.startAtUtc), zone)}` : "",
        it.kind,
        it.title,
        String(it.durationMinutes),
        it.notes.replace(/\n/g, " "),
        s ? `${s.podcastName} (${s.hostName})` : "",
        mats,
      ]);
    }
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "run-of-show.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <ListOrdered className="h-4 w-4" />
              Run of show
            </CardTitle>
            <CardDescription>
              The minute-by-minute plan for the studio. Rebuild it from the schedule, then edit any row by hand. Times
              shown in {zoneLabel(zone)}.
            </CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            {items && items.length > 0 && (
              <Button variant="outline" size="sm" className="gap-1.5 rounded-full" onClick={exportCsv} data-testid="button-run-export">
                <Download className="h-3.5 w-3.5" /> CSV
              </Button>
            )}
            <Button variant="outline" size="sm" className="gap-1.5 rounded-full" onClick={() => addItem.mutate()} data-testid="button-run-add">
              <Plus className="h-3.5 w-3.5" /> Add row
            </Button>
            {items && items.length > COLLAPSED_ROWS && (
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5 rounded-full"
                onClick={() => setExpanded((v) => !v)}
                data-testid="button-run-expand"
              >
                {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                {expanded ? "Collapse" : `Show all ${items.length}`}
              </Button>
            )}
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button size="sm" className="gap-1.5 rounded-full" disabled={generate.isPending} data-testid="button-run-generate">
                  <Wand2 className="h-3.5 w-3.5" /> {items && items.length ? "Rebuild" : "Generate"}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Rebuild the run of show?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Times, lengths and podcaster names are refreshed from the current schedule and bookings. Rows you've
                    reworded keep your wording, and rows you added by hand are left alone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={() => generate.mutate()}>Rebuild</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>
      </CardHeader>

      <CardContent>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : !items || items.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border bg-muted/30 p-8 text-center">
            <Radio className="mx-auto h-7 w-7 text-muted-foreground/60" />
            <p className="mt-3 text-sm font-medium">No run of show yet.</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Generate one from {event?.name?.trim() ?? "the event"} and its bookings, then adjust as you go.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {(expanded ? items : items.slice(0, COLLAPSED_ROWS)).map((it) => {
              const s = it.signupId ? signupById.get(it.signupId) : undefined;
              const mats = s ? assetsByEmail.get(s.email.toLowerCase()) ?? [] : [];
              const isEditing = editing === it.id;
              const when = it.startAtUtc ? new Date(it.startAtUtc) : null;

              if (isEditing) {
                return (
                  <div key={it.id} className="rounded-xl border-2 border-primary/40 bg-card p-4" data-testid={`run-edit-${it.id}`}>
                    <div className="grid gap-3 sm:grid-cols-[150px_120px_1fr]">
                      <div>
                        <Label className="text-xs">Type</Label>
                        <Select value={draft.kind ?? it.kind} onValueChange={(v) => setDraft((d) => ({ ...d, kind: v }))}>
                          <SelectTrigger className="mt-1">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {RUN_ITEM_KINDS.map((k) => (
                              <SelectItem key={k} value={k}>
                                {k}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <Label className="text-xs">Minutes</Label>
                        <Input
                          className="mt-1"
                          type="number"
                          min={0}
                          value={draft.durationMinutes ?? it.durationMinutes}
                          onChange={(e) => setDraft((d) => ({ ...d, durationMinutes: Number(e.target.value) }))}
                        />
                      </div>
                      <div>
                        <Label className="text-xs">Title</Label>
                        <Input
                          className="mt-1"
                          value={draft.title ?? it.title}
                          onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
                        />
                      </div>
                    </div>
                    <div className="mt-3">
                      <Label className="text-xs">Notes for the studio</Label>
                      <Textarea
                        className="mt-1"
                        rows={2}
                        value={draft.notes ?? it.notes}
                        onChange={(e) => setDraft((d) => ({ ...d, notes: e.target.value }))}
                      />
                    </div>
                    {/* What this row puts on the stage. A row with something
                        attached becomes one press during the show. */}
                    <div className="mt-3">
                      <Label className="text-xs">On the stage for this row</Label>
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        <Input
                          className="min-w-[220px] flex-1 font-mono text-xs"
                          placeholder="Paste a link, or leave empty for the cameras"
                          value={draft.mediaUrl ?? it.mediaUrl}
                          onChange={(e) => setDraft((d) => ({ ...d, mediaUrl: e.target.value }))}
                          data-testid={`input-run-media-${it.id}`}
                        />
                        <Input
                          className="w-[150px] text-xs"
                          placeholder="Label on air"
                          value={draft.mediaLabel ?? it.mediaLabel}
                          onChange={(e) => setDraft((d) => ({ ...d, mediaLabel: e.target.value }))}
                          data-testid={`input-run-media-label-${it.id}`}
                        />
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Empty means this cue returns the stage to the cameras.
                      </p>
                    </div>

                    <div className="mt-3 flex items-center gap-2">
                      <Button
                        size="sm"
                        className="gap-1.5"
                        onClick={() => {
                          const url = (draft.mediaUrl ?? it.mediaUrl).trim();
                          saveItem.mutate({
                            id: it.id,
                            patch: {
                              kind: draft.kind ?? it.kind,
                              title: draft.title ?? it.title,
                              notes: draft.notes ?? it.notes,
                              durationMinutes: draft.durationMinutes ?? it.durationMinutes,
                              startAtUtc: it.startAtUtc,
                              mediaUrl: url,
                              mediaKind: /\.(png|jpe?g|gif|webp|avif)(\?|$)/i.test(url) ? "image" : "video",
                              mediaLabel: (draft.mediaLabel ?? it.mediaLabel).trim(),
                            },
                          });
                        }}
                      >
                        <Check className="h-3.5 w-3.5" /> Save
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setEditing(null);
                          setDraft({});
                        }}
                      >
                        <X className="h-3.5 w-3.5" /> Cancel
                      </Button>
                      {it.edited && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="ml-auto gap-1.5 text-muted-foreground"
                          title="Let the next rebuild rewrite this row from the schedule"
                          onClick={() => resetItem.mutate(it.id)}
                          data-testid={`button-run-reset-${it.id}`}
                        >
                          <RotateCcw className="h-3.5 w-3.5" /> Unpin
                        </Button>
                      )}
                    </div>
                  </div>
                );
              }

              return (
                <div
                  key={it.id}
                  className="flex flex-wrap items-start gap-3 rounded-xl border border-border bg-card px-4 py-3"
                  data-testid={`run-row-${it.id}`}
                >
                  <div className="w-[104px] shrink-0">
                    <div className="font-mono text-sm font-bold tabular-nums">{when ? formatTimeInZone(when, zone) : "—"}</div>
                    <div className="text-[11px] text-muted-foreground">
                      {when ? formatDateInZone(when, zone) : ""}
                      {it.durationMinutes ? ` · ${it.durationMinutes}m` : ""}
                    </div>
                  </div>

                  <div className="flex shrink-0 flex-col items-start gap-1">
                    <Badge className={`font-normal hover:opacity-100 ${KIND_STYLE[it.kind] ?? KIND_STYLE.Custom}`}>{it.kind}</Badge>
                    {it.edited && (
                      <Badge variant="outline" className="gap-1 border-primary/40 text-[10px] font-normal text-primary" title="Rebuild won't overwrite this row's wording">
                        <Lock className="h-2.5 w-2.5" /> Edited
                      </Badge>
                    )}
                  </div>

                  <div className="min-w-[200px] flex-1">
                    <div className="text-sm font-semibold text-card-foreground">{it.title}</div>
                    {it.notes && <div className="mt-0.5 whitespace-pre-line text-xs text-muted-foreground">{it.notes}</div>}

                    {s?.showFormat === "prerecorded" && (
                      <Badge variant="outline" className="mt-1.5 gap-1 border-[#F0A71F] text-xs font-normal">
                        <PlayCircle className="h-3 w-3" /> Roll their file
                      </Badge>
                    )}

                    {mats.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {mats.map((a) => (
                          <a
                            key={a.id}
                            href={a.fileUrl || a.linkUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 rounded-full border border-border bg-background px-2.5 py-1 text-[11px] font-medium hover-elevate"
                            title={a.label || a.fileName}
                          >
                            <Paperclip className="h-3 w-3 text-primary" />
                            {a.kind}
                            {a.label ? ` · ${a.label}` : ""}
                            <ExternalLink className="h-2.5 w-2.5 opacity-60" />
                          </a>
                        ))}
                      </div>
                    )}

                    {s && (s.guests || s.interviewQuestions || s.promoNotes) && (
                      <details className="mt-2">
                        <summary className="cursor-pointer text-[11px] font-medium text-primary">Show details from the podcaster</summary>
                        <div className="mt-1.5 space-y-1.5 rounded-lg bg-muted/40 p-2.5 text-xs text-muted-foreground">
                          {s.guests && (
                            <p>
                              <span className="font-medium text-foreground">Appearing: </span>
                              <span className="whitespace-pre-line">{s.guests}</span>
                            </p>
                          )}
                          {s.interviewQuestions && (
                            <p>
                              <span className="font-medium text-foreground">Questions: </span>
                              <span className="whitespace-pre-line">{s.interviewQuestions}</span>
                            </p>
                          )}
                          {s.promoNotes && (
                            <p>
                              <span className="font-medium text-foreground">Promote: </span>
                              <span className="whitespace-pre-line">{s.promoNotes}</span>
                            </p>
                          )}
                        </div>
                      </details>
                    )}
                  </div>

                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => {
                        setEditing(it.id);
                        setDraft({});
                      }}
                      aria-label="Edit this row"
                      data-testid={`button-run-edit-${it.id}`}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-muted-foreground hover:text-destructive"
                      onClick={() => removeItem.mutate(it.id)}
                      aria-label="Delete this row"
                      data-testid={`button-run-delete-${it.id}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
        {!expanded && items && items.length > COLLAPSED_ROWS && (
          <button
            type="button"
            className="mt-3 w-full rounded-xl border border-dashed border-border py-3 text-sm text-muted-foreground hover:bg-muted/40"
            onClick={() => setExpanded(true)}
            data-testid="button-run-expand-footer"
          >
            {items.length - COLLAPSED_ROWS} more rows · show the whole agenda
          </button>
        )}
      </CardContent>
    </Card>
  );
}
