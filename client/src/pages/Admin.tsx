import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { NavBar } from "@/components/NavBar";
import { useAdminAuth } from "@/lib/admin-auth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { adminGet, adminSend, adminExportUrl } from "@/lib/adminApi";
import { TimeZoneSelect } from "@/components/TimeZoneSelect";
import { Download, LogOut, Lock, HeadphonesIcon, Ban, Trash2, Star, Plus, Pencil } from "lucide-react";
import type { EventRow, PublicEvent, SignupRow, UpdateEvent, InsertEvent } from "@shared/schema";
import { resolveUploadUrl } from "@/lib/queryClient";
import { detectLocalTimeZone, dateTimeLocalToUtc, utcToDateTimeLocalValue, slotStart, formatDateInZone, formatTimeInZone, zoneLabel, onAirWindow } from "@/lib/schedule";

const SLOT_LENGTH_OPTIONS = [15, 20, 30, 45, 60, 90, 120];

function LoginCard() {
  const { login } = useAdminAuth();
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const { toast } = useToast();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    try {
      await login(password);
    } catch (err) {
      toast({ title: "Incorrect password", variant: "destructive" });
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="mx-auto mt-16 max-w-sm px-4">
      <Card>
        <CardHeader>
          <div className="mb-1 flex items-center gap-2 text-primary">
            <Lock className="h-4 w-4" />
            <CardTitle className="text-base">Host access</CardTitle>
          </div>
          <CardDescription>Enter the host password to manage this marathon.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="flex flex-col gap-3" data-testid="form-admin-login">
            <Input
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              data-testid="input-admin-password"
            />
            <Button type="submit" disabled={pending || !password} data-testid="button-admin-login">
              {pending ? "Checking…" : "Enter dashboard"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

interface EventFormState {
  name: string;
  slug: string;
  tagline: string;
  startLocal: string;
  durationHours: number;
  slotMinutes: number;
}

function blankEventForm(zone: string): EventFormState {
  return {
    name: "",
    slug: "",
    tagline: "",
    startLocal: utcToDateTimeLocalValue(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), zone),
    durationHours: 24,
    slotMinutes: 60,
  };
}

function EventFormFields({
  form,
  onChange,
}: {
  form: EventFormState;
  onChange: (next: EventFormState) => void;
}) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <div>
        <Label>Event name</Label>
        <Input value={form.name} onChange={(e) => onChange({ ...form, name: e.target.value })} data-testid="input-new-event-name" />
      </div>
      <div>
        <Label>Slug (used in the URL)</Label>
        <Input
          value={form.slug}
          onChange={(e) => onChange({ ...form, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-") })}
          placeholder="summer-marathon"
          data-testid="input-new-event-slug"
        />
      </div>
      <div className="sm:col-span-2">
        <Label>Tagline</Label>
        <Input value={form.tagline} onChange={(e) => onChange({ ...form, tagline: e.target.value })} data-testid="input-new-event-tagline" />
      </div>
      <div>
        <Label>Start time (your local zone)</Label>
        <Input
          type="datetime-local"
          value={form.startLocal}
          onChange={(e) => onChange({ ...form, startLocal: e.target.value })}
          data-testid="input-new-event-start"
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>Duration (hrs)</Label>
          <Input
            type="number"
            min={1}
            value={form.durationHours}
            onChange={(e) => onChange({ ...form, durationHours: Number(e.target.value) })}
            data-testid="input-new-event-duration"
          />
        </div>
        <div>
          <Label>Slot length (min)</Label>
          <Select value={String(form.slotMinutes)} onValueChange={(v) => onChange({ ...form, slotMinutes: Number(v) })}>
            <SelectTrigger data-testid="select-new-event-slot-minutes">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SLOT_LENGTH_OPTIONS.map((m) => (
                <SelectItem key={m} value={String(m)}>
                  {m} minutes
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>
  );
}

function EventsManagementCard({ password }: { password: string }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const zone = useMemo(detectLocalTimeZone, []);
  const { data: events, isLoading } = useQuery<PublicEvent[]>({
    queryKey: ["/api/admin/events", password],
    queryFn: () => adminGet<PublicEvent[]>("/api/admin/events", password),
  });

  const [creating, setCreating] = useState(false);
  const [newForm, setNewForm] = useState<EventFormState>(() => blankEventForm(zone));
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<EventFormState | null>(null);

  async function refreshEverything() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["/api/admin/events"] }),
      queryClient.invalidateQueries({ queryKey: ["/api/admin/event"] }),
      queryClient.invalidateQueries({ queryKey: ["/api/event"] }),
      queryClient.invalidateQueries({ queryKey: ["/api/events"] }),
      queryClient.invalidateQueries({ queryKey: ["/api/signups"] }),
    ]);
  }

  async function handleCreate() {
    if (!newForm.name.trim() || !newForm.slug.trim()) {
      toast({ title: "Name and slug are required", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const payload: InsertEvent = {
        name: newForm.name,
        slug: newForm.slug,
        tagline: newForm.tagline,
        description: "",
        startAtUtc: dateTimeLocalToUtc(newForm.startLocal, zone).toISOString(),
        durationHours: newForm.durationHours,
        slotMinutes: newForm.slotMinutes,
        onAirMinutes: Math.max(1, newForm.slotMinutes - 5),
        bufferMinutes: Math.min(5, newForm.slotMinutes - 1),
        bufferPosition: "after",
        isFeatured: false,
      } as InsertEvent;
      await adminSend("POST", "/api/admin/events", password, payload);
      await refreshEverything();
      toast({ title: "Event created" });
      setCreating(false);
      setNewForm(blankEventForm(zone));
    } catch (err) {
      toast({ title: "Couldn't create event", description: (err as Error).message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  async function handleSetFeatured(id: number) {
    try {
      await adminSend("PUT", `/api/admin/events/${id}`, password, { isFeatured: true } as UpdateEvent);
      await refreshEverything();
      toast({ title: "Featured event updated" });
    } catch (err) {
      toast({ title: "Couldn't update", description: (err as Error).message, variant: "destructive" });
    }
  }

  function startEdit(event: PublicEvent) {
    setEditingId(event.id);
    setEditForm({
      name: event.name,
      slug: event.slug,
      tagline: event.tagline,
      startLocal: utcToDateTimeLocalValue(new Date(event.startAtUtc), zone),
      durationHours: event.durationHours,
      slotMinutes: event.slotMinutes,
    });
  }

  async function handleSaveEdit() {
    if (!editingId || !editForm) return;
    setSaving(true);
    try {
      const patch: UpdateEvent = {
        name: editForm.name,
        slug: editForm.slug,
        tagline: editForm.tagline,
        startAtUtc: dateTimeLocalToUtc(editForm.startLocal, zone).toISOString(),
        durationHours: editForm.durationHours,
        slotMinutes: editForm.slotMinutes,
      };
      await adminSend("PUT", `/api/admin/events/${editingId}`, password, patch);
      await refreshEverything();
      toast({ title: "Event updated" });
      setEditingId(null);
      setEditForm(null);
    } catch (err) {
      toast({ title: "Couldn't save", description: (err as Error).message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0">
        <div>
          <CardTitle className="text-base">Events</CardTitle>
          <CardDescription>Add new marathons and choose which one is featured on the homepage.</CardDescription>
        </div>
        {!creating && (
          <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setCreating(true)} data-testid="button-new-event">
            <Plus className="h-3.5 w-3.5" /> New event
          </Button>
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {creating && (
          <div className="rounded-lg border border-border p-4">
            <EventFormFields form={newForm} onChange={setNewForm} />
            <div className="mt-3 flex gap-2">
              <Button size="sm" onClick={handleCreate} disabled={saving} data-testid="button-create-event">
                {saving ? "Creating…" : "Create event"}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setCreating(false)} disabled={saving}>
                Cancel
              </Button>
            </div>
          </div>
        )}

        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-14 w-full" />
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {(events ?? []).map((event) => (
              <div key={event.id} className="rounded-lg border border-border p-3" data-testid={`card-admin-event-${event.id}`}>
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-card-foreground">{event.name}</span>
                      {event.isFeatured && (
                        <Badge className="gap-1 bg-primary/15 text-xs font-normal text-primary hover:bg-primary/15">
                          <Star className="h-3 w-3" /> Featured
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      /event/{event.slug} · {formatDateInZone(new Date(event.startAtUtc), zone)} {formatTimeInZone(new Date(event.startAtUtc), zone)}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-1.5">
                    {!event.isFeatured && (
                      <Button variant="outline" size="sm" onClick={() => handleSetFeatured(event.id)} data-testid={`button-feature-${event.id}`}>
                        Set as featured
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => (editingId === event.id ? setEditingId(null) : startEdit(event))}
                      aria-label="Edit event"
                      data-testid={`button-edit-event-${event.id}`}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
                {editingId === event.id && editForm && (
                  <div className="mt-3 border-t border-border pt-3">
                    <EventFormFields form={editForm} onChange={setEditForm} />
                    <div className="mt-3 flex gap-2">
                      <Button size="sm" onClick={handleSaveEdit} disabled={saving} data-testid={`button-save-event-${event.id}`}>
                        {saving ? "Saving…" : "Save"}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setEditingId(null)} disabled={saving}>
                        Cancel
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function EventSettingsCard({ password }: { password: string }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: event } = useQuery<EventRow>({
    queryKey: ["/api/admin/event", password],
    queryFn: () => adminGet<EventRow>("/api/admin/event", password),
  });

  const [zone, setZone] = useState(detectLocalTimeZone);
  const localZone = useMemo(detectLocalTimeZone, []);
  const [form, setForm] = useState<{
    name: string;
    tagline: string;
    description: string;
    startLocal: string;
    durationHours: number;
    slotMinutes: number;
    onAirMinutes: number;
    bufferMinutes: number;
    bufferPosition: "before" | "after";
  } | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (event) {
      setForm({
        name: event.name,
        tagline: event.tagline,
        description: event.description,
        startLocal: utcToDateTimeLocalValue(new Date(event.startAtUtc), zone),
        durationHours: event.durationHours,
        slotMinutes: event.slotMinutes,
        onAirMinutes: event.onAirMinutes,
        bufferMinutes: event.bufferMinutes,
        bufferPosition: (event.bufferPosition as "before" | "after") ?? "after",
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [event]);

  // Recompute the displayed start time whenever the settings time zone changes,
  // without discarding other edits in progress.
  function handleZoneChange(next: string) {
    if (event && form) {
      const currentUtc = dateTimeLocalToUtc(form.startLocal, zone);
      setForm({ ...form, startLocal: utcToDateTimeLocalValue(currentUtc, next) });
    }
    setZone(next);
  }

  async function handleSave() {
    if (!form) return;
    setSaving(true);
    try {
      const patch: UpdateEvent = {
        name: form.name,
        tagline: form.tagline,
        description: form.description,
        startAtUtc: dateTimeLocalToUtc(form.startLocal, zone).toISOString(),
        durationHours: form.durationHours,
        slotMinutes: form.slotMinutes,
        onAirMinutes: form.onAirMinutes,
        bufferMinutes: form.bufferMinutes,
        bufferPosition: form.bufferPosition,
      };
      await adminSend("PUT", "/api/admin/event", password, patch);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["/api/admin/event"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/event"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/signups"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/admin/signups"] }),
      ]);
      toast({ title: "Event settings saved" });
    } catch (err) {
      toast({ title: "Couldn't save", description: (err as Error).message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  if (!form) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Event settings</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Event settings</CardTitle>
        <CardDescription>
          This builds the whole schedule — change the start time, how long it runs, and how long each slot is.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div>
          <Label htmlFor="event-name">Event name</Label>
          <Input id="event-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} data-testid="input-event-name" />
        </div>
        <div>
          <Label htmlFor="event-tagline">Tagline</Label>
          <Input id="event-tagline" value={form.tagline} onChange={(e) => setForm({ ...form, tagline: e.target.value })} data-testid="input-event-tagline" />
        </div>
        <div>
          <Label htmlFor="event-description">Description</Label>
          <Textarea
            id="event-description"
            rows={3}
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            data-testid="input-event-description"
          />
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="event-start">Start time</Label>
            <Input
              id="event-start"
              type="datetime-local"
              value={form.startLocal}
              onChange={(e) => setForm({ ...form, startLocal: e.target.value })}
              data-testid="input-event-start"
            />
            <p className="mt-1 text-xs text-muted-foreground">Interpreted in the zone selected below.</p>
          </div>
          <div>
            <Label>Time zone for start time</Label>
            <TimeZoneSelect value={zone} onChange={handleZoneChange} onDetect={() => handleZoneChange(localZone)} localZone={localZone} />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="event-duration">Duration (hours)</Label>
            <Input
              id="event-duration"
              type="number"
              min={1}
              max={168}
              value={form.durationHours}
              onChange={(e) => setForm({ ...form, durationHours: Number(e.target.value) })}
              data-testid="input-event-duration"
            />
          </div>
          <div>
            <Label htmlFor="event-slot-minutes">Slot length</Label>
            <Select value={String(form.slotMinutes)} onValueChange={(v) => setForm({ ...form, slotMinutes: Number(v) })}>
              <SelectTrigger id="event-slot-minutes" data-testid="select-slot-minutes">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SLOT_LENGTH_OPTIONS.map((m) => (
                  <SelectItem key={m} value={String(m)}>
                    {m} minutes
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <p className="text-xs text-muted-foreground" data-testid="text-slot-count">
          That's {Math.floor((form.durationHours * 60) / form.slotMinutes)} slots on the schedule.
        </p>

        <div className="rounded-lg border border-border p-4">
          <Label className="text-sm font-semibold">On-air time vs. sponsor/transition buffer</Label>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Split each booked slot into the podcaster's actual talk time and a short buffer for sponsor reads or
            transitioning to the next show.
          </p>
          <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <Label htmlFor="event-onair-minutes">On-air minutes</Label>
              <Input
                id="event-onair-minutes"
                type="number"
                min={1}
                max={form.slotMinutes}
                value={form.onAirMinutes}
                onChange={(e) => setForm({ ...form, onAirMinutes: Number(e.target.value) })}
                data-testid="input-onair-minutes"
              />
            </div>
            <div>
              <Label htmlFor="event-buffer-minutes">Buffer minutes</Label>
              <Input
                id="event-buffer-minutes"
                type="number"
                min={0}
                max={form.slotMinutes}
                value={form.bufferMinutes}
                onChange={(e) => setForm({ ...form, bufferMinutes: Number(e.target.value) })}
                data-testid="input-buffer-minutes"
              />
            </div>
            <div>
              <Label htmlFor="event-buffer-position">Buffer position</Label>
              <Select
                value={form.bufferPosition}
                onValueChange={(v) => setForm({ ...form, bufferPosition: v as "before" | "after" })}
              >
                <SelectTrigger id="event-buffer-position" data-testid="select-buffer-position">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="before">Before on-air segment</SelectItem>
                  <SelectItem value="after">After on-air segment</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          {form.onAirMinutes + form.bufferMinutes !== form.slotMinutes && (
            <p className="mt-2 text-xs text-amber-600 dark:text-amber-500" data-testid="text-buffer-mismatch">
              Heads up: on-air + buffer ({form.onAirMinutes + form.bufferMinutes}m) doesn't match the {form.slotMinutes}m
              slot length.
            </p>
          )}
        </div>

        <Button onClick={handleSave} disabled={saving} className="self-start" data-testid="button-save-event">
          {saving ? "Saving…" : "Save settings"}
        </Button>
      </CardContent>
    </Card>
  );
}

function SignupsCard({ password }: { password: string }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: event } = useQuery<EventRow>({
    queryKey: ["/api/admin/event", password],
    queryFn: () => adminGet<EventRow>("/api/admin/event", password),
  });
  const { data: signups, isLoading } = useQuery<SignupRow[]>({
    queryKey: ["/api/admin/signups", password],
    queryFn: () => adminGet<SignupRow[]>("/api/admin/signups", password),
  });
  const zone = useMemo(detectLocalTimeZone, []);

  async function cancelSignup(id: number) {
    await adminSend("PATCH", `/api/admin/signups/${id}/cancel`, password);
    queryClient.invalidateQueries({ queryKey: ["/api/admin/signups"] });
    queryClient.invalidateQueries({ queryKey: ["/api/signups"] });
    toast({ title: "Slot reopened" });
  }

  async function deleteSignup(id: number) {
    await adminSend("DELETE", `/api/admin/signups/${id}`, password);
    queryClient.invalidateQueries({ queryKey: ["/api/admin/signups"] });
    queryClient.invalidateQueries({ queryKey: ["/api/signups"] });
    toast({ title: "Signup removed" });
  }

  const active = (signups ?? []).filter((s) => s.status !== "cancelled");
  const needsInterviewer = active.filter((s) => s.needsInterviewer);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0">
        <div>
          <CardTitle className="text-base">Signups</CardTitle>
          <CardDescription>
            {active.length} confirmed
            {needsInterviewer.length > 0 ? ` · ${needsInterviewer.length} need an interviewer` : ""} · times shown in {zoneLabel(zone)}
          </CardDescription>
        </div>
        <a href={adminExportUrl(password)} target="_blank" rel="noopener noreferrer" data-testid="link-export-csv">
          <Button variant="outline" size="sm" className="gap-1.5">
            <Download className="h-3.5 w-3.5" /> Export CSV
          </Button>
        </a>
      </CardHeader>
      <CardContent>
        {isLoading || !event ? (
          <div className="space-y-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : active.length === 0 ? (
          <p className="text-sm text-muted-foreground">No signups yet — share the schedule link to get started.</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Slot</TableHead>
                  <TableHead>Podcast</TableHead>
                  <TableHead>Contact</TableHead>
                  <TableHead>Notes</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {active
                  .sort((a, b) => a.slotIndex - b.slotIndex)
                  .map((s) => {
                    const start = slotStart(event.startAtUtc, event.slotMinutes, s.slotIndex);
                    const onAir = onAirWindow(start, {
                      onAirMinutes: event.onAirMinutes,
                      bufferMinutes: event.bufferMinutes,
                      bufferPosition: event.bufferPosition,
                    });
                    return (
                      <TableRow key={s.id} data-testid={`row-signup-${s.id}`}>
                        <TableCell className="whitespace-nowrap font-mono text-xs">
                          <div>{formatDateInZone(start, zone)} {formatTimeInZone(start, zone)}</div>
                          <div className="text-muted-foreground">
                            On air {formatTimeInZone(onAir.start, zone)}–{formatTimeInZone(onAir.end, zone)}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2 font-medium">
                            {s.photoUrl && (
                              <img
                                src={resolveUploadUrl(s.photoUrl)}
                                alt={s.hostName}
                                className="h-6 w-6 shrink-0 rounded-full object-cover ring-1 ring-border"
                              />
                            )}
                            {s.podcastName}
                          </div>
                          <div className="flex flex-wrap gap-1 pt-1">
                            <Badge variant="outline" className="text-xs font-normal">
                              {s.numPeople === 2 ? "2 hosts" : "1 host"}
                            </Badge>
                            {s.hasVideoIntro && <Badge variant="outline" className="text-xs font-normal">Intro</Badge>}
                            {s.hasVideoOutro && <Badge variant="outline" className="text-xs font-normal">Outro</Badge>}
                            {s.hasSlides && <Badge variant="outline" className="text-xs font-normal">Slides</Badge>}
                            {s.hasImages && <Badge variant="outline" className="text-xs font-normal">Images</Badge>}
                            {s.needsInterviewer && (
                              <Badge className="gap-1 bg-primary/15 text-xs font-normal text-primary hover:bg-primary/15">
                                <HeadphonesIcon className="h-3 w-3" /> Needs interviewer
                              </Badge>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-sm">
                          <div>{s.hostName}</div>
                          <div className="text-muted-foreground">{s.email}</div>
                          {s.phone && <div className="text-muted-foreground">{s.phone}</div>}
                        </TableCell>
                        <TableCell className="max-w-[220px] text-sm text-muted-foreground">
                          {s.socialLinks && <div className="truncate">{s.socialLinks}</div>}
                          {s.notes && <div className="truncate">{s.notes}</div>}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => cancelSignup(s.id)}
                              aria-label="Reopen this slot"
                              data-testid={`button-cancel-${s.id}`}
                            >
                              <Ban className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => deleteSignup(s.id)}
                              aria-label="Delete this signup"
                              data-testid={`button-delete-${s.id}`}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function Admin() {
  const { isAuthenticated, password, logout } = useAdminAuth();

  return (
    <div className="min-h-screen">
      <NavBar />
      {!isAuthenticated || !password ? (
        <LoginCard />
      ) : (
        <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
          <div className="mb-6 flex items-center justify-between">
            <h1 className="text-xl font-bold tracking-tight" style={{ fontFamily: "'General Sans', 'Inter', sans-serif" }}>
              Host dashboard
            </h1>
            <Button variant="ghost" size="sm" onClick={logout} className="gap-1.5" data-testid="button-admin-logout">
              <LogOut className="h-3.5 w-3.5" /> Log out
            </Button>
          </div>
          <div className="flex flex-col gap-6">
            <EventsManagementCard password={password} />
            <EventSettingsCard password={password} />
            <SignupsCard password={password} />
          </div>
        </div>
      )}
    </div>
  );
}
