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
import { StudioConsole } from "@/components/StudioConsole";
import { TimeZoneSelect } from "@/components/TimeZoneSelect";
import { Download, LogOut, Lock, HeadphonesIcon, Ban, Trash2, Star, Plus, Pencil, ArrowUp, ArrowDown, Eye, EyeOff, ImagePlus, Handshake, Users, KeyRound, PlayCircle, Copy } from "lucide-react";
import type { EventRow, PublicEvent, SignupRow, UpdateEvent, InsertEvent, SponsorRow, AdminUserRow, SponsorInquiryRow, PublicSettings, ShowAssetRow } from "@shared/schema";
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
                    {m.isOwner && <Badge variant="secondary" className="text-[11px]">Owner</Badge>}
                    {admin?.email === m.email && <Badge variant="outline" className="text-[11px]">You</Badge>}
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

function NewEventCard() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const zone = useMemo(detectLocalTimeZone, []);
  const [creating, setCreating] = useState(false);
  const [newForm, setNewForm] = useState<EventFormState>(() => blankEventForm(zone));
  const [saving, setSaving] = useState(false);

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







  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0">
        <div>
          <CardTitle className="text-base">New event</CardTitle>
          <CardDescription>Another marathon, another day, another tenant. It gets its own studio, agenda and sponsors.</CardDescription>
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

      </CardContent>
    </Card>
  );
}

function EventSettingsCard({ eventId }: { eventId: number }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: events } = useQuery<PublicEvent[]>({
    queryKey: ["/api/admin/events"],
    queryFn: () => adminGet<PublicEvent[]>("/api/admin/events"),
  });
  const event = events?.find((e) => e.id === eventId);

  const [zone, setZone] = useState(detectLocalTimeZone);
  const localZone = useMemo(detectLocalTimeZone, []);
  const [form, setForm] = useState<{
    name: string;
    tagline: string;
    description: string;
    occasion: string;
    about: string;
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
        occasion: event.occasion ?? "",
        about: event.about ?? "",
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
        occasion: form.occasion,
        about: form.about,
        startAtUtc: dateTimeLocalToUtc(form.startLocal, zone).toISOString(),
        durationHours: form.durationHours,
        slotMinutes: form.slotMinutes,
        onAirMinutes: form.onAirMinutes,
        bufferMinutes: form.bufferMinutes,
        bufferPosition: form.bufferPosition,
      };
      await adminSend("PUT", `/api/admin/events/${eventId}`, patch);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["/api/admin/events"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/admin/event"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/event"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/events"] }),
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
        <div>
          <Label htmlFor="event-occasion">The day it celebrates</Label>
          <Input
            id="event-occasion"
            value={form.occasion}
            onChange={(e) => setForm({ ...form, occasion: e.target.value })}
            placeholder="National Military Podcast Day"
            data-testid="input-event-occasion"
          />
          <p className="mt-1 text-xs text-muted-foreground">Used on podcasters' social cards, captions and the About page.</p>
        </div>
        <div>
          <Label htmlFor="event-about">About page</Label>
          <Textarea
            id="event-about"
            rows={12}
            value={form.about}
            onChange={(e) => setForm({ ...form, about: e.target.value })}
            placeholder={"## How it started\n\nA paragraph...\n\n## How to take part\n\nAnother paragraph..."}
            data-testid="input-event-about"
          />
          <p className="mt-1 text-xs text-muted-foreground">
            Public at /event/&lt;slug&gt;/about. Blank line between paragraphs; start a line with "## " for a heading.
            Leave empty to show the built-in text.
          </p>
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

function SignupsCard({ eventId }: { eventId: number }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: events } = useQuery<PublicEvent[]>({
    queryKey: ["/api/admin/events"],
    queryFn: () => adminGet<PublicEvent[]>("/api/admin/events"),
  });
  const event = events?.find((e) => e.id === eventId);
  const { data: signups, isLoading } = useQuery<SignupRow[]>({
    queryKey: ["/api/admin/signups", eventId],
    queryFn: () => adminGet<SignupRow[]>(`/api/admin/signups?eventId=${eventId}`),
  });
  // What each podcaster has actually sent us, keyed by email.
  const { data: assets } = useQuery<ShowAssetRow[]>({
    queryKey: ["/api/admin/assets"],
    queryFn: () => adminGet<ShowAssetRow[]>("/api/admin/assets"),
  });
  const assetsByEmail = useMemo(() => {
    const m = new Map<string, ShowAssetRow[]>();
    for (const a of assets ?? []) {
      const k = a.email.toLowerCase();
      m.set(k, [...(m.get(k) ?? []), a]);
    }
    return m;
  }, [assets]);
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
                    className="relative rounded-lg border border-border p-3 lg:grid lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)_minmax(0,1fr)] lg:gap-x-6"
                    data-testid={`row-signup-${s.id}`}
                  >
                  <div className="min-w-0">
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
                      <div className="flex shrink-0 gap-1 lg:absolute lg:right-3 lg:top-3">
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

                    <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 tabular-nums text-xs text-muted-foreground">
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
                    </div>
                  </div>

                    {/* What we're actually holding for them, and what they told us —
                        two more columns on a wide screen, stacked underneath on a phone. */}
                    {(() => {
                      const mats = assetsByEmail.get(s.email.trim().toLowerCase()) ?? [];
                      const promised = [
                        s.hasVideoIntro && "intro",
                        s.hasVideoOutro && "outro",
                        s.hasSlides && "slides",
                        s.hasImages && "images",
                      ].filter(Boolean) as string[];
                      const recordsWith = [s.recordingMode, s.streamPlatform === "other" ? s.streamPlatformOther : s.streamPlatform]
                        .filter((v) => v && v !== "none")
                        .join(" · ");
                      const facts: { label: string; value: string }[] = [
                        { label: "Guests", value: s.guests },
                        { label: "Interview questions", value: s.interviewQuestions },
                        { label: "Promo notes", value: s.promoNotes },
                        { label: "Notes", value: s.notes },
                        { label: "Records with", value: recordsWith },
                      ].filter((f) => f.value && f.value.trim());
                      return (
                        <div className="mt-3 grid gap-3 border-t border-border pt-3 lg:contents">
                          <div className="lg:border-l lg:border-border lg:pl-5">
                            <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-foreground">Materials</div>
                            {s.showFormat === "prerecorded" && (
                              <div className="mt-1 text-xs">
                                {s.recordingUrl ? (
                                  <a href={s.recordingUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-medium text-primary hover:underline">
                                    <PlayCircle className="h-3 w-3" /> Episode to roll
                                  </a>
                                ) : (
                                  <span className="font-medium text-destructive">Pre-recorded but no episode link yet</span>
                                )}
                              </div>
                            )}
                            {mats.length > 0 ? (
                              <div className="mt-1 flex flex-wrap gap-1">
                                {mats.map((a) => (
                                  <a
                                    key={a.id}
                                    href={a.fileUrl || a.linkUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[11px] font-medium hover:border-primary/50"
                                    title={a.label || a.fileName}
                                  >
                                    {a.kind}
                                    {a.label ? ` · ${a.label}` : ""}
                                  </a>
                                ))}
                              </div>
                            ) : (
                              <div className="mt-1 text-xs text-muted-foreground">
                                Nothing uploaded yet{promised.length ? ` — said they'd send: ${promised.join(", ")}` : ""}.
                              </div>
                            )}
                          </div>
                          <div className="lg:border-l lg:border-border lg:pl-5 lg:pr-16">
                            <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-foreground">From them</div>
                            {facts.length === 0 ? (
                              <div className="mt-1 text-xs text-muted-foreground">No guests, questions or notes given.</div>
                            ) : (
                              <dl className="mt-1 space-y-1 text-xs">
                                {facts.map((f) => (
                                  <div key={f.label}>
                                    <dt className="inline font-semibold text-foreground">{f.label}: </dt>
                                    <dd className="inline whitespace-pre-line text-muted-foreground">{f.value}</dd>
                                  </div>
                                ))}
                              </dl>
                            )}
                          </div>
                        </div>
                      );
                    })()}
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
function SponsorsCard({ eventId }: { eventId: number }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: sponsors, isLoading } = useQuery<SponsorRow[]>({
    queryKey: ["/api/admin/sponsors", eventId],
    queryFn: () => adminGet<SponsorRow[]>(`/api/admin/sponsors?eventId=${eventId}`),
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
      fd.append("eventId", String(eventId));
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

// ---------------------------------------------------------------------------
// Events first. Admin is a home for many events; you pick one and get its
// dashboard. Studios, sponsors and the team are shared across all of them.
// ---------------------------------------------------------------------------
function EventPicker({ onOpen }: { onOpen: (id: number) => void }) {
  const { data: events, isLoading } = useQuery<PublicEvent[]>({
    queryKey: ["/api/admin/events"],
    queryFn: () => adminGet<PublicEvent[]>("/api/admin/events"),
  });
  const { data: signups } = useQuery<SignupRow[]>({
    queryKey: ["/api/admin/signups"],
    queryFn: () => adminGet<SignupRow[]>("/api/admin/signups"),
  });
  const zone = useMemo(detectLocalTimeZone, []);
  if (isLoading || !events) return <Skeleton className="h-32 w-full rounded-xl" />;
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {events.map((e) => {
        const start = new Date(e.startAtUtc);
        const booked = (signups ?? []).filter((s) => s.eventId === e.id && s.status !== "cancelled").length;
        const total = Math.floor((e.durationHours * 60) / e.slotMinutes);
        return (
          <button
            key={e.id}
            type="button"
            onClick={() => onOpen(e.id)}
            className="group overflow-hidden rounded-2xl border border-border bg-card text-left transition-colors hover:border-primary/50"
            data-testid={`event-open-${e.id}`}
          >
            <div className="aspect-video bg-[#053877] bg-cover bg-center" style={e.imageUrl ? { backgroundImage: `url(${e.imageUrl}?v=2)` } : undefined} />
            <div className="p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate text-base font-semibold text-card-foreground">{e.name}</div>
                  <div className="text-xs text-muted-foreground">{e.occasion || e.tagline}</div>
                </div>
                {e.isFeatured && <Badge className="shrink-0 bg-[#F0A71F] text-[#1a1200] hover:bg-[#F0A71F]">Live site</Badge>}
              </div>
              <div className="mt-3 text-sm text-muted-foreground">
                {formatDateInZone(start, zone)} · {formatTimeInZone(start, zone)} · {e.durationHours}h
              </div>
              <div className="mt-1 text-sm font-medium text-foreground">{booked} of {total} slots booked</div>
              <div className="mt-3 text-sm font-semibold text-primary group-hover:underline">Open dashboard →</div>
            </div>
          </button>
        );
      })}
    </div>
  );
}

function RoomsPanel({ onOpen }: { onOpen: (id: number) => void }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: studios } = useQuery<(StudioRowLite & { isPrimary: boolean; eventName?: string })[]>({
    queryKey: ["/api/admin/studios", "all"],
    queryFn: () => adminGet("/api/admin/studios?all=1"),
  });
  const { data: events } = useQuery<PublicEvent[]>({
    queryKey: ["/api/admin/events"],
    queryFn: () => adminGet<PublicEvent[]>("/api/admin/events"),
  });
  const [name, setName] = useState("");
  const origin = typeof window === "undefined" ? "https://www.militaryvoice.ai" : window.location.origin;
  // Rooms only. Event studios live inside their event.
  const rooms = (studios ?? []).filter((st) => !st.isPrimary);

  async function create() {
    const featured = events?.find((e) => e.isFeatured) ?? events?.[0];
    if (!featured) return;
    const res = await adminSend("POST", "/api/admin/studios", { eventId: featured.id, name: name.trim() || "Room" });
    const made = (await res.json()) as { id: number };
    setName("");
    await queryClient.invalidateQueries({ queryKey: ["/api/admin/studios"] });
    toast({ title: "Room ready", description: "Send the join link to whoever's joining you." });
    if (made?.id) onOpen(made.id);
  }
  async function remove(id: number) {
    try {
      await adminSend("DELETE", `/api/admin/studios/${id}`);
      queryClient.invalidateQueries({ queryKey: ["/api/admin/studios"] });
    } catch (err) {
      toast({ title: "Can't remove that one", description: (err as Error).message, variant: "destructive" });
    }
  }
  function copy(text: string) {
    navigator.clipboard.writeText(text).then(
      () => toast({ title: "Link copied" }),
      () => toast({ title: "Couldn't copy", variant: "destructive" }),
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Rooms</CardTitle>
        <CardDescription>
          A room is a quick place to meet — a host and a guest, a rehearsal, a chat that doesn't need the full studio —
          with its own join link and green room. No run of show, no broadcast. The event's studio lives inside the event.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {rooms.length === 0 && <p className="text-sm text-muted-foreground">No rooms yet. Make one below.</p>}
        {rooms.map((st) => {
          const join = `${origin}/studio?studioId=${st.id}`;
          return (
            <div key={st.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-border p-3" data-testid={`room-row-${st.id}`}>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-card-foreground">{st.name || "Room"}</span>
                  <Badge variant="outline" className="text-[11px] font-normal">{st.status}</Badge>
                </div>
                <div className="mt-1 truncate font-mono text-xs text-muted-foreground">{join}</div>
              </div>
              <Button size="sm" variant="outline" className="gap-1.5 rounded-full" onClick={() => copy(join)} data-testid={`room-copy-${st.id}`}>
                <Copy className="h-3.5 w-3.5" /> Copy join link
              </Button>
              <Button size="sm" className="rounded-full" onClick={() => onOpen(st.id)} data-testid={`room-open-${st.id}`}>
                Open room
              </Button>
              <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => remove(st.id)} aria-label="Remove room">
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          );
        })}
        <form
          className="mt-1 flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            create();
          }}
        >
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Riccoh + Andrew" className="h-9 max-w-xs" data-testid="input-new-room" />
          <Button type="submit" size="sm" className="gap-1.5 rounded-full" data-testid="button-new-room">
            <Plus className="h-3.5 w-3.5" /> New room
          </Button>
          <span className="text-xs text-muted-foreground">Anyone with the join link lands in the room's green room; you bring them on from inside it.</span>
        </form>
      </CardContent>
    </Card>
  );
}

/** One room, opened. The console without the run of show. */
function RoomView({ roomId, onBack }: { roomId: number; onBack: () => void }) {
  const { data: studios } = useQuery<(StudioRowLite & { isPrimary: boolean })[]>({
    queryKey: ["/api/admin/studios", "all"],
    queryFn: () => adminGet("/api/admin/studios?all=1"),
  });
  const room = studios?.find((s) => s.id === roomId);
  const [view, setView] = useState<"live" | "set">("live");
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <button type="button" onClick={onBack} className="mb-1 inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline" data-testid="button-all-rooms">
            ← All rooms
          </button>
          <h2 className="text-2xl font-bold tracking-tight" style={{ fontFamily: "'General Sans', 'Inter', sans-serif" }}>
            {room?.name || "Room"}
          </h2>
        </div>
        <div className="inline-flex w-fit rounded-full border border-border bg-card p-1">
          {(["live", "set"] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
              className={`rounded-full px-4 py-1.5 text-sm font-semibold ${view === v ? "bg-[#053877] text-white" : "text-foreground"}`}
              data-testid={`room-view-${v}`}
            >
              {v === "live" ? "Room" : "Room set"}
            </button>
          ))}
        </div>
      </div>
      <StudioConsole key={`room-${roomId}-${view}`} adminGet={adminGet} adminSend={adminSend} view={view} kind="room" fixedStudioId={roomId} onLeave={onBack} />
    </div>
  );
}

/** Where you land when you open an event: the numbers, then the tabs. */
function EventOverview({ eventId, event, go }: { eventId: number; event: PublicEvent; go: (tab: string) => void }) {
  const { data: signups } = useQuery<SignupRow[]>({
    queryKey: ["/api/admin/signups", eventId],
    queryFn: () => adminGet<SignupRow[]>(`/api/admin/signups?eventId=${eventId}`),
  });
  const { data: assets } = useQuery<ShowAssetRow[]>({
    queryKey: ["/api/admin/assets"],
    queryFn: () => adminGet<ShowAssetRow[]>("/api/admin/assets"),
  });
  const { data: sponsors } = useQuery<SponsorRow[]>({
    queryKey: ["/api/admin/sponsors", eventId],
    queryFn: () => adminGet<SponsorRow[]>(`/api/admin/sponsors?eventId=${eventId}`),
  });
  const zone = useMemo(detectLocalTimeZone, []);
  const active = (signups ?? []).filter((s) => s.status !== "cancelled");
  const total = Math.floor((event.durationHours * 60) / event.slotMinutes);
  const emailsWithAssets = new Set((assets ?? []).map((a) => a.email.toLowerCase()));
  const withMaterials = active.filter((s) => emailsWithAssets.has(s.email.trim().toLowerCase())).length;
  const prerecorded = active.filter((s) => s.showFormat === "prerecorded").length;
  const needInterviewer = active.filter((s) => s.needsInterviewer).length;
  const start = new Date(event.startAtUtc);
  const daysToGo = Math.max(0, Math.ceil((start.getTime() - Date.now()) / 86400000));

  const tile = (label: string, value: string | number, hint: string, tab?: string) => (
    <button
      type="button"
      onClick={() => tab && go(tab)}
      className={`rounded-2xl border border-border bg-card p-4 text-left ${tab ? "transition-colors hover:border-primary/50" : "cursor-default"}`}
    >
      <div className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">{label}</div>
      <div className="mt-1 text-3xl font-bold tabular-nums text-card-foreground">{value}</div>
      <div className="mt-1 text-xs text-muted-foreground">{hint}</div>
    </button>
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {tile("Days to go", daysToGo, `${formatDateInZone(start, zone)} · ${formatTimeInZone(start, zone)}`)}
        {tile("Slots booked", `${active.length} / ${total}`, `${total - active.length} still open`, "signups")}
        {tile("Sent materials", `${withMaterials} / ${active.length}`, `${prerecorded} pre-recorded · ${needInterviewer} want an interviewer`, "signups")}
        {tile("Sponsors", (sponsors ?? []).length, "Logos in the strip and read on air", "sponsors")}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button className="rounded-full" onClick={() => go("studio")} data-testid="overview-open-studio">Open the studio</Button>
        <Button variant="outline" className="rounded-full" onClick={() => go("run")}>Run of show</Button>
        <Button variant="outline" className="rounded-full" onClick={() => go("setup")}>Event details</Button>
        <Button variant="outline" className="rounded-full" asChild>
          <a href={`/event/${event.slug || "marathon"}/agenda`} target="_blank" rel="noreferrer">Public agenda ↗</a>
        </Button>
      </div>
    </div>
  );
}

type StudioRowLite = { id: number; eventId: number; name: string; status: string };

export default function Admin() {
  const { isAuthenticated, isLoading, admin, logout } = useAdminAuth();
  const isMobile = useIsMobile();
  // Which event's dashboard is open. Remembered so a refresh doesn't bounce
  // you back to the list mid-show.
  const [selectedEventId, setSelectedEventId] = useState<number | null>(() => {
    const v = Number(localStorage.getItem("mv_admin_event"));
    return Number.isFinite(v) && v > 0 ? v : null;
  });
  const pickEvent = (id: number | null) => {
    setSelectedEventId(id);
    if (id) localStorage.setItem("mv_admin_event", String(id));
    else localStorage.removeItem("mv_admin_event");
  };
  const { data: adminEvents } = useQuery<PublicEvent[]>({
    queryKey: ["/api/admin/events"],
    queryFn: () => adminGet<PublicEvent[]>("/api/admin/events"),
    enabled: isAuthenticated,
  });
  const selectedEvent = adminEvents?.find((e) => e.id === selectedEventId) ?? null;
  const [eventTab, setEventTab] = useState("overview");
  const [openRoomId, setOpenRoomId] = useState<number | null>(null);
  const openRoom = (id: number | null) => {
    if (id) {
      localStorage.setItem("mv_admin_studio", String(id));
    }
    setOpenRoomId(id);
  };
  const queryClientTop = useQueryClient();
  const { toast: toastTop } = useToast();
  async function makeLive(id: number) {
    try {
      await adminSend("PUT", `/api/admin/events/${id}`, { isFeatured: true } as UpdateEvent);
      await Promise.all(
        ["/api/admin/events", "/api/admin/event", "/api/event", "/api/events", "/api/signups", "/api/sponsors"].map((k) =>
          queryClientTop.invalidateQueries({ queryKey: [k] }),
        ),
      );
      toastTop({ title: "This is now the live-site event", description: "The homepage, agenda and sponsor strip follow it." });
    } catch (err) {
      toastTop({ title: "Couldn't switch", description: (err as Error).message, variant: "destructive" });
    }
  }

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

          {selectedEventId && selectedEvent ? (
            <>
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <button
                    type="button"
                    onClick={() => pickEvent(null)}
                    className="mb-2 inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
                    data-testid="button-all-events"
                  >
                    ← All events
                  </button>
                  <h2 className="text-2xl font-bold tracking-tight" style={{ fontFamily: "'General Sans', 'Inter', sans-serif" }}>
                    {selectedEvent.name}
                    {selectedEvent.isFeatured && <Badge className="ml-3 bg-[#F0A71F] align-middle text-[#1a1200] hover:bg-[#F0A71F]">Live site</Badge>}
                  </h2>
                </div>
                {!selectedEvent.isFeatured && (
                  <Button variant="outline" size="sm" className="gap-1.5 rounded-full" onClick={() => makeLive(selectedEvent.id)} data-testid="button-make-live">
                    <Star className="h-3.5 w-3.5" /> Make this the live-site event
                  </Button>
                )}
              </div>
              <Tabs value={eventTab} onValueChange={setEventTab}>
                <TabsList className={`grid w-full ${isMobile ? "grid-cols-3" : "grid-cols-6"}`}>
                  <TabsTrigger value="overview" data-testid="tab-admin-overview">Overview</TabsTrigger>
                  <TabsTrigger value="studio" data-testid="tab-admin-studio">Studio</TabsTrigger>
                  <TabsTrigger value="run" data-testid="tab-admin-run">Run of show</TabsTrigger>
                  {!isMobile && (
                    <>
                      <TabsTrigger value="setup" data-testid="tab-admin-setup">Event details</TabsTrigger>
                      <TabsTrigger value="signups" data-testid="tab-admin-signups">Podcasters</TabsTrigger>
                      <TabsTrigger value="sponsors" data-testid="tab-admin-sponsors">Sponsors</TabsTrigger>
                    </>
                  )}
                </TabsList>
                <TabsContent value="overview" className="mt-6">
                  <EventOverview eventId={selectedEventId} event={selectedEvent} go={setEventTab} />
                  {isMobile && (
                    <div className="mt-6 flex flex-col gap-6">
                      <EventSettingsCard eventId={selectedEventId} />
                      <SignupsCard eventId={selectedEventId} />
                      <SponsorsCard eventId={selectedEventId} />
                    </div>
                  )}
                </TabsContent>
                <TabsContent value="studio" className="mt-6">
                  <StudioConsole key={`ev-${selectedEventId}`} adminGet={adminGet} adminSend={adminSend} view="live" eventId={selectedEventId} kind="event" />
                </TabsContent>
                <TabsContent value="run" className="mt-6">
                  <RunOfShow adminGet={adminGet} adminSend={adminSend} eventId={selectedEventId} />
                </TabsContent>
                {!isMobile && (
                  <>
                    <TabsContent value="setup" className="mt-6">
                      <EventSettingsCard eventId={selectedEventId} />
                    </TabsContent>
                    <TabsContent value="signups" className="mt-6">
                      <SignupsCard eventId={selectedEventId} />
                    </TabsContent>
                    <TabsContent value="sponsors" className="mt-6">
                      <SponsorsCard eventId={selectedEventId} />
                    </TabsContent>
                  </>
                )}
              </Tabs>
            </>
          ) : openRoomId ? (
            <RoomView roomId={openRoomId} onBack={() => openRoom(null)} />
          ) : (
            <Tabs defaultValue="events">
              <TabsList className="grid w-full grid-cols-3">
                <TabsTrigger value="events" data-testid="tab-admin-events">Events</TabsTrigger>
                <TabsTrigger value="rooms" data-testid="tab-admin-rooms">Rooms</TabsTrigger>
                <TabsTrigger value="team" data-testid="tab-admin-team">Team</TabsTrigger>
              </TabsList>
              <TabsContent value="events" className="mt-6 flex flex-col gap-8">
                <EventPicker onOpen={(id) => { setEventTab("overview"); pickEvent(id); }} />
                <NewEventCard />
              </TabsContent>
              <TabsContent value="rooms" className="mt-6">
                <RoomsPanel onOpen={openRoom} />
              </TabsContent>
              <TabsContent value="team" className="mt-6">
                <TeamCard />
              </TabsContent>
            </Tabs>
          )}
        </div>
      )}
    </div>
  );
}
