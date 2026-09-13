import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { NavBar } from "@/components/NavBar";
import { useAdminAuth } from "@/lib/admin-auth";
import { useIsMobile } from "@/hooks/use-mobile";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { adminGet, adminSend, adminUpload, adminExportUrl } from "@/lib/adminApi";
import { RunOfShow } from "@/components/RunOfShow";
import { TimeZoneSelect } from "@/components/TimeZoneSelect";
import { Download, LogOut, Lock, HeadphonesIcon, Ban, Trash2, Star, Plus, Pencil, ArrowUp, ArrowDown, Eye, EyeOff, ImagePlus, Handshake, Users, KeyRound, PlayCircle } from "lucide-react";
import type { EventRow, PublicEvent, SignupRow, UpdateEvent, InsertEvent, SponsorRow, AdminUserRow, SponsorInquiryRow, PublicSettings } from "@shared/schema";
import { resolveUploadUrl } from "@/lib/queryClient";
import { detectLocalTimeZone, dateTimeLocalToUtc, utcToDateTimeLocalValue, slotStart, formatDateInZone, formatTimeInZone, zoneLabel, onAirWindow } from "@/lib/schedule";

const SLOT_LENGTH_OPTIONS = [15, 20, 30, 45, 60, 90, 120];

function LoginCard() {
  const { requestCode, verifyCode } = useAdminAuth();
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [pending, setPending] = useState(false);
  const { toast } = useToast();

  async function handleEmail(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    try {
      await requestCode(email.trim());
      setStep("code");
      toast({ title: "Check your email", description: "If that address is on the admin list, a 6-digit code is on its way." });
    } catch (err) {
      toast({ title: "Couldn't send that", description: (err as Error).message, variant: "destructive" });
    } finally {
      setPending(false);
    }
  }

  async function handleCode(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    try {
      await verifyCode(email.trim(), code.trim());
    } catch (err) {
      toast({ title: "That code didn't work", description: (err as Error).message, variant: "destructive" });
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="mx-auto mt-16 max-w-sm px-4">
      <Card>
        <CardHeader>
          <div className="mb-1 flex items-center gap-2 text-primary">
            {step === "email" ? <Lock className="h-4 w-4" /> : <KeyRound className="h-4 w-4" />}
            <CardTitle className="text-base">Admin sign-in</CardTitle>
          </div>
          <CardDescription>
            {step === "email"
              ? "Enter your admin email and we'll send a one-time code. No password to remember."
              : `Enter the 6-digit code we sent to ${email}.`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {step === "email" ? (
            <form onSubmit={handleEmail} className="flex flex-col gap-3" data-testid="form-admin-login">
              <Input
                type="email"
                autoFocus
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                data-testid="input-admin-email"
              />
              <Button type="submit" disabled={pending || !email.trim()} data-testid="button-admin-login">
                {pending ? "Sending…" : "Send me a code"}
              </Button>
            </form>
          ) : (
            <form onSubmit={handleCode} className="flex flex-col gap-3" data-testid="form-admin-verify">
              <Input
                inputMode="numeric"
                autoFocus
                placeholder="123456"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                data-testid="input-admin-code"
              />
              <Button type="submit" disabled={pending || !code.trim()} data-testid="button-admin-verify">
                {pending ? "Checking…" : "Enter dashboard"}
              </Button>
              <button
                type="button"
                className="text-xs text-muted-foreground underline-offset-2 hover:underline"
                onClick={() => {
                  setStep("email");
                  setCode("");
                }}
              >
                Use a different email
              </button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Team — who can sign in to this dashboard
// ---------------------------------------------------------------------------
function TeamCard() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { admin } = useAdminAuth();
  const { data: team, isLoading } = useQuery<AdminUserRow[]>({
    queryKey: ["/api/admin/team"],
    queryFn: () => adminGet<AdminUserRow[]>("/api/admin/team"),
  });
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await adminSend("POST", "/api/admin/team", { email: email.trim(), name: name.trim() });
      setEmail("");
      setName("");
      queryClient.invalidateQueries({ queryKey: ["/api/admin/team"] });
      toast({ title: "Teammate added", description: "They can sign in at /admin with their email." });
    } catch (err) {
      toast({ title: "Couldn't add them", description: (err as Error).message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: number, label: string) {
    if (!window.confirm(`Remove ${label} from the admin team?`)) return;
    try {
      await adminSend("DELETE", `/api/admin/team/${id}`);
      queryClient.invalidateQueries({ queryKey: ["/api/admin/team"] });
      toast({ title: "Removed" });
    } catch (err) {
      toast({ title: "Couldn't remove them", description: (err as Error).message, variant: "destructive" });
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Users className="h-4 w-4 text-primary" /> Admin team
        </CardTitle>
        <CardDescription>
          Anyone listed here can sign in at /admin with a one-time code sent to their email. No shared password.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <form onSubmit={add} className="grid gap-3 rounded-xl border border-dashed border-border bg-muted/30 p-4 sm:grid-cols-[1.2fr_1fr_auto] sm:items-end">
          <div>
            <Label htmlFor="team-email" className="text-xs">
              Email
            </Label>
            <Input id="team-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="teammate@example.com" className="mt-1" data-testid="input-team-email" />
          </div>
          <div>
            <Label htmlFor="team-name" className="text-xs">
              Name (optional)
            </Label>
            <Input id="team-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Jamie Rivera" className="mt-1" data-testid="input-team-name" />
          </div>
          <Button type="submit" disabled={busy || !email.trim()} className="gap-1.5" data-testid="button-add-admin">
            <Plus className="h-4 w-4" /> {busy ? "Adding…" : "Add"}
          </Button>
        </form>

        {isLoading ? (
          <Skeleton className="h-16 w-full" />
        ) : (
          <ul className="divide-y divide-border rounded-xl border border-border">
            {(team ?? []).map((m) => (
              <li key={m.id} className="flex items-center gap-3 p-3" data-testid={`row-admin-${m.id}`}>
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary">
                  {(m.name || m.email).charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-semibold">{m.name || m.email}</span>
                    {m.isOwner && <Badge variant="secondary" className="text-[10px]">Owner</Badge>}
                    {admin?.email === m.email && <Badge variant="outline" className="text-[10px]">You</Badge>}
                  </div>
                  {m.name && <div className="truncate text-xs text-muted-foreground">{m.email}</div>}
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-destructive"
                  disabled={m.isOwner}
                  title={m.isOwner ? "The owner can't be removed" : "Remove"}
                  onClick={() => remove(m.id, m.name || m.email)}
                  data-testid={`button-remove-admin-${m.id}`}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
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

function EventsManagementCard() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const zone = useMemo(detectLocalTimeZone, []);
  const { data: events, isLoading } = useQuery<PublicEvent[]>({
    queryKey: ["/api/admin/events"],
    queryFn: () => adminGet<PublicEvent[]>("/api/admin/events"),
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
      await adminSend("POST", "/api/admin/events", payload);
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
      await adminSend("PUT", `/api/admin/events/${id}`, { isFeatured: true } as UpdateEvent);
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
      await adminSend("PUT", `/api/admin/events/${editingId}`, patch);
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

function EventSettingsCard() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: event } = useQuery<EventRow>({
    queryKey: ["/api/admin/event"],
    queryFn: () => adminGet<EventRow>("/api/admin/event"),
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
      await adminSend("PUT", "/api/admin/event", patch);
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

function SignupsCard() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: event } = useQuery<EventRow>({
    queryKey: ["/api/admin/event"],
    queryFn: () => adminGet<EventRow>("/api/admin/event"),
  });
  const { data: signups, isLoading } = useQuery<SignupRow[]>({
    queryKey: ["/api/admin/signups"],
    queryFn: () => adminGet<SignupRow[]>("/api/admin/signups"),
  });
  const zone = useMemo(detectLocalTimeZone, []);

  async function cancelSignup(id: number) {
    await adminSend("PATCH", `/api/admin/signups/${id}/cancel`);
    queryClient.invalidateQueries({ queryKey: ["/api/admin/signups"] });
    queryClient.invalidateQueries({ queryKey: ["/api/signups"] });
    toast({ title: "Slot reopened" });
  }

  async function deleteSignup(id: number) {
    await adminSend("DELETE", `/api/admin/signups/${id}`);
    queryClient.invalidateQueries({ queryKey: ["/api/admin/signups"] });
    queryClient.invalidateQueries({ queryKey: ["/api/signups"] });
    toast({ title: "Signup removed" });
  }

  const active = (signups ?? []).filter((s) => s.status !== "cancelled");
  const needsInterviewer = active.filter((s) => s.needsInterviewer);
  const prerecorded = active.filter((s) => s.showFormat === "prerecorded");

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0">
        <div>
          <CardTitle className="text-base">Who's signed up</CardTitle>
          <CardDescription>
            {active.length} confirmed
            {needsInterviewer.length > 0 ? ` · ${needsInterviewer.length} need an interviewer` : ""}
            {prerecorded.length > 0 ? ` · ${prerecorded.length} pre-recorded` : ""} · times shown in {zoneLabel(zone)}
          </CardDescription>
        </div>
        <a href={adminExportUrl()} target="_blank" rel="noopener noreferrer" data-testid="link-export-csv">
          <Button variant="outline" size="sm" className="gap-1.5 shrink-0">
            <Download className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Export CSV</span>
          </Button>
        </a>
      </CardHeader>
      <CardContent>
        {isLoading || !event ? (
          <div className="space-y-2">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        ) : active.length === 0 ? (
          <p className="text-sm text-muted-foreground">No signups yet — share the schedule link to get started.</p>
        ) : (
          <div className="flex max-h-[70vh] flex-col gap-2.5 overflow-y-auto pr-1">
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
                  <div
                    key={s.id}
                    className="rounded-lg border border-border p-3"
                    data-testid={`row-signup-${s.id}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        {s.photoUrl && (
                          <img
                            src={resolveUploadUrl(s.photoUrl)}
                            alt={s.hostName}
                            className="h-8 w-8 shrink-0 rounded-full object-cover ring-1 ring-border"
                          />
                        )}
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium text-card-foreground">{s.podcastName}</div>
                          <div className="truncate text-xs text-muted-foreground">{s.hostName}</div>
                        </div>
                      </div>
                      <div className="flex shrink-0 gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => cancelSignup(s.id)}
                          aria-label="Reopen this slot"
                          data-testid={`button-cancel-${s.id}`}
                        >
                          <Ban className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => deleteSignup(s.id)}
                          aria-label="Delete this signup"
                          data-testid={`button-delete-${s.id}`}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>

                    <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-xs text-muted-foreground">
                      <span className="font-semibold text-foreground">
                        {formatDateInZone(start, zone)} {formatTimeInZone(start, zone)}
                      </span>
                      <span>
                        On air {formatTimeInZone(onAir.start, zone)}–{formatTimeInZone(onAir.end, zone)}
                      </span>
                    </div>

                    <div className="mt-2 flex flex-wrap gap-1">
                      <Badge variant="outline" className="text-xs font-normal">
                        {s.numPeople === 2 ? "2 hosts" : "1 host"}
                      </Badge>
                      {s.showFormat === "prerecorded" && (
                        <Badge className="gap-1 bg-[#F0A71F] text-xs font-normal text-[#1a1200] hover:bg-[#F0A71F]">
                          <PlayCircle className="h-3 w-3" />
                          Pre-recorded{s.introStyle === "virtual" ? " + intro" : ""}
                        </Badge>
                      )}
                      {(s.serviceStatus || s.branch) && (
                        <Badge variant="outline" className="text-xs font-normal">
                          {[s.serviceStatus, s.branch].filter((v) => v && v !== "Not applicable").join(" · ")}
                        </Badge>
                      )}
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

                    <div className="mt-2 text-xs text-muted-foreground">
                      <div className="truncate">{s.email}</div>
                      {s.phone && <div className="truncate">{s.phone}</div>}
                      {s.socialLinks && <div className="truncate">{s.socialLinks}</div>}
                      {s.notes && <div className="truncate">{s.notes}</div>}
                    </div>
                  </div>
                );
              })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}


// ---------------------------------------------------------------------------
// Sponsors — logo strip shown on the homepage as "Friends of the Podcastathon"
// ---------------------------------------------------------------------------
function SponsorsCard() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: sponsors, isLoading } = useQuery<SponsorRow[]>({
    queryKey: ["/api/admin/sponsors"],
    queryFn: () => adminGet<SponsorRow[]>("/api/admin/sponsors"),
  });
  const { data: settings } = useQuery<PublicSettings>({
    queryKey: ["/api/admin/settings"],
    queryFn: () => adminGet<PublicSettings>("/api/admin/settings"),
  });
  const visible = !!settings?.sponsorsVisible;

  async function setVisible(next: boolean) {
    await adminSend("PATCH", "/api/admin/settings", { sponsorsVisible: next });
    queryClient.invalidateQueries({ queryKey: ["/api/admin/settings"] });
    queryClient.invalidateQueries({ queryKey: ["/api/sponsors"] });
    queryClient.invalidateQueries({ queryKey: ["/api/settings"] });
    toast({ title: next ? "Sponsor strip is live" : "Sponsor strip hidden", description: next ? "It shows on the homepage under the host section." : "Nothing sponsor-related shows on the public site." });
  }

  const { data: inquiries } = useQuery<SponsorInquiryRow[]>({
    queryKey: ["/api/admin/sponsor-inquiries"],
    queryFn: () => adminGet<SponsorInquiryRow[]>("/api/admin/sponsor-inquiries"),
  });
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [logo, setLogo] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function refresh() {
    queryClient.invalidateQueries({ queryKey: ["/api/admin/sponsors"] });
    queryClient.invalidateQueries({ queryKey: ["/api/sponsors"] });
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !logo) {
      toast({ title: "Name and logo are required", variant: "destructive" });
      return;
    }
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("name", name.trim());
      fd.append("url", url.trim());
      fd.append("logo", logo);
      await adminUpload("/api/admin/sponsors", fd);
      setName("");
      setUrl("");
      setLogo(null);
      if (preview) URL.revokeObjectURL(preview);
      setPreview(null);
      refresh();
      toast({ title: "Sponsor added", description: "It's on the homepage strip now." });
    } catch (err) {
      toast({ title: "Couldn't add sponsor", description: (err as Error).message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  async function patch(id: number, body: Partial<Pick<SponsorRow, "name" | "url" | "active" | "sortOrder">>) {
    await adminSend("PATCH", `/api/admin/sponsors/${id}`, body);
    refresh();
  }

  async function move(index: number, dir: -1 | 1) {
    const list = [...(sponsors ?? [])];
    const j = index + dir;
    if (j < 0 || j >= list.length) return;
    const a = list[index];
    const b = list[j];
    await Promise.all([patch(a.id, { sortOrder: b.sortOrder === a.sortOrder ? b.sortOrder + dir : b.sortOrder }), patch(b.id, { sortOrder: a.sortOrder })]);
  }

  async function remove(id: number) {
    if (!window.confirm("Remove this sponsor from the site?")) return;
    await adminSend("DELETE", `/api/admin/sponsors/${id}`);
    refresh();
    toast({ title: "Sponsor removed" });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Handshake className="h-4 w-4 text-primary" /> Friends of the Podcastathon
        </CardTitle>
        <CardDescription>
          Sponsor logos scroll in a strip on the homepage, under the host section. PNG or SVG with a transparent
          background looks best; logos show at about 40px tall.
        </CardDescription>
        <div className="mt-3 flex items-center justify-between gap-3 rounded-xl border border-border bg-muted/40 px-4 py-3">
          <div>
            <div className="text-sm font-medium">Show the strip on the homepage</div>
            <div className="text-xs text-muted-foreground">
              {visible ? "Visitors can see it now." : "Hidden — nothing sponsor-related appears on the public site."}
            </div>
          </div>
          <Switch checked={visible} onCheckedChange={setVisible} aria-label="Show the sponsor strip on the homepage" data-testid="switch-sponsors-visible" />
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <form onSubmit={handleAdd} className="grid gap-3 rounded-xl border border-dashed border-border bg-muted/30 p-4 sm:grid-cols-[auto_1fr_1fr_auto] sm:items-end">
          <div>
            <Label className="text-xs">Logo</Label>
            <label className="mt-1 flex h-16 w-28 cursor-pointer items-center justify-center overflow-hidden rounded-lg border border-border bg-background text-muted-foreground hover:border-primary">
              {preview ? <img src={preview} alt="" className="max-h-12 max-w-[6.5rem] object-contain" /> : <ImagePlus className="h-5 w-5" />}
              <input
                type="file"
                accept="image/png,image/svg+xml,image/jpeg,image/webp"
                className="hidden"
                data-testid="input-sponsor-logo"
                onChange={(e) => {
                  const f = e.target.files?.[0] ?? null;
                  if (preview) URL.revokeObjectURL(preview);
                  setLogo(f);
                  setPreview(f ? URL.createObjectURL(f) : null);
                }}
              />
            </label>
          </div>
          <div>
            <Label htmlFor="sponsor-name" className="text-xs">
              Name
            </Label>
            <Input id="sponsor-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Dept. of Hydration" className="mt-1" data-testid="input-sponsor-name" />
          </div>
          <div>
            <Label htmlFor="sponsor-url" className="text-xs">
              Link (optional)
            </Label>
            <Input id="sponsor-url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="example.com" className="mt-1" data-testid="input-sponsor-url" />
          </div>
          <Button type="submit" disabled={busy} className="gap-1.5" data-testid="button-add-sponsor">
            <Plus className="h-4 w-4" /> {busy ? "Adding…" : "Add"}
          </Button>
        </form>

        {isLoading ? (
          <Skeleton className="h-16 w-full" />
        ) : (sponsors ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">No sponsors yet. Add the first one above and the strip appears on the homepage.</p>
        ) : (
          <ul className="divide-y divide-border rounded-xl border border-border">
            {(sponsors ?? []).map((sp, i, arr) => (
              <li key={sp.id} className={`flex flex-wrap items-center gap-3 p-3 ${sp.active ? "" : "opacity-60"}`} data-testid={`row-sponsor-${sp.id}`}>
                <div className="flex h-12 w-28 items-center justify-center rounded-lg border border-border bg-white px-2">
                  <img src={sp.logoUrl} alt={sp.name} className="max-h-9 max-w-[6rem] object-contain" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold">{sp.name}</div>
                  {sp.url ? (
                    <a href={sp.url} target="_blank" rel="noopener noreferrer" className="truncate text-xs text-primary hover:underline">
                      {sp.url.replace(/^https?:\/\//, "")}
                    </a>
                  ) : (
                    <div className="text-xs text-muted-foreground">No link</div>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  <Button variant="ghost" size="icon" className="h-8 w-8" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move up">
                    <ArrowUp className="h-3.5 w-3.5" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-8 w-8" disabled={i === arr.length - 1} onClick={() => move(i, 1)} aria-label="Move down">
                    <ArrowDown className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => patch(sp.id, { active: !sp.active })}
                    aria-label={sp.active ? "Hide from site" : "Show on site"}
                    title={sp.active ? "Hide from site" : "Show on site"}
                  >
                    {sp.active ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                  </Button>
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => remove(sp.id)} aria-label="Remove">
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}

        {(inquiries ?? []).length > 0 && (
          <div>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-semibold">
                Inquiries{" "}
                <span className="font-normal text-muted-foreground">
                  ({(inquiries ?? []).filter((q) => !q.handled).length} new)
                </span>
              </h3>
            </div>
            <ul className="divide-y divide-border rounded-xl border border-border">
              {(inquiries ?? []).map((q) => (
                <li key={q.id} className={`p-3 ${q.handled ? "opacity-55" : ""}`} data-testid={`row-inquiry-${q.id}`}>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold">
                        {q.company || q.name}
                        {q.company && <span className="ml-1.5 font-normal text-muted-foreground">· {q.name}</span>}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        <a href={`mailto:${q.email}`} className="text-primary hover:underline">
                          {q.email}
                        </a>
                        {q.phone ? ` · ${q.phone}` : ""} · {new Date(q.createdAt).toLocaleDateString()}
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 gap-1 px-2 text-xs"
                      onClick={async () => {
                        await adminSend("PATCH", `/api/admin/sponsor-inquiries/${q.id}`, { handled: !q.handled });
                        queryClient.invalidateQueries({ queryKey: ["/api/admin/sponsor-inquiries"] });
                      }}
                      data-testid={`button-inquiry-handled-${q.id}`}
                    >
                      {q.handled ? "Reopen" : "Mark handled"}
                    </Button>
                  </div>
                  {q.message && <p className="mt-2 rounded-lg bg-muted/50 p-2.5 text-sm text-muted-foreground">{q.message}</p>}
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function Admin() {
  const { isAuthenticated, isLoading, admin, logout } = useAdminAuth();
  const isMobile = useIsMobile();

  return (
    <div className="min-h-screen">
      <NavBar />
      {isLoading ? (
        <div className="mx-auto mt-16 max-w-sm px-4">
          <Skeleton className="h-48 w-full rounded-xl" />
        </div>
      ) : !isAuthenticated ? (
        <LoginCard />
      ) : (
        <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
          <div className="mb-6 flex items-center justify-between">
            <div>
              <h1 className="text-xl font-bold tracking-tight" style={{ fontFamily: "'General Sans', 'Inter', sans-serif" }}>
                Admin dashboard
              </h1>
              {admin && (
                <p className="mt-0.5 text-sm text-muted-foreground">
                  Signed in as {admin.name || admin.email}
                  {admin.isOwner ? " · Owner" : ""}
                </p>
              )}
            </div>
            <Button variant="ghost" size="sm" onClick={logout} className="gap-1.5" data-testid="button-admin-logout">
              <LogOut className="h-3.5 w-3.5" /> Log out
            </Button>
          </div>

          {isMobile ? (
            <Tabs defaultValue="setup">
              <TabsList className="grid w-full grid-cols-5">
                <TabsTrigger value="setup" data-testid="tab-admin-setup">
                  Setup
                </TabsTrigger>
                <TabsTrigger value="signups" data-testid="tab-admin-signups">
                  Signed up
                </TabsTrigger>
                <TabsTrigger value="sponsors" data-testid="tab-admin-sponsors">
                  Sponsors
                </TabsTrigger>
                <TabsTrigger value="run" data-testid="tab-admin-run">
                  Run
                </TabsTrigger>
                <TabsTrigger value="team" data-testid="tab-admin-team">
                  Team
                </TabsTrigger>
              </TabsList>
              <TabsContent value="setup" className="mt-6 flex flex-col gap-6">
                <EventsManagementCard />
                <EventSettingsCard />
              </TabsContent>
              <TabsContent value="signups" className="mt-6">
                <SignupsCard />
              </TabsContent>
              <TabsContent value="sponsors" className="mt-6">
                <SponsorsCard />
              </TabsContent>
              <TabsContent value="run" className="mt-6">
                <RunOfShow adminGet={adminGet} adminSend={adminSend} />
              </TabsContent>
              <TabsContent value="team" className="mt-6">
                <TeamCard />
              </TabsContent>
            </Tabs>
          ) : (
            <div className="flex flex-col gap-6">
              <RunOfShow adminGet={adminGet} adminSend={adminSend} />
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_400px] lg:items-start">
              <div className="flex flex-col gap-6">
                <EventsManagementCard />
                <EventSettingsCard />
                <SponsorsCard />
                <TeamCard />
              </div>
              <div className="lg:sticky lg:top-6">
                <SignupsCard />
              </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
