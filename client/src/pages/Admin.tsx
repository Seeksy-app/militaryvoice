import React, { useEffect, useMemo, useState } from "react";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { NavBar } from "@/components/NavBar";
import { LogoLockup } from "@/components/Logo";
import { Link } from "wouter";
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
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { useLocation } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { adminGet, adminSend, adminUpload, adminExportUrl } from "@/lib/adminApi";
import { RunOfShow } from "@/components/RunOfShow";
import { StudioConsole } from "@/components/StudioConsole";
import { RiccohPosts } from "@/components/RiccohPosts";
import { RiccohImages } from "@/components/RiccohImages";
import { RichBody } from "@/components/RichBody";
import type { AudienceSnapshot } from "@/components/AudienceReach";
import { FinancesCard } from "@/components/FinancesCard";
import { AdminClips } from "@/components/AdminClips";
import { AdminNav, EVENT_GROUPS, TOP_GROUPS, EVENT_SECTION_KEYS, TOP_SECTION_KEYS } from "@/components/AdminNav";
import { AudienceFigures } from "@/components/AudienceFigures";
import { TimeZoneSelect } from "@/components/TimeZoneSelect";
import { Download, LogOut, Lock, HeadphonesIcon, Ban, Trash2, Star, Plus, Pencil, DollarSign, ArrowUp, ArrowDown, Eye, EyeOff, ImagePlus, Handshake, Users, KeyRound, PlayCircle, Copy, Mail, Search, Upload, ChevronRight, ArrowLeft, Send, RefreshCw, Youtube, Zap } from "lucide-react";
import { CADENCE, CADENCE_STEPS, cadenceSource } from "@shared/schema";
import { GreenRoomButton } from "@/components/GreenRoomButton";
import type { EventRow, PublicEvent, SignupRow, UpdateEvent, InsertEvent, SponsorRow, SponsorPackageWithSold, AdminUserRow, SponsorInquiryRow, PublicSettings, ShowAssetRow } from "@shared/schema";
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

/** The panel needs the lineup; this is the query the signups card already makes. */
function AudienceFiguresPanel({ eventId }: { eventId: number }) {
  const { data: signups } = useQuery<SignupRow[]>({
    queryKey: ["/api/admin/signups", eventId],
    queryFn: () => adminGet<SignupRow[]>(`/api/admin/signups?eventId=${eventId}`),
  });
  const rows = (signups ?? [])
    .filter((s) => s.status !== "cancelled")
    .map((s) => ({ id: s.id, email: s.email, podcastName: s.podcastName, hostName: s.hostName }));
  if (rows.length === 0) return null;
  return <AudienceFigures signups={rows} />;
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
  // The house address holds the event's own library — episodes uploaded on a
  // podcaster's behalf, pictures for the site — and the two ceremony slots
  // are booked under that same address, so it read as Riccoh's materials.
  // A show's pre-recorded file is attached on the run of show, not here.
  const assetsByEmail = useMemo(() => {
    const m = new Map<string, ShowAssetRow[]>();
    for (const a of assets ?? []) {
      const k = a.email.toLowerCase();
      if (k === "hello@militaryvoice.ai") continue;
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
  const ytConnected = active.filter((s) => (s as { youtubeConnected?: boolean }).youtubeConnected);
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
                          <div className="flex items-center gap-1.5">
                            <span className="truncate text-sm font-medium text-card-foreground">{s.podcastName}</span>
                            <Youtube
                              className={`h-3.5 w-3.5 shrink-0 ${
                                (s as { youtubeConnected?: boolean }).youtubeConnected
                                  ? "text-[#FF0000]"
                                  : "text-muted-foreground/25"
                              }`}
                              aria-label={
                                (s as { youtubeConnected?: boolean }).youtubeConnected
                                  ? `Streaming to ${(s as { youtubeChannelTitle?: string }).youtubeChannelTitle || "their channel"}`
                                  : "No YouTube channel connected"
                              }
                            />
                          </div>
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
// Sponsorship packages — what a tier costs and how many slots it has. "Sold"
// is counted from the sponsors assigned to each package, never stored, so the
// two cannot drift apart.
// ---------------------------------------------------------------------------
const TIER_LABEL: Record<string, string> = {
  presenting: "Presenting — top band",
  official: "Official — logo grid",
  friend: "Friend — scrolling strip",
};

function money(n: number) {
  return n > 0 ? `$${n.toLocaleString("en-US")}` : "—";
}

function SponsorPackagesCard({ eventId }: { eventId: number }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: packages, isLoading } = useQuery<SponsorPackageWithSold[]>({
    queryKey: ["/api/admin/sponsor-packages", eventId],
    queryFn: () => adminGet<SponsorPackageWithSold[]>(`/api/admin/sponsor-packages?eventId=${eventId}`),
  });

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<SponsorPackageWithSold | null>(null);
  const [form, setForm] = useState({ name: "", price: "", totalSlots: "1", tier: "official", description: "", checkoutUrl: "" });
  const [busy, setBusy] = useState(false);

  function refresh() {
    queryClient.invalidateQueries({ queryKey: ["/api/admin/sponsor-packages"] });
    queryClient.invalidateQueries({ queryKey: ["/api/admin/sponsors"] });
  }

  function startAdd() {
    setEditing(null);
    setForm({ name: "", price: "", totalSlots: "1", tier: "official", description: "", checkoutUrl: "" });
    setOpen(true);
  }

  function startEdit(p: SponsorPackageWithSold) {
    setEditing(p);
    setForm({ name: p.name, price: String(p.price || ""), totalSlots: String(p.totalSlots), tier: p.tier, description: p.description, checkoutUrl: (p as { checkoutUrl?: string }).checkoutUrl ?? "" });
    setOpen(true);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) {
      toast({ title: "Give the package a name", variant: "destructive" });
      return;
    }
    setBusy(true);
    try {
      const body = {
        name: form.name.trim(),
        price: Number(form.price) || 0,
        totalSlots: Math.max(1, Number(form.totalSlots) || 1),
        tier: form.tier,
        description: form.description.trim(),
        checkoutUrl: form.checkoutUrl.trim(),
        eventId,
      };
      if (editing) await adminSend("PATCH", `/api/admin/sponsor-packages/${editing.id}`, body);
      else await adminSend("POST", "/api/admin/sponsor-packages", body);
      setOpen(false);
      refresh();
      toast({ title: editing ? "Package updated" : "Package added" });
    } catch (err) {
      toast({ title: "Couldn't save the package", description: (err as Error).message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  async function remove(p: SponsorPackageWithSold) {
    if (!window.confirm(`Delete "${p.name}"? Sponsors on it stay on the site, just unassigned.`)) return;
    await adminSend("DELETE", `/api/admin/sponsor-packages/${p.id}`);
    refresh();
    toast({ title: "Package deleted" });
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <DollarSign className="h-4 w-4 text-primary" /> Sponsorship packages
            </CardTitle>
            <CardDescription>Tiers, pricing, and how many slots are left.</CardDescription>
          </div>
          <Button size="sm" variant="outline" className="gap-1.5" onClick={startAdd} data-testid="button-add-package">
            <Plus className="h-4 w-4" /> Add package
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : (packages ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No packages yet. Add one to track what each tier costs and how many slots remain.
          </p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {(packages ?? []).map((p) => {
              const left = Math.max(0, p.totalSlots - p.sold);
              return (
                <div key={p.id} className="group relative rounded-xl border border-border p-4" data-testid={`card-package-${p.id}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold">{p.name}</div>
                      <div className="mt-1 text-2xl font-bold tabular-nums text-primary">{money(p.price)}</div>
                    </div>
                    <div className="flex shrink-0 gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => startEdit(p)} aria-label="Edit package">
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => remove(p)} aria-label="Delete package">
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                  <div className="mt-2 text-xs tabular-nums text-muted-foreground">
                    {left} of {p.totalSlots} available{p.sold > 0 ? ` · ${p.sold} sold` : ""}
                  </div>
                  <div className="mt-1 text-[11px] uppercase tracking-wide text-muted-foreground">{TIER_LABEL[p.tier] ?? p.tier}</div>
                  {p.description && <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">{p.description}</p>}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit package" : "Add package"}</DialogTitle>
            <DialogDescription>Pricing and slots are shown in admin only — the public site shows logos by tier.</DialogDescription>
          </DialogHeader>
          <form onSubmit={save} className="flex flex-col gap-3">
            <div>
              <Label htmlFor="pkg-name" className="text-xs">Name</Label>
              <Input id="pkg-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Presenting sponsor" className="mt-1" data-testid="input-package-name" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="pkg-price" className="text-xs">Price (USD)</Label>
                <Input id="pkg-price" inputMode="numeric" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value.replace(/[^0-9]/g, "") })} placeholder="25000" className="mt-1" data-testid="input-package-price" />
              </div>
              <div>
                <Label htmlFor="pkg-slots" className="text-xs">Total slots</Label>
                <Input id="pkg-slots" inputMode="numeric" value={form.totalSlots} onChange={(e) => setForm({ ...form, totalSlots: e.target.value.replace(/[^0-9]/g, "") })} className="mt-1" data-testid="input-package-slots" />
              </div>
            </div>
            <div>
              <Label className="text-xs">Where the logo shows</Label>
              <Select value={form.tier} onValueChange={(v) => setForm({ ...form, tier: v })}>
                <SelectTrigger className="mt-1" data-testid="select-package-tier">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(TIER_LABEL).map(([v, label]) => (
                    <SelectItem key={v} value={v}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="pkg-desc" className="text-xs">Description (optional)</Label>
              <Input id="pkg-desc" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="What the sponsor gets" className="mt-1" />
            </div>
            <div>
              {/* Handed over once an enquiry is in, never listed publicly —
                  the point of the form is knowing who is buying. */}
              <Label htmlFor="pkg-checkout" className="text-xs">Payment link</Label>
              <Input
                id="pkg-checkout"
                value={form.checkoutUrl}
                onChange={(e) => setForm({ ...form, checkoutUrl: e.target.value })}
                placeholder="https://checkout.seeksy.io/b/…"
                className="mt-1"
                data-testid="input-package-checkout"
              />
              <p className="mt-1 text-[11px] text-muted-foreground">
                Shown to them the moment they submit, and in their thank-you email. Leave it blank and they just get a
                reply from Riccoh.
              </p>
            </div>
            <div className="mt-1 flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={busy} data-testid="button-save-package">{busy ? "Saving…" : editing ? "Save" : "Create"}</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

/**
 * The email as it will arrive.
 *
 * Rendered server-side by the same function the send path uses and shown in an
 * iframe, because the email's HTML carries its own styles and would otherwise
 * inherit the admin page's. Debounced: it re-renders while someone types, and
 * a request per keystroke is a request per keystroke.
 */
function EmailPreview({ subject, bodyText, sender, banner }: {
  subject: string;
  bodyText: string;
  sender: string;
  banner: string;
}) {
  const [open, setOpen] = useState(false);
  const [html, setHtml] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    const t = window.setTimeout(async () => {
      try {
        const res = await adminSend("POST", "/api/admin/broadcasts/preview", { subject, bodyText, sender, banner });
        const text = await res.text();
        if (!cancelled) setHtml(text);
      } catch {
        if (!cancelled) setHtml("<p style='font-family:sans-serif;padding:24px;'>Couldn't render the preview.</p>");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 600);
    return () => { cancelled = true; window.clearTimeout(t); };
  }, [open, subject, bodyText, sender, banner]);

  return (
    <div className="rounded-xl border border-border">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left text-sm font-medium hover-elevate"
        data-testid="button-toggle-preview"
      >
        <span className="flex items-center gap-2">
          <Eye className="h-4 w-4 text-primary" /> Preview
          <span className="text-xs font-normal text-muted-foreground">
            exactly how it arrives, with {"{{First_Name}}"} filled in
          </span>
        </span>
        <ChevronRight className={`h-4 w-4 text-muted-foreground transition-transform ${open ? "rotate-90" : ""}`} />
      </button>
      {open && (
        <div className="border-t border-border bg-muted/30 p-3">
          {loading && !html ? (
            <Skeleton className="h-[480px] w-full rounded-lg" />
          ) : (
            <iframe
              title="Email preview"
              srcDoc={html}
              sandbox=""
              className="h-[560px] w-full rounded-lg border border-border bg-white"
              data-testid="iframe-email-preview"
            />
          )}
        </div>
      )}
    </div>
  );
}

/**
 * The actual people behind a "Send to 84".
 *
 * A recipient count is a number you have to take on trust, and the one segment
 * where trust is not enough is `not-signed-up` — the whole point of it is who
 * it *excludes*, and that is invisible in a total. Opening the list lets
 * whoever presses send confirm the seventeen holding slots really aren't in it.
 */
function SegmentPreview({ segment, eventId, label, onClose }: {
  segment: string | null;
  eventId: number;
  label: string;
  onClose: () => void;
}) {
  const { data, isLoading } = useQuery<{ count: number; people: { email: string; firstName: string }[] }>({
    queryKey: ["/api/admin/segment-preview", segment, eventId],
    queryFn: () => adminGet(`/api/admin/segment-preview?segment=${encodeURIComponent(segment!)}&eventId=${eventId}`),
    enabled: !!segment,
  });
  if (!segment) return null;

  return (
    <div className="rounded-xl border-2 border-primary bg-primary/5 p-4" data-testid="panel-segment-preview">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold">
          {label}
          {data ? ` — ${data.count} ${data.count === 1 ? "person" : "people"}` : ""}
        </p>
        <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={onClose}>Close</Button>
      </div>
      {isLoading ? (
        <p className="mt-2 text-sm text-muted-foreground">Working out who's in this…</p>
      ) : !data?.people.length ? (
        <p className="mt-2 text-sm text-muted-foreground">Nobody is in this segment right now.</p>
      ) : (
        <div className="mt-3 max-h-64 overflow-y-auto rounded-lg border border-border bg-background">
          <table className="w-full text-sm">
            <tbody>
              {data.people.map((p) => (
                <tr key={p.email} className="border-b border-border last:border-0">
                  <td className="px-3 py-1.5 font-medium text-card-foreground">{p.firstName || "—"}</td>
                  <td className="px-3 py-1.5 text-muted-foreground">{p.email}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data && data.count > data.people.length && (
        <p className="mt-2 text-xs text-muted-foreground">Showing the first {data.people.length} of {data.count}.</p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Audience reach — the figure the sponsor pages quote
// ---------------------------------------------------------------------------

/**
 * Recompute what the lineup reaches, and say plainly what was left out.
 *
 * This costs an Upload-Post call per connected podcaster, so it is a button
 * rather than something that happens on its own. The drop counts are shown
 * next to the total on purpose: a figure that went up because the sanitiser
 * stopped rejecting a bad feed is a different thing from one that went up
 * because another host joined, and only the counts tell them apart.
 */
function AudienceSnapshotPanel({ eventId }: { eventId: number }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const { data } = useQuery<{ snapshot: AudienceSnapshot | null; windowDays: number }>({
    queryKey: ["/api/admin/reach"],
    queryFn: () => adminGet<{ snapshot: AudienceSnapshot | null; windowDays: number }>("/api/admin/reach"),
  });
  const snap = data?.snapshot ?? null;

  async function refreshNow() {
    setBusy(true);
    try {
      const res = await adminSend("POST", "/api/admin/reach/refresh", { eventId });
      const next = (await res.json()) as AudienceSnapshot;
      queryClient.invalidateQueries({ queryKey: ["/api/admin/reach"] });
      queryClient.invalidateQueries({ queryKey: ["/api/audience/summary"] });
      toast({
        title: `${next.followers.toLocaleString()} combined following`,
        description: `${next.channels} channels across ${next.shows} shows. Live on the sponsor pages now.`,
      });
    } catch (err) {
      toast({ title: "Couldn't refresh the figures", description: (err as Error).message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-border bg-muted/30 p-4" data-testid="panel-audience-snapshot">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-sm font-medium">What the lineup reaches</div>
          <div className="text-xs text-muted-foreground">
            Shown on /sponsor and /vfw. Read from each host's own connected accounts — no names or per-show figures
            leave the server.
          </div>
        </div>
        <Button size="sm" variant="outline" onClick={refreshNow} disabled={busy} data-testid="button-audience-refresh">
          <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${busy ? "animate-spin" : ""}`} />
          {busy ? "Reading accounts…" : "Refresh"}
        </Button>
      </div>

      {snap ? (
        <div className="mt-3 flex flex-wrap items-baseline gap-x-6 gap-y-1 text-sm">
          <span>
            <span className="text-lg font-bold tabular-nums">{snap.followers.toLocaleString()}</span>{" "}
            <span className="text-muted-foreground">combined following</span>
          </span>
          <span className="text-muted-foreground">
            {snap.channels} channels · {snap.shows} of {snap.showsTotal} shows
          </span>
          <span className="text-muted-foreground">
            {snap.impressions.toLocaleString()} impressions · {snap.reach.toLocaleString()} reached
          </span>
          <span className="text-xs text-muted-foreground">
            {snap.dropped > 0 ? `${snap.dropped} left out as implausible · ` : ""}
            {snap.unavailable > 0 ? `${snap.unavailable} wouldn't report · ` : ""}
            as of {new Date(snap.generatedAt).toLocaleDateString()}
          </span>
        </div>
      ) : (
        <p className="mt-3 text-sm text-muted-foreground">
          Nothing pulled yet — the sponsor pages leave the section out entirely until there is a figure to show.
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sponsors — logos on the homepage, split across the three tiers
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
  const [tier, setTier] = useState("friend");
  const [logo, setLogo] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const { data: packages } = useQuery<SponsorPackageWithSold[]>({
    queryKey: ["/api/admin/sponsor-packages", eventId],
    queryFn: () => adminGet<SponsorPackageWithSold[]>(`/api/admin/sponsor-packages?eventId=${eventId}`),
  });

  function refresh() {
    queryClient.invalidateQueries({ queryKey: ["/api/admin/sponsors"] });
    queryClient.invalidateQueries({ queryKey: ["/api/sponsors"] });
    queryClient.invalidateQueries({ queryKey: ["/api/admin/sponsor-packages"] });
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
      fd.append("tier", tier);
      fd.append("logo", logo);
      await adminUpload("/api/admin/sponsors", fd);
      setName("");
      setUrl("");
      setTier("friend");
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

  async function patch(id: number, body: Partial<Pick<SponsorRow, "name" | "url" | "active" | "sortOrder" | "tier" | "packageId">>) {
    await adminSend("PATCH", `/api/admin/sponsors/${id}`, body);
    refresh();
  }

  /** Assigning a package also moves the logo to that package's tier. */
  async function assignPackage(sp: SponsorRow, packageId: number) {
    const pkg = (packages ?? []).find((p) => p.id === packageId);
    await patch(sp.id, { packageId, ...(pkg ? { tier: pkg.tier } : {}) });
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
          <Handshake className="h-4 w-4 text-primary" /> Friends of the Marathon
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
        <AudienceSnapshotPanel eventId={eventId} />
        <form onSubmit={handleAdd} className="grid gap-3 rounded-xl border border-dashed border-border bg-muted/30 p-4 sm:grid-cols-[auto_1fr_1fr_auto_auto] sm:items-end">
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
          <div>
            <Label className="text-xs">Tier</Label>
            <Select value={tier} onValueChange={setTier}>
              <SelectTrigger className="mt-1 w-full sm:w-[170px]" data-testid="select-sponsor-tier">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="presenting">Presenting</SelectItem>
                <SelectItem value="official">Official</SelectItem>
                <SelectItem value="friend">Friend</SelectItem>
              </SelectContent>
            </Select>
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
                <div className="flex items-center gap-2">
                  <Select value={sp.tier || "friend"} onValueChange={(v) => patch(sp.id, { tier: v })}>
                    <SelectTrigger className="h-8 w-[126px] text-xs" data-testid={`select-tier-${sp.id}`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="presenting">Presenting</SelectItem>
                      <SelectItem value="official">Official</SelectItem>
                      <SelectItem value="friend">Friend</SelectItem>
                    </SelectContent>
                  </Select>
                  <Select value={String(sp.packageId || 0)} onValueChange={(v) => assignPackage(sp, Number(v))}>
                    <SelectTrigger className="h-8 w-[150px] text-xs" data-testid={`select-package-${sp.id}`}>
                      <SelectValue placeholder="No package" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="0">No package</SelectItem>
                      {(packages ?? []).map((p) => (
                        <SelectItem key={p.id} value={String(p.id)}>
                          {p.name} — {money(p.price)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
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
                        {q.title && <span className="ml-1.5 font-normal text-muted-foreground">· {q.title}</span>}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        <a href={`mailto:${q.email}`} className="text-primary hover:underline">
                          {q.email}
                        </a>
                        {q.phone ? ` · ${q.phone}` : ""} · {new Date(q.createdAt).toLocaleDateString()}
                      </div>
                      {/* The first thing you want before picking up the phone:
                          whether they arrived with a tier in mind or want to be
                          talked through it. Those are different calls. */}
                      <div className="mt-1.5">
                        {(q as { packageName?: string }).packageName ? (
                          <Badge variant="secondary" className="text-[11px]">
                            {(q as { packageName?: string }).packageName}
                          </Badge>
                        ) : (
                          <span className="text-[11px] text-muted-foreground">No package picked</span>
                        )}
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
                {e.isFeatured && e.visible !== false && (
                  <Badge className="shrink-0 bg-[#F0A71F] text-[#1a1200] hover:bg-[#F0A71F]">Live site</Badge>
                )}
                {e.visible === false && (
                  <Badge variant="outline" className="shrink-0 gap-1 border-dashed text-muted-foreground" data-testid={`badge-hidden-${e.id}`}>
                    <EyeOff className="h-3 w-3" /> Hidden
                  </Badge>
                )}
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
        {/* A booking parked past the end of the day (the organisers' own,
            for seeing the dashboard as a podcaster) is not one of the slots. */}
        {tile("Slots booked", `${active.filter((s) => s.slotIndex < total).length} / ${total}`, `${Math.max(0, total - active.filter((s) => s.slotIndex < total).length)} still open`, "signups")}
        {tile("Sent materials", `${withMaterials} / ${active.filter((s) => s.slotIndex < total).length}`, `${prerecorded} pre-recorded · ${needInterviewer} want an interviewer`, "signups")}
        {tile("Sponsors", (sponsors ?? []).length, "Logos in the strip and read on air", "sponsors")}
      </div>
      <div className="flex flex-wrap gap-2">
        <GreenRoomButton label="Open the studio" onClick={() => go("studio")} testId="overview-open-studio" />
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

// ---------------------------------------------------------------------------
// CRM panel
// ---------------------------------------------------------------------------

type ContactRow = { id: number; email: string; firstName: string; lastName: string; source: string; status: string; lifecycleStage: string; lastEngagedAt: string; importedAt: string };
type SegmentRow = { id: number; eventId: number | null; name: string; filterJson: string; createdAt: string };
type SendRow = { id: number; broadcastId: number; email: string; resendId: string; sentAt: string };
type BroadcastEventRow = { id: number; resendId: string; eventType: string; occurredAt: string; url: string };
type ContactImport = { id: number; importedByEmail: string; inserted: number; updated: number; total: number; importedAt: string };
type SignupSummary = { id: number; podcastName: string; hostName: string; email: string; phone: string; slotIndex: number; branch: string; serviceStatus: string; socialLinks: string };
type EngagementRecipient = { email: string; firstName: string; lastName: string };

const LIFECYCLE_LABELS: Record<string, string> = { lead: "Lead", engaged: "Engaged", signed_up: "Signed Up", no_show: "No Show", alumni: "Alumni" };
const LIFECYCLE_COLORS: Record<string, string> = {
  lead: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
  engaged: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  signed_up: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300",
  no_show: "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300",
  alumni: "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300",
};
type BroadcastRow = { id: number; eventId: number | null; subject: string; bodyText: string; segment: string; sender: string | null; banner: string | null; status: string; recipientCount: number | null; sentAt: string | null; scheduledFor: string | null; source: string; isTemplate?: boolean; createdAt: string };

// ---------------------------------------------------------------------------
// Shared broadcast compose + list (used by both CrmPanel and CrmEventPanel)
// ---------------------------------------------------------------------------

const SEGMENT_LABELS: Record<string, string> = {
  signups: "Signed-up podcasters",
  contacts: "Imported contacts",
  all: "Both (signed up + imported)",
  "not-signed-up": "On the list, no slot yet",
  "no-audience-link": "Booked, but no social link on file",
  "one-off": "Hand-picked",
};

/** The automatic emails, by the key they are filed under in `nudges`. */
const NUDGE_LABELS: Record<string, string> = {
  confirmation: "Booking confirmation",
  prep: "Prep nudge (2 weeks out)",
  final: "Final nudge (2 days out)",
  onair: "On-air nudge (1 hour out)",
};

/**
 * One email, exactly as it arrived.
 *
 * A campaign renders from its stored body; an automatic email has none, so
 * the server renders it for the most recent booking instead. Either way the
 * admin sees the thing that went out rather than the text it was built from.
 */
function EmailPreviewDialog({ target, onClose }: {
  target: { broadcastId?: number; cadence?: string; title: string } | null;
  onClose: () => void;
}) {
  const [html, setHtml] = useState("");
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!target) return;
    let cancelled = false;
    setHtml("");
    setFailed(false);
    const q = target.broadcastId ? `broadcastId=${target.broadcastId}` : `cadence=${encodeURIComponent(target.cadence ?? "")}`;
    adminSend("GET", `/api/admin/email-preview?${q}`)
      .then((r) => r.text())
      .then((t) => { if (!cancelled) setHtml(t); })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [target?.broadcastId, target?.cadence]);

  return (
    <Dialog open={!!target} onOpenChange={(o) => { if (!o) onClose(); }}>
      {/* stopPropagation: the contact drawer closes on any click that reaches
          it, and a portal's clicks still bubble through the React tree. */}
      <DialogContent className="max-w-2xl p-0" onClick={(e) => e.stopPropagation()} data-testid="dialog-email-preview">
        <DialogHeader className="px-5 pt-5">
          <DialogTitle className="truncate pr-6 text-base">{target?.title}</DialogTitle>
          <DialogDescription className="text-xs">As it arrives, with a real booking's details filled in.</DialogDescription>
        </DialogHeader>
        <div className="border-t border-border bg-muted/30 p-3">
          {failed ? (
            <p className="p-6 text-center text-sm text-muted-foreground">Couldn't render this one.</p>
          ) : !html ? (
            <Skeleton className="h-[60vh] w-full rounded-lg" />
          ) : (
            <iframe title="Email preview" srcDoc={html} sandbox="" className="h-[60vh] w-full rounded-lg border border-border bg-white" />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function BroadcastsSection({
  eventId,
  signupCount,
  contactCount,
}: {
  eventId?: number;
  signupCount?: number;
  contactCount: number;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const qKey = eventId ? ["/api/admin/broadcasts", eventId] : ["/api/admin/broadcasts"];
  const { data: broadcastList = [], isLoading } = useQuery<BroadcastRow[]>({
    queryKey: qKey,
    queryFn: () => adminGet<BroadcastRow[]>(`/api/admin/broadcasts${eventId ? `?eventId=${eventId}` : ""}`),
  });

  const [composing, setComposing] = useState<BroadcastRow | null | "new">(null);
  const [bSubject, setBSubject] = useState("");
  const [bBody, setBBody] = useState("");
  const [bSegment, setBSegment] = useState<"signups" | "contacts" | "all">(eventId ? "signups" : "contacts");
  const [bBusy, setBBusy] = useState(false);

  function startNew() { setComposing("new"); setBSubject(""); setBBody(""); setBSegment(eventId ? "signups" : "contacts"); }
  function startEdit(b: BroadcastRow) { setComposing(b); setBSubject(b.subject); setBBody(b.bodyText); setBSegment(b.segment as "signups" | "contacts" | "all"); }

  async function saveDraft(e: React.FormEvent) {
    e.preventDefault();
    if (!bSubject.trim() || !bBody.trim()) return;
    setBBusy(true);
    try {
      if (composing === "new") {
        await adminSend("POST", "/api/admin/broadcasts", { subject: bSubject.trim(), bodyText: bBody.trim(), eventId: eventId ?? null, segment: bSegment });
      } else if (composing) {
        await adminSend("PUT", `/api/admin/broadcasts/${composing.id}`, { subject: bSubject.trim(), bodyText: bBody.trim(), segment: bSegment });
      }
      queryClient.invalidateQueries({ queryKey: qKey });
      setComposing(null);
      toast({ title: "Draft saved" });
    } catch (err) {
      toast({ title: "Save failed", description: (err as Error).message, variant: "destructive" });
    } finally {
      setBBusy(false);
    }
  }

  function recipientPreview(seg: string): number {
    if (seg === "signups") return signupCount ?? 0;
    if (seg === "contacts") return contactCount;
    return (signupCount ?? 0) + contactCount;
  }

  async function sendBroadcast(b: BroadcastRow) {
    const count = recipientPreview(b.segment);
    if (!window.confirm(`Send "${b.subject}" to ${count} ${SEGMENT_LABELS[b.segment] ?? b.segment}? This cannot be undone.`)) return;
    setBBusy(true);
    try {
      const url = `/api/admin/broadcasts/${b.id}/send${eventId ? `?eventId=${eventId}` : ""}`;
      const result: { sent: number; failed: number } = await adminSend("POST", url).then((r) => r.json());
      toast({ title: "Sent", description: `${result.sent} delivered, ${result.failed} failed.` });
      queryClient.invalidateQueries({ queryKey: qKey });
    } catch (err) {
      toast({ title: "Send failed", description: (err as Error).message, variant: "destructive" });
    } finally {
      setBBusy(false);
    }
  }

  async function deleteBroadcast(id: number) {
    if (!window.confirm("Delete this draft?")) return;
    await adminSend("DELETE", `/api/admin/broadcasts/${id}`);
    queryClient.invalidateQueries({ queryKey: qKey });
  }

  return (
    <div className="flex flex-col gap-4">
      {composing !== null ? (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">{composing === "new" ? "New broadcast" : "Edit draft"}</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={saveDraft} className="flex flex-col gap-3">
              <div>
                <Label>Subject</Label>
                <Input value={bSubject} onChange={(e) => setBSubject(e.target.value)} placeholder="Podcast Marathon starts Saturday!" />
              </div>
              {eventId && (
                <div>
                  <Label>Send to</Label>
                  <Select value={bSegment} onValueChange={(v) => setBSegment(v as "signups" | "contacts" | "all")}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="signups">Signed-up podcasters ({signupCount ?? 0})</SelectItem>
                      <SelectItem value="contacts">Imported contacts ({contactCount})</SelectItem>
                      <SelectItem value="all">Both — {(signupCount ?? 0) + contactCount} total</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div>
                <Label>Body (plain text)</Label>
                <Textarea
                  rows={10}
                  value={bBody}
                  onChange={(e) => setBBody(e.target.value)}
                  placeholder={"Hi there,\n\nThe Military Podcast Marathon is coming up..."}
                />
                <p className="mt-1 text-xs text-muted-foreground">Paragraphs separated by a blank line. An unsubscribe link is added automatically.</p>
              </div>
              <div className="flex gap-2">
                <Button type="submit" disabled={bBusy || !bSubject.trim() || !bBody.trim()}>Save draft</Button>
                <Button type="button" variant="outline" onClick={() => setComposing(null)}>Cancel</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      ) : (
        <Button className="self-start gap-1.5" onClick={startNew}>
          <Plus className="h-4 w-4" /> New broadcast
        </Button>
      )}

      {isLoading ? (
        <div className="flex flex-col gap-2">{[1, 2].map((i) => <Skeleton key={i} className="h-14" />)}</div>
      ) : broadcastList.length === 0 ? (
        <p className="text-sm text-muted-foreground">No broadcasts yet.</p>
      ) : (
        <Card>
          <CardContent className="p-0 divide-y">
            {broadcastList.map((b) => (
              <div key={b.id} className="flex items-start justify-between gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-sm truncate">{b.subject}</p>
                  <p className="text-xs text-muted-foreground">
                    {b.status === "sent"
                      ? `Sent ${b.sentAt ? new Date(b.sentAt).toLocaleDateString() : ""} · ${b.recipientCount} recipients`
                      : b.status === "scheduled" && b.scheduledFor
                      ? `Scheduled for ${new Date(b.scheduledFor).toLocaleString()} · ${SEGMENT_LABELS[b.segment] ?? b.segment}`
                      : `Draft · ${SEGMENT_LABELS[b.segment] ?? b.segment} · ${new Date(b.createdAt).toLocaleDateString()}`}
                  </p>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {(b.status === "draft" || b.status === "scheduled") && !b.source.startsWith("cadence:") && (
                    <>
                      <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => startEdit(b)}>Edit</Button>
                      {b.status === "draft" && (
                        <Button
                          size="sm"
                          className="h-7 text-xs"
                          disabled={bBusy || recipientPreview(b.segment) === 0}
                          onClick={() => sendBroadcast(b)}
                        >
                          Send to {recipientPreview(b.segment)}
                        </Button>
                      )}
                      <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => deleteBroadcast(b.id)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </>
                  )}
                  {b.status === "sent" && !b.source.startsWith("cadence:") && <Badge className="text-[11px]">Sent</Badge>}
                  {b.status === "sent" && b.source.startsWith("cadence:") && <Badge variant="secondary" className="text-[11px]">Auto · {b.recipientCount}</Badge>}
                  {b.status === "scheduled" && <Badge variant="outline" className="text-[11px] border-amber-400 text-amber-600 dark:text-amber-400">Scheduled</Badge>}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Global CRM tab — contacts only (import + manage list)
// ---------------------------------------------------------------------------

function CrmPanel() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: contactList = [], isLoading: loadingContacts } = useQuery<ContactRow[]>({
    queryKey: ["/api/admin/contacts"],
    queryFn: () => adminGet<ContactRow[]>("/api/admin/contacts"),
  });
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);

  async function importCsv(e: React.FormEvent) {
    e.preventDefault();
    if (!csvFile) return;
    setImporting(true);
    try {
      const csvText = await csvFile.text();
      const result: { inserted: number; updated: number; total: number } = await adminSend("POST", "/api/admin/contacts/import", { csv: csvText }).then((r) => r.json());
      toast({ title: "Imported", description: `${result.inserted} new, ${result.updated} updated of ${result.total} rows.` });
      setCsvFile(null);
      queryClient.invalidateQueries({ queryKey: ["/api/admin/contacts"] });
    } catch (err) {
      toast({ title: "Import failed", description: (err as Error).message, variant: "destructive" });
    } finally {
      setImporting(false);
    }
  }

  async function deleteContact(id: number, email: string) {
    if (!window.confirm(`Remove ${email}?`)) return;
    await adminSend("DELETE", `/api/admin/contacts/${id}`);
    queryClient.invalidateQueries({ queryKey: ["/api/admin/contacts"] });
  }

  const activeCount = contactList.filter((c) => c.status === "active").length;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-lg font-semibold">Contacts</h2>
        <p className="text-sm text-muted-foreground">{activeCount} active · use event CRM to compose and send emails</p>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Import from CSV</CardTitle>
          <CardDescription>Select a CSV file with at minimum an <code>email</code> column. Optional: <code>first_name</code>, <code>last_name</code>.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={importCsv} className="flex items-center gap-3 flex-wrap">
            <label className="flex items-center gap-2 cursor-pointer border rounded-md px-3 py-2 text-sm hover:bg-accent transition-colors">
              <Upload className="h-4 w-4" />
              {csvFile ? csvFile.name : "Choose CSV file"}
              <input type="file" accept=".csv,text/csv" className="sr-only" onChange={(e) => setCsvFile(e.target.files?.[0] ?? null)} />
            </label>
            {csvFile && (
              <Button type="submit" disabled={importing} className="gap-1.5">
                <Upload className="h-4 w-4" /> Import {csvFile.name}
              </Button>
            )}
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">All contacts ({contactList.length})</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {loadingContacts ? (
            <div className="p-4 flex flex-col gap-2">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-9" />)}</div>
          ) : contactList.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">No contacts yet — import a CSV above.</p>
          ) : (
            <div className="divide-y">
              {contactList.map((c) => (
                <div key={c.id} className="flex items-center justify-between gap-2 px-4 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{c.email}</p>
                    {(c.firstName || c.lastName) && (
                      <p className="text-xs text-muted-foreground">{[c.firstName, c.lastName].filter(Boolean).join(" ")}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Badge variant={c.status === "active" ? "default" : "secondary"} className="text-[11px]">{c.status}</Badge>
                    <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => deleteContact(c.id, c.email)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// EventTeamPanel — team management for an event
// ---------------------------------------------------------------------------

type TeamMember = { id: number; eventId: number; name: string; title: string; email: string; photoUrl: string; createdAt: string };

const RICCOH_DEFAULT: Omit<TeamMember, "id" | "eventId" | "createdAt"> = {
  name: "Riccoh Player",
  title: "Host",
  email: "riccoh.player@drphil.tv",
  photoUrl: "/riccoh-player.jpg",
};

const PRESET_TITLES = ["Host", "Co-Host", "Producer", "Digital Content", "Custom…"];

function EventTeamPanel({ eventId }: { eventId: number }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: members = [], isLoading } = useQuery<TeamMember[]>({
    queryKey: ["/api/admin/events", eventId, "team"],
    queryFn: () => adminGet<TeamMember[]>(`/api/admin/events/${eventId}/team`),
  });

  // Auto-seed Riccoh if team is empty
  const seeded = React.useRef(false);
  React.useEffect(() => {
    if (!isLoading && members.length === 0 && !seeded.current) {
      seeded.current = true;
      adminSend("POST", `/api/admin/events/${eventId}/team`, {
        name: RICCOH_DEFAULT.name,
        title: RICCOH_DEFAULT.title,
        email: RICCOH_DEFAULT.email,
        photoUrl: RICCOH_DEFAULT.photoUrl,
      }).then(() => queryClient.invalidateQueries({ queryKey: ["/api/admin/events", eventId, "team"] })).catch(() => {});
    }
  }, [isLoading, members.length, eventId, queryClient]);

  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteName, setInviteName] = useState("");
  const [inviteTitle, setInviteTitle] = useState("Host");
  const [inviteCustomTitle, setInviteCustomTitle] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteBusy, setInviteBusy] = useState(false);

  // Per-member editing state
  const [editing, setEditing] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [editTitle, setEditTitle] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editBusy, setEditBusy] = useState(false);

  function startEdit(m: TeamMember) { setEditing(m.id); setEditName(m.name); setEditTitle(m.title); setEditEmail(m.email); }
  function cancelEdit() { setEditing(null); }

  async function saveEdit(id: number) {
    setEditBusy(true);
    try {
      await adminSend("PUT", `/api/admin/events/${eventId}/team/${id}`, { name: editName.trim(), title: editTitle.trim(), email: editEmail.trim() });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/events", eventId, "team"] });
      setEditing(null);
    } catch (err) {
      toast({ title: "Save failed", description: (err as Error).message, variant: "destructive" });
    } finally { setEditBusy(false); }
  }

  async function uploadPhoto(id: number, file: File) {
    const fd = new FormData();
    fd.append("photo", file);
    await adminUpload(`/api/admin/events/${eventId}/team/${id}/photo`, fd);
    queryClient.invalidateQueries({ queryKey: ["/api/admin/events", eventId, "team"] });
  }

  async function removeMember(id: number) {
    if (!window.confirm("Remove this team member?")) return;
    await adminSend("DELETE", `/api/admin/events/${eventId}/team/${id}`);
    queryClient.invalidateQueries({ queryKey: ["/api/admin/events", eventId, "team"] });
  }

  async function submitInvite(e: React.FormEvent) {
    e.preventDefault();
    const finalTitle = inviteTitle === "Custom…" ? inviteCustomTitle.trim() : inviteTitle;
    if (!inviteName.trim() || !finalTitle) return;
    setInviteBusy(true);
    try {
      await adminSend("POST", `/api/admin/events/${eventId}/team`, { name: inviteName.trim(), title: finalTitle, email: inviteEmail.trim() });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/events", eventId, "team"] });
      setInviteOpen(false);
      setInviteName(""); setInviteTitle("Host"); setInviteCustomTitle(""); setInviteEmail("");
    } catch (err) {
      toast({ title: "Failed", description: (err as Error).message, variant: "destructive" });
    } finally { setInviteBusy(false); }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-base">Event team</h3>
          <p className="text-xs text-muted-foreground mt-0.5">Team members can be selected as email senders in broadcasts.</p>
        </div>
        <Button size="sm" className="gap-1.5" onClick={() => setInviteOpen((v) => !v)}>
          <Plus className="h-3.5 w-3.5" /> Invite
        </Button>
      </div>

      {inviteOpen && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Add team member</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={submitInvite} className="flex flex-col gap-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <Label className="mb-1 block text-xs">Name</Label>
                  <Input value={inviteName} onChange={(e) => setInviteName(e.target.value)} placeholder="Jane Smith" />
                </div>
                <div>
                  <Label className="mb-1 block text-xs">Title</Label>
                  <Select value={inviteTitle} onValueChange={setInviteTitle}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {PRESET_TITLES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  {inviteTitle === "Custom…" && (
                    <Input className="mt-2" value={inviteCustomTitle} onChange={(e) => setInviteCustomTitle(e.target.value)} placeholder="Executive Producer" />
                  )}
                </div>
              </div>
              <div>
                <Label className="mb-1 block text-xs">Email (optional)</Label>
                <Input type="email" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} placeholder="jane@example.com" />
              </div>
              <div className="flex gap-2">
                <Button type="submit" size="sm" disabled={inviteBusy || !inviteName.trim()}>Add to team</Button>
                <Button type="button" size="sm" variant="outline" onClick={() => setInviteOpen(false)}>Cancel</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {isLoading ? (
        <div className="flex flex-col gap-3">{[1,2].map((i) => <Skeleton key={i} className="h-24 rounded-xl" />)}</div>
      ) : members.length === 0 ? (
        <p className="text-sm text-muted-foreground">No team members yet.</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {members.map((m) => (
            <Card key={m.id} className="overflow-hidden">
              <CardContent className="pt-5 pb-4">
                {editing === m.id ? (
                  <div className="flex flex-col gap-3">
                    <div className="flex items-center gap-4">
                      {/* Photo upload in edit mode */}
                      <label className="relative flex-shrink-0 cursor-pointer group">
                        <div className="w-16 h-16 rounded-full overflow-hidden bg-muted border-2 border-dashed border-muted-foreground/30 group-hover:border-primary transition-colors">
                          {m.photoUrl ? (
                            <img src={m.photoUrl.startsWith("http") || m.photoUrl.startsWith("/") ? m.photoUrl : m.photoUrl} alt={m.name} className="w-full h-full object-cover" />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-muted-foreground"><ImagePlus className="h-5 w-5" /></div>
                          )}
                        </div>
                        <div className="absolute inset-0 rounded-full bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                          <ImagePlus className="h-4 w-4 text-white" />
                        </div>
                        <input type="file" accept="image/*" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadPhoto(m.id, f); }} />
                      </label>
                      <div className="flex-1 flex flex-col gap-2">
                        <Input value={editName} onChange={(e) => setEditName(e.target.value)} placeholder="Name" className="h-8 text-sm" />
                        <Input value={editTitle} onChange={(e) => setEditTitle(e.target.value)} placeholder="Title" className="h-8 text-sm" />
                      </div>
                    </div>
                    <Input type="email" value={editEmail} onChange={(e) => setEditEmail(e.target.value)} placeholder="Email (optional)" className="h-8 text-sm" />
                    <div className="flex gap-2">
                      <Button size="sm" className="h-7 text-xs" disabled={editBusy} onClick={() => saveEdit(m.id)}>Save</Button>
                      <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={cancelEdit}>Cancel</Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-4">
                    {/* Photo */}
                    <label className="relative flex-shrink-0 cursor-pointer group">
                      <div className="w-16 h-16 rounded-full overflow-hidden bg-muted">
                        {m.photoUrl ? (
                          <img src={m.photoUrl} alt={m.name} className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-muted-foreground text-xl font-bold">{m.name.charAt(0)}</div>
                        )}
                      </div>
                      <div className="absolute inset-0 rounded-full bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                        <ImagePlus className="h-4 w-4 text-white" />
                      </div>
                      <input type="file" accept="image/*" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadPhoto(m.id, f); }} />
                    </label>
                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <div className="w-1.5 h-1.5 rounded-full bg-green-500 flex-shrink-0" />
                        <p className="font-semibold text-sm truncate">{m.name}</p>
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">{m.title}</p>
                      {m.email && <p className="text-xs text-muted-foreground truncate">{m.email}</p>}
                    </div>
                    {/* Actions */}
                    <div className="flex flex-col gap-1.5 flex-shrink-0">
                      <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => startEdit(m)}>
                        <Pencil className="h-3 w-3" /> Edit
                      </Button>
                      <Button size="sm" variant="ghost" className="h-7 text-xs text-destructive hover:text-destructive hover:bg-destructive/10" onClick={() => removeMember(m.id)}>
                        Remove
                      </Button>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

// Event CRM tab — audience segments + broadcast compose/send
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// ContactDrawer — slide-in panel showing a contact's engagement history
// ---------------------------------------------------------------------------

function ContactDrawer({ contact, onClose, broadcastList, eventId }: {
  contact: ContactRow | EngagementRecipient;
  onClose: () => void;
  broadcastList: BroadcastRow[];
  eventId: number;
}) {
  const queryClient = useQueryClient();
  const email = contact.email;

  type History = { sends: SendRow[]; events: BroadcastEventRow[]; nudges?: { kind: string; sentAt: string; eventId: number }[] };
  const { data: history } = useQuery<History>({
    queryKey: ["/api/admin/contacts", email, "history"],
    queryFn: () => adminGet<History>(`/api/admin/contacts/${encodeURIComponent(email)}/history`),
  });
  const [preview, setPreview] = useState<{ broadcastId?: number; cadence?: string; title: string } | null>(null);

  const { data: signup } = useQuery<SignupSummary>({
    queryKey: ["/api/admin/signup-by-email", eventId, email],
    queryFn: () => adminGet<SignupSummary>(`/api/admin/events/${eventId}/signup-by-email?email=${encodeURIComponent(email)}`),
    retry: false,
  });

  const { data: contactDetail } = useQuery<ContactRow>({
    queryKey: ["/api/admin/contacts", email],
    queryFn: async () => {
      const rows = await adminGet<ContactRow[]>("/api/admin/contacts");
      return rows.find((c) => c.email.toLowerCase() === email.toLowerCase()) as ContactRow;
    },
  });

  const fullContact = contactDetail ?? (contact as ContactRow);

  const broadcastById = new Map(broadcastList.map((b) => [b.id, b]));
  const eventsByResendId = new Map<string, BroadcastEventRow[]>();
  for (const e of history?.events ?? []) {
    (eventsByResendId.get(e.resendId) ?? (eventsByResendId.set(e.resendId, []), eventsByResendId.get(e.resendId)!)).push(e);
  }

  async function setStage(stage: string) {
    await adminSend("PATCH", `/api/admin/contacts/${encodeURIComponent(email)}/lifecycle`, { stage });
    queryClient.invalidateQueries({ queryKey: ["/api/admin/contacts"] });
    queryClient.invalidateQueries({ queryKey: ["/api/admin/contacts", email] });
  }

  const stages = ["lead", "engaged", "signed_up", "no_show", "alumni"];
  const displayName = [contact.firstName, contact.lastName].filter(Boolean).join(" ") || email;

  return (
    <div className="fixed inset-0 z-50 flex justify-end" onClick={onClose}>
      <div className="absolute inset-0 bg-black/30" />
      <div className="relative w-full max-w-md bg-background border-l shadow-xl flex flex-col h-full overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between p-5 border-b">
          <div>
            <p className="font-semibold text-base">{displayName}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{email}</p>
            {signup && <span className="inline-block mt-1 text-xs bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300 px-2 py-0.5 rounded-full font-medium">Signed up</span>}
          </div>
          <Button size="icon" variant="ghost" onClick={onClose}><span className="text-lg">×</span></Button>
        </div>
        <div className="p-5 space-y-5">

          {/* Signup details */}
          {signup && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Registration</p>
              <div className="rounded-lg border p-3 space-y-1.5 text-sm">
                <div className="flex justify-between gap-2">
                  <span className="text-muted-foreground">Podcast</span>
                  <span className="font-medium text-right">{signup.podcastName}</span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-muted-foreground">Host</span>
                  <span className="font-medium text-right">{signup.hostName}</span>
                </div>
                {signup.phone && (
                  <div className="flex justify-between gap-2">
                    <span className="text-muted-foreground">Phone</span>
                    <span className="font-medium text-right">{signup.phone}</span>
                  </div>
                )}
                {signup.branch && (
                  <div className="flex justify-between gap-2">
                    <span className="text-muted-foreground">Branch</span>
                    <span className="font-medium text-right">{signup.branch} {signup.serviceStatus}</span>
                  </div>
                )}
                {signup.socialLinks && (
                  <div className="flex justify-between gap-2">
                    <span className="text-muted-foreground">Social</span>
                    <span className="font-medium text-right text-xs truncate max-w-[60%]">{signup.socialLinks}</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Lifecycle stage (only for contacts with a CRM row) */}
          {"lifecycleStage" in fullContact && fullContact.lifecycleStage && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Lifecycle stage</p>
              <div className="flex flex-wrap gap-1.5">
                {stages.map((s) => (
                  <button
                    key={s}
                    onClick={() => setStage(s)}
                    className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-all ${fullContact.lifecycleStage === s ? LIFECYCLE_COLORS[s] + " border-current" : "border-border text-muted-foreground hover:border-foreground/30"}`}
                  >
                    {LIFECYCLE_LABELS[s]}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Email history: campaigns and the automatic emails in one list,
              newest first, since "what did they last get from us" is the
              question this drawer is opened to answer. */}
          {(() => {
            type Item = { key: string; title: string; at: string; broadcastId?: number; cadence?: string; types: Set<string>; tracked: boolean };
            const items: Item[] = [];
            for (const send of Array.from(new Map((history?.sends ?? []).map((s) => [s.broadcastId, s])).values())) {
              const broadcast = broadcastById.get(send.broadcastId);
              const evts = eventsByResendId.get(send.resendId) ?? [];
              items.push({
                key: `s-${send.id}`,
                title: broadcast?.subject ?? `Broadcast #${send.broadcastId}`,
                at: send.sentAt,
                broadcastId: send.broadcastId,
                types: new Set(evts.map((e) => e.eventType)),
                tracked: true,
              });
            }
            for (const n of history?.nudges ?? []) {
              items.push({ key: `n-${n.kind}-${n.sentAt}`, title: NUDGE_LABELS[n.kind] ?? n.kind, at: n.sentAt, cadence: n.kind, types: new Set(), tracked: false });
            }
            items.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
            return (
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                  Email history{items.length > 0 && <span className="ml-1.5 font-medium normal-case tracking-normal">· {items.length}</span>}
                </p>
                {items.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Nothing sent to this address yet.</p>
                ) : (
                  <div className="space-y-2">
                    {items.map((it) => (
                      <div key={it.key} className="rounded-lg border p-3 text-sm" data-testid={`history-${it.key}`}>
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="font-medium truncate">{it.title}</p>
                            <p className="text-xs text-muted-foreground">{new Date(it.at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}</p>
                          </div>
                          <button
                            type="button"
                            onClick={() => setPreview({ broadcastId: it.broadcastId, cadence: it.cadence, title: it.title })}
                            title="Preview this email"
                            className="shrink-0 rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                            data-testid={`preview-${it.key}`}
                          >
                            <Eye className="h-4 w-4" />
                          </button>
                        </div>
                        <div className="flex gap-2 flex-wrap mt-1.5">
                          {it.types.has("delivered") && <span className="text-xs bg-gray-100 dark:bg-gray-800 px-2 py-0.5 rounded-full">📬 Delivered</span>}
                          {it.types.has("opened") && <span className="text-xs bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 px-2 py-0.5 rounded-full">👁 Opened</span>}
                          {it.types.has("clicked") && <span className="text-xs bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300 px-2 py-0.5 rounded-full">🔗 Clicked</span>}
                          {it.types.has("bounced") && <span className="text-xs bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300 px-2 py-0.5 rounded-full">⚠ Bounced</span>}
                          {it.tracked && it.types.size === 0 && <span className="text-xs text-muted-foreground">Sent — no events yet</span>}
                          {!it.tracked && <span className="text-xs text-muted-foreground">Automatic — sent one at a time, not tracked</span>}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })()}
        </div>
      </div>
      <EmailPreviewDialog target={preview} onClose={() => setPreview(null)} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// CrmEventPanel — full CRM UI inside an event
// ---------------------------------------------------------------------------

type BroadcastStats = { sent: number; delivered: number; opened: number; clicked: number; bounced: number };

function BroadcastCard({ b, eventId, dimmed, bBusy, recipientCount, onEdit, onConfirm, onDelete, onViewEngagement, onDuplicate, onSetSource, onSetSegment, onPreview, segmentOptions }: {
  b: BroadcastRow; eventId: number; dimmed: boolean; bBusy: boolean;
  recipientCount: (seg: string) => number;
  onEdit: (b: BroadcastRow) => void;
  onConfirm: (b: BroadcastRow) => void;
  onDelete: (id: number) => void;
  onViewEngagement: (broadcastId: number, type: "delivered" | "opened" | "clicked" | "bounced" | "unopened", label: string) => void;
  onDuplicate: (b: BroadcastRow) => void;
  onSetSource: (b: BroadcastRow, source: string) => void;
  onSetSegment: (b: BroadcastRow, segment: string) => void;
  onPreview: (segment: string) => void;
  segmentOptions: { value: string; label: string; count: number }[];
}) {
  const cadenceKey = b.source?.startsWith("cadence:") ? b.source.slice("cadence:".length) : "";
  const step = CADENCE_STEPS.find((x) => x.key === cadenceKey);
  const editable = b.status === "draft" || b.status === "scheduled";
  const { data: stats } = useQuery<BroadcastStats>({
    queryKey: ["/api/admin/broadcasts", b.id, "stats"],
    queryFn: () => adminGet<BroadcastStats>(`/api/admin/broadcasts/${b.id}/stats`),
    enabled: b.status === "sent",
    staleTime: 60_000,
  });

  return (
    <div className={`border rounded-xl px-4 py-3 flex items-start justify-between gap-3 transition-opacity ${dimmed ? "opacity-40 pointer-events-none" : ""}`}>
      <div className="min-w-0 flex-1">
        <p className="font-semibold text-sm truncate">{b.subject}</p>
        <p className="text-xs text-muted-foreground mt-0.5">
          {step && <span className="mr-1 font-medium text-primary">{step.label} ·</span>}
          <button
            type="button"
            onClick={() => onPreview(b.segment)}
            className="underline decoration-dotted underline-offset-2 hover:text-foreground"
            data-testid={`preview-segment-${b.id}`}
          >
            {SEGMENT_LABELS[b.segment] ?? b.segment}
          </button>{" "}
          ·{" "}
          {b.status === "sent"
            ? `Sent ${b.sentAt ? new Date(b.sentAt).toLocaleDateString() : ""} · ${b.recipientCount} recipients`
            : b.status === "scheduled" && b.scheduledFor
            ? `Scheduled for ${new Date(b.scheduledFor).toLocaleString()}`
            : `Draft · ${new Date(b.createdAt).toLocaleDateString()}`}
        </p>
        {b.status === "sent" && stats && (
          <div className="flex gap-3 mt-1.5 text-xs flex-wrap">
            <button onClick={() => onViewEngagement(b.id, "delivered", `Delivered — ${b.subject}`)} className="text-muted-foreground hover:text-foreground hover:underline transition-colors">📬 {stats.delivered} delivered</button>
            <button onClick={() => onViewEngagement(b.id, "opened", `Opened — ${b.subject}`)} className="text-blue-600 dark:text-blue-400 hover:underline">👁 {stats.opened} opened</button>
            <button onClick={() => onViewEngagement(b.id, "unopened", `Delivered but not opened — ${b.subject}`)} className="text-amber-600 dark:text-amber-400 hover:underline">↩ {stats.delivered - stats.opened} not opened</button>
            <button onClick={() => onViewEngagement(b.id, "clicked", `Clicked — ${b.subject}`)} className="text-green-600 dark:text-green-400 hover:underline">🔗 {stats.clicked} clicked</button>
            {stats.bounced > 0 && <button onClick={() => onViewEngagement(b.id, "bounced", `Bounced — ${b.subject}`)} className="text-destructive hover:underline">⚠ {stats.bounced} bounced</button>}
          </div>
        )}
      </div>
      {/* Every template opens. Being wired into the cadence used to remove the
          Edit button entirely, which left seven emails on the page that could
          only be read — and the one that had already gone out could not even
          be copied to send again. */}
      <div className="flex flex-wrap items-center justify-end gap-1.5 shrink-0">
        {editable && (
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => onEdit(b)} data-testid={`button-edit-${b.id}`}>
            Edit
          </Button>
        )}

        <Button
          size="sm"
          variant="ghost"
          className="h-7 gap-1 text-xs"
          onClick={() => onDuplicate(b)}
          data-testid={`button-duplicate-${b.id}`}
          title="Copy this into a new draft"
        >
          <Copy className="h-3 w-3" /> Duplicate
        </Button>

        {/* Who it goes to, changeable without opening the editor — the most
            common edit to a draft is its audience, not its words. */}
        {editable && (
          <Select value={b.segment} onValueChange={(seg) => onSetSegment(b, seg)}>
            <SelectTrigger className="h-7 w-[13rem] text-xs" data-testid={`select-segment-${b.id}`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {segmentOptions.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  <span className="flex w-full items-center justify-between gap-3">
                    <span>{o.label}</span>
                    <span className="tabular-nums text-muted-foreground">{o.count >= 0 ? o.count : "—"}</span>
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {/* A cadence slot holds one template. Putting a template into a slot
            that is taken would leave two emails on the same trigger, so taken
            slots are shown as taken rather than silently overwritten. */}
        {editable && !step && (
          <Select value="" onValueChange={(key) => onSetSource(b, cadenceSource(key))}>
            <SelectTrigger
              className="h-7 w-[11rem] whitespace-nowrap text-xs text-muted-foreground"
              data-testid={`select-add-cadence-${b.id}`}
            >
              <SelectValue placeholder="+ Add to cadence" />
            </SelectTrigger>
            <SelectContent>
              {CADENCE_STEPS.map((st) => (
                <SelectItem key={st.key} value={st.key}>
                  <span className="flex flex-col">
                    <span className="font-medium">{st.label}</span>
                    {st.blurb && <span className="text-xs text-muted-foreground">{st.blurb}</span>}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {editable && step && (
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-xs text-muted-foreground"
            onClick={() => onSetSource(b, "manual")}
            data-testid={`button-unwire-${b.id}`}
          >
            Take out of cadence
          </Button>
        )}

        {b.status === "draft" && (
          <Button
            size="sm"
            className="h-7 text-xs gap-1"
            disabled={bBusy || recipientCount(b.segment) === 0}
            onClick={() => onConfirm(b)}
            data-testid={`button-send-${b.id}`}
          >
            <Send className="h-3 w-3" /> Send to {recipientCount(b.segment)}
          </Button>
        )}

        {editable && (
          <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => onDelete(b.id)}>
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        )}

        {b.status === "sent" && !step && <Badge className="text-[11px]">Sent</Badge>}
        {b.status === "sent" && step && <Badge variant="secondary" className="text-[11px]">Auto · {b.recipientCount}</Badge>}
        {b.status === "scheduled" && <Badge variant="outline" className="text-[11px] border-amber-400 text-amber-600 dark:text-amber-400">Scheduled</Badge>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

// Brevo's vocabulary, because it is the one an event planner arrives with:
// a campaign is one email that goes out once, an automation is a series that
// fires off a trigger, and a template is copy you pick from when building
// either. "Cadence" was doing two of those jobs at once.
type CrmView = "lists" | "list-signups" | "list-contacts" | "list-engagement" | "list-segment" | "campaigns" | "templates" | "automation" | "activity" | "compose";

/**
 * Everything that has actually gone out, in the order it went.
 *
 * The Templates tab is a place to write; it lists drafts and sends together
 * because a draft becomes a send. That makes it the wrong place to answer
 * "what have we sent this week and did anyone read it" — the sends are
 * scattered between eight drafts. This is the same rows, filtered to what
 * left the building and ordered by when.
 *
 * It counts the automatic emails too. Those fire per person rather than as a
 * campaign, so their row carries a running total rather than a one-off count,
 * and leaving them out would understate what the list has received from us.
 */
function ActivityLog({
  broadcasts,
  eventId,
  onViewEngagement,
  onSelectContact,
}: {
  broadcasts: BroadcastRow[];
  eventId: number;
  onViewEngagement: (broadcastId: number, type: "delivered" | "opened" | "clicked" | "bounced" | "unopened", label: string) => void;
  onSelectContact: (c: EngagementRecipient) => void;
}) {
  // Newest at the top. The question this tab answers is "what just went
  // out", and on a sixteen-hour send day that row should never be below the
  // fold.
  const sent = useMemo(
    () =>
      broadcasts
        .filter((b) => b.status === "sent" && (b.recipientCount ?? 0) > 0)
        .sort((a, b) => Date.parse(b.sentAt ?? b.createdAt) - Date.parse(a.sentAt ?? a.createdAt)),
    [broadcasts],
  );
  // Two ways to read the same log: by email, or by the person it reached.
  const [mode, setMode] = useState<"sends" | "contacts">("sends");
  const [preview, setPreview] = useState<{ broadcastId?: number; cadence?: string; title: string } | null>(null);

  // Ask Resend for the sends we never filed, so their opens count. An admin
  // presses this; it is not run on a page load.
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [syncing, setSyncing] = useState(false);
  async function syncResend() {
    setSyncing(true);
    try {
      const r = (await adminSend("POST", "/api/admin/emails/sync-resend", {}).then((x) => x.json())) as { scanned: number; matched: number; unmatched: number };
      await queryClient.invalidateQueries({ queryKey: ["/api/admin/broadcasts"] });
      await queryClient.invalidateQueries({ queryKey: ["/api/admin/emails/recipients"] });
      toast({
        title: r.matched ? `${r.matched} sends matched` : "Nothing new",
        description: `${r.scanned} emails read from Resend${r.unmatched ? ` · ${r.unmatched} belong to nothing in this log` : ""}.`,
      });
    } catch (err) {
      toast({ title: "Sync failed", description: (err as Error).message, variant: "destructive" });
    } finally {
      setSyncing(false);
    }
  }

  // The same queries the rows make, hoisted so the total can be added up.
  // Identical cache keys, so this costs no extra requests — and the rows are
  // handed the result rather than asking for it again.
  const statsQueries = useQueries({
    queries: sent.map((b) => ({
      queryKey: ["/api/admin/broadcasts", b.id, "stats"],
      queryFn: () => adminGet<BroadcastStats>(`/api/admin/broadcasts/${b.id}/stats`),
      staleTime: 60_000,
    })),
  });

  const totals = useMemo(() => {
    let emails = 0;
    let delivered = 0;
    let opened = 0;
    let clicked = 0;
    let tracked = 0;
    sent.forEach((b, i) => {
      const st = statsQueries[i]?.data;
      // The automatic rows only started counting when the counter was added;
      // Resend remembers the sends before that. Whichever is larger is the
      // truer number.
      emails += Math.max(b.recipientCount ?? 0, st?.sent ?? 0);
      // The automatic emails fire one at a time and leave no broadcast_sends
      // rows, so they contribute to the email count and to nothing else. The
      // rates below have to be honest about which sends they describe.
      if (st && st.delivered > 0) {
        delivered += st.delivered;
        opened += st.opened;
        clicked += st.clicked;
        tracked += 1;
      }
    });
    return { emails, delivered, opened, clicked, tracked };
  }, [sent, statsQueries]);

  if (sent.length === 0) {
    return (
      <div className="rounded-xl border border-dashed p-10 text-center">
        <Mail className="mx-auto mb-3 h-8 w-8 text-muted-foreground/50" />
        <p className="text-sm font-medium">Nothing has gone out yet</p>
        <p className="mt-1 text-xs text-muted-foreground">Sent emails land here with their delivery and open counts.</p>
      </div>
    );
  }

  const pct = (n: number) => (totals.delivered > 0 ? `${Math.round((n / totals.delivered) * 100)}%` : "—");

  const modeTabs = (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="inline-flex rounded-lg border border-border p-0.5 text-xs" data-testid="activity-mode">
        {([["sends", "By email"], ["contacts", "By contact"]] as const).map(([k, label]) => (
          <button
            key={k}
            type="button"
            onClick={() => setMode(k)}
            className={`rounded-md px-3 py-1.5 font-medium transition-colors ${mode === k ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
            data-testid={`activity-mode-${k}`}
          >
            {label}
          </button>
        ))}
      </div>
      <Button size="sm" variant="outline" onClick={syncResend} disabled={syncing} data-testid="sync-resend">
        <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${syncing ? "animate-spin" : ""}`} />
        {syncing ? "Reading Resend…" : "Sync with Resend"}
      </Button>
    </div>
  );

  if (mode === "contacts") {
    return (
      <>
        {modeTabs}
        <RecipientList eventId={eventId} onSelect={onSelectContact} />
      </>
    );
  }

  return (
    <>
      {modeTabs}
      {/* The four numbers you actually came for, before the list of rows you
          would otherwise have to add up in your head. */}
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-4">
        {[
          { label: "sends", value: sent.length.toLocaleString(), note: "campaigns and automatic" },
          { label: "emails", value: totals.emails.toLocaleString(), note: "delivered to inboxes" },
          { label: "opened", value: totals.opened.toLocaleString(), note: `${pct(totals.opened)} of tracked` },
          { label: "clicked", value: totals.clicked.toLocaleString(), note: `${pct(totals.clicked)} of tracked` },
        ].map((f) => (
          <div key={f.label} className="bg-background px-4 py-3" data-testid={`activity-total-${f.label}`}>
            <div className="text-2xl font-bold tabular-nums tracking-tight">{f.value}</div>
            <div className="text-xs font-medium">{f.label}</div>
            <div className="mt-0.5 text-[11px] text-muted-foreground">{f.note}</div>
          </div>
        ))}
      </div>
      <p className="-mt-1 text-xs text-muted-foreground">
        Opens and clicks cover the {totals.tracked} send{totals.tracked === 1 ? "" : "s"} with a per-send record.
        Sync with Resend fills in the ones that went out without one.
      </p>

      <div className="flex flex-col gap-2">
        {sent.map((b, i) => {
          const auto = b.source?.startsWith("cadence:");
          const when = b.sentAt ? new Date(b.sentAt) : null;
          return (
            <ActivityRow
              key={b.id}
              b={b}
              auto={!!auto}
              when={when}
              stats={statsQueries[i]?.data}
              onViewEngagement={onViewEngagement}
              onPreview={() => setPreview({ broadcastId: b.id, title: b.subject })}
            />
          );
        })}
      </div>
      <EmailPreviewDialog target={preview} onClose={() => setPreview(null)} />
    </>
  );
}

/**
 * Everyone who has had email from us, most recently reached first.
 *
 * The log by email answers "did the sponsor offer go out"; this answers "what
 * has Enrique had from us", which is the question when somebody replies.
 */
function RecipientList({ eventId, onSelect }: { eventId: number; onSelect: (c: EngagementRecipient) => void }) {
  type Recipient = { email: string; name: string; sends: number; lastAt: string };
  const [q, setQ] = useState("");
  const { data: recipients = [], isLoading } = useQuery<Recipient[]>({
    queryKey: ["/api/admin/emails/recipients", eventId],
    queryFn: () => adminGet<Recipient[]>(`/api/admin/emails/recipients?eventId=${eventId}`),
    staleTime: 60_000,
  });
  const needle = q.trim().toLowerCase();
  const shown = needle
    ? recipients.filter((r) => r.email.includes(needle) || r.name.toLowerCase().includes(needle))
    : recipients;

  return (
    <>
      <Input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search by name or email"
        className="max-w-sm"
        data-testid="recipient-search"
      />
      {isLoading ? (
        <Skeleton className="h-40 w-full rounded-xl" />
      ) : shown.length === 0 ? (
        <p className="text-sm text-muted-foreground">{needle ? "Nobody matches that." : "Nobody has been emailed yet."}</p>
      ) : (
        <div className="divide-y divide-border overflow-hidden rounded-xl border border-border">
          {shown.map((r) => {
            const [firstName, ...rest] = r.name.split(" ");
            return (
              <button
                key={r.email}
                type="button"
                onClick={() => onSelect({ email: r.email, firstName: firstName ?? "", lastName: rest.join(" ") })}
                className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-accent"
                data-testid={`recipient-${r.email}`}
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{r.name || r.email}</p>
                  {r.name && <p className="truncate text-xs text-muted-foreground">{r.email}</p>}
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-sm font-semibold tabular-nums">{r.sends}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {r.sends === 1 ? "email" : "emails"} · last {new Date(r.lastAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                  </p>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </>
  );
}

/** One send, with its numbers read back from Resend's webhook. */
function ActivityRow({
  b,
  auto,
  when,
  stats,
  onViewEngagement,
  onPreview,
}: {
  b: BroadcastRow;
  auto: boolean;
  when: Date | null;
  stats?: BroadcastStats;
  onViewEngagement: (broadcastId: number, type: "delivered" | "opened" | "clicked" | "bounced" | "unopened", label: string) => void;
  onPreview: () => void;
}) {
  return (
    <div className="rounded-xl border border-border px-4 py-3" data-testid={`activity-${b.id}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{b.subject}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {when ? when.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "—"}
            {" · "}
            {SEGMENT_LABELS[b.segment] ?? b.segment}
            {" · "}
            {(() => {
              const n = Math.max(b.recipientCount ?? 0, stats?.sent ?? 0);
              return `${n} ${auto ? "so far" : n === 1 ? "recipient" : "recipients"}`;
            })()}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            onClick={onPreview}
            title="Preview this email"
            className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
            data-testid={`preview-${b.id}`}
          >
            <Eye className="h-4 w-4" />
          </button>
          {auto ? (
            <Badge variant="secondary" className="text-[11px]">Automatic</Badge>
          ) : (
            <Badge className="text-[11px]">Sent</Badge>
          )}
        </div>
      </div>

      {stats && (stats.delivered > 0 || stats.bounced > 0) ? (
        <div className="mt-2 flex flex-wrap gap-3 text-xs">
          <button onClick={() => onViewEngagement(b.id, "delivered", `Delivered — ${b.subject}`)} className="text-muted-foreground hover:underline">
            📬 {stats.delivered} delivered
          </button>
          <button onClick={() => onViewEngagement(b.id, "opened", `Opened — ${b.subject}`)} className="text-blue-600 hover:underline dark:text-blue-400">
            👁 {stats.opened} opened
          </button>
          <button onClick={() => onViewEngagement(b.id, "clicked", `Clicked — ${b.subject}`)} className="text-green-600 hover:underline dark:text-green-400">
            🔗 {stats.clicked} clicked
          </button>
          {stats.bounced > 0 && (
            <button onClick={() => onViewEngagement(b.id, "bounced", `Bounced — ${b.subject}`)} className="text-destructive hover:underline">
              ⚠ {stats.bounced} bounced
            </button>
          )}
        </div>
      ) : (
        /* A transactional send has no broadcast_sends rows to join against,
           so there is nothing to report beyond the count it keeps itself. */
        <p className="mt-2 text-xs text-muted-foreground">
          {auto ? "Sent one at a time as people book — nothing matched yet. Sync with Resend fills these in." : "Waiting for delivery events."}
        </p>
      )}
    </div>
  );
}

/**
 * Nine in the morning, in the event's own zone, on the given calendar day.
 *
 * Send dates come from the cadence as "N days from the event", and the hour
 * has to be a sensible one for the people receiving it, not for UTC.
 */
function nineAmInZone(day: Date, tz: string): string {
  const y = day.getUTCFullYear(), m = day.getUTCMonth(), d = day.getUTCDate();
  // What the zone's clock says at this UTC instant tells us the offset.
  const probe = new Date(Date.UTC(y, m, d, 9, 0));
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", hour12: false, minute: "numeric" }).formatToParts(probe);
  const h = Number(parts.find((x) => x.type === "hour")?.value ?? "9") % 24;
  const offsetHours = h - 9; // zone is ahead of UTC by this much at 09:00Z
  return new Date(Date.UTC(y, m, d, 9 - offsetHours, 0)).toISOString();
}

/**
 * Everything a podcaster receives, in the order it reaches them.
 *
 * One list, not two. The split between "sent for you automatically" and
 * "yours to write" described how each email is built, which is our problem
 * and nobody else's — and it hid that two of them were aimed at the same
 * moment. What the person running the event needs from this page is three
 * things per email: when it goes, whether it has, and what it says.
 */
function CadenceList({
  event,
  cadenceBySource,
  onEdit,
  onWrite,
  onSchedule,
}: {
  event: PublicEvent | null | undefined;
  cadenceBySource: Map<string, BroadcastRow>;
  onEdit: (b: BroadcastRow) => void;
  onWrite: (source: string) => void;
  onSchedule: (b: BroadcastRow, whenIso: string) => Promise<void>;
}) {
  const tz = "America/New_York";
  const start = event?.startAtUtc ? new Date(event.startAtUtc) : null;
  // The event's calendar day in its own zone, as a UTC-midnight date we can
  // add days to without the arithmetic slipping across a zone boundary.
  const eventDay = useMemo(() => {
    if (!start) return null;
    const ymd = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(start);
    return new Date(`${ymd}T00:00:00Z`);
  }, [start?.getTime()]);
  const dayFor = (days: number | null) => {
    if (days === null || !eventDay) return null;
    return new Date(eventDay.getTime() + days * 86400_000);
  };
  const today = useMemo(() => {
    const ymd = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    return new Date(`${ymd}T00:00:00Z`).getTime();
  }, []);
  const fmtDay = (d: Date) => d.toLocaleDateString(undefined, { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" });

  const rows = CADENCE.map((step) => ({ step, b: cadenceBySource.get(cadenceSource(step.key)) }));
  const statsQueries = useQueries({
    queries: rows.map(({ b }) => ({
      queryKey: ["/api/admin/broadcasts", b?.id ?? 0, "stats"],
      queryFn: () => adminGet<BroadcastStats>(`/api/admin/broadcasts/${b!.id}/stats`),
      enabled: !!b && b.status === "sent",
      staleTime: 60_000,
    })),
  });
  const [preview, setPreview] = useState<{ broadcastId?: number; cadence?: string; title: string } | null>(null);
  const [scheduling, setScheduling] = useState<number | null>(null);

  return (
    <>
      <div className="hidden grid-cols-[2rem_1fr_9rem_7rem_11rem_9rem] gap-3 px-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground sm:grid">
        <span />
        <span>Email</span>
        <span>Send date</span>
        <span>Status</span>
        <span>Numbers</span>
        <span />
      </div>
      <div className="flex flex-col gap-2">
        {rows.map(({ step, b }, i) => {
          const day = dayFor(step.days);
          const stats = statsQueries[i]?.data;
          const sentCount = Math.max(b?.recipientCount ?? 0, stats?.sent ?? 0);
          const overdue = !step.auto && day !== null && day.getTime() < today && b?.status !== "sent";
          const dueToday = !step.auto && day !== null && day.getTime() === today && b?.status !== "sent";
          const canSchedule = !step.auto && !!b && b.status === "draft" && !!b.bodyText.trim() && day !== null && day.getTime() >= today;

          const status = step.auto
            ? <Badge variant="secondary" className="gap-1 text-[11px]"><Zap className="h-3 w-3" /> Automatic</Badge>
            : b?.status === "sent" ? <Badge className="text-[11px]">Sent</Badge>
            : b?.status === "scheduled" ? <Badge variant="secondary" className="text-[11px]">Scheduled</Badge>
            : b ? <Badge variant="outline" className={`text-[11px] ${overdue ? "border-amber-500 text-amber-700 dark:text-amber-400" : ""}`}>Draft</Badge>
            : <Badge variant="outline" className="text-[11px] text-muted-foreground">Not written</Badge>;

          const when = step.days === null
            ? <span className="text-muted-foreground">When they book</span>
            : b?.status === "sent" && b.sentAt
              ? <span>{new Date(b.sentAt).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })}</span>
              : b?.status === "scheduled" && b.scheduledFor
                ? <span>{new Date(b.scheduledFor).toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}</span>
                : day
                  ? <span className={overdue ? "font-medium text-amber-700 dark:text-amber-400" : dueToday ? "font-medium" : ""}>
                      {fmtDay(day)}{step.auto ? <span className="block text-[11px] text-muted-foreground">before their slot</span> : dueToday ? <span className="block text-[11px]">today</span> : overdue ? <span className="block text-[11px]">passed, not sent</span> : null}
                    </span>
                  : <span className="text-muted-foreground">—</span>;

          return (
            <div
              key={step.key}
              className={`grid grid-cols-1 items-center gap-2 rounded-xl border p-3 sm:grid-cols-[2rem_1fr_9rem_7rem_11rem_9rem] sm:gap-3 ${step.auto ? "border-dashed bg-muted/20" : "border-border"} ${overdue ? "border-amber-400/60" : ""}`}
              data-testid={`row-cadence-${step.key}`}
            >
              {/* Every row is numbered: the order is the point of the page,
                  and a bolt where a number should be made it read 1, 3, 5. */}
              <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold ${step.auto ? "bg-muted text-muted-foreground" : "bg-primary/10 text-primary"}`}>
                {i + 1}
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold">{step.label}</p>
                <p className="truncate text-xs text-muted-foreground">{b?.subject || step.blurb}</p>
              </div>
              <div className="text-xs">{when}</div>
              <div>{status}</div>
              <div className="text-xs text-muted-foreground">
                {sentCount > 0 ? (
                  <>
                    <span className="font-medium text-foreground">{sentCount}</span> sent
                    {stats && stats.delivered > 0 && <> · <span className="font-medium text-foreground">{stats.opened}</span> opened</>}
                    {stats && stats.clicked > 0 && <> · {stats.clicked} clicked</>}
                  </>
                ) : (
                  <span>—</span>
                )}
              </div>
              <div className="flex items-center justify-end gap-1.5">
                {(step.auto || b) && (
                  <button
                    type="button"
                    onClick={() => setPreview(step.auto ? { cadence: step.key, title: step.label } : { broadcastId: b!.id, title: b!.subject })}
                    title="Preview this email"
                    className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                    data-testid={`preview-cadence-${step.key}`}
                  >
                    <Eye className="h-4 w-4" />
                  </button>
                )}
                {canSchedule && day && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1.5"
                    disabled={scheduling === b!.id}
                    onClick={async () => { setScheduling(b!.id); try { await onSchedule(b!, nineAmInZone(day, tz)); } finally { setScheduling(null); } }}
                    data-testid={`schedule-cadence-${step.key}`}
                  >
                    <Send className="h-3.5 w-3.5" /> Schedule
                  </Button>
                )}
                {!step.auto && (
                  <Button
                    size="sm"
                    variant={b ? "outline" : "default"}
                    className="gap-1.5"
                    onClick={() => (b ? onEdit(b) : onWrite(cadenceSource(step.key)))}
                    data-testid={`button-cadence-${step.key}`}
                  >
                    {b ? <><Pencil className="h-3.5 w-3.5" /> Edit</> : <><Plus className="h-3.5 w-3.5" /> Write</>}
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <p className="text-xs text-muted-foreground">
        Automatic emails carry each podcaster's own slot time, so their wording lives in the code — the eye shows it.
        Schedule sends a draft at 9:00 AM Eastern on its date; Edit changes the date or the words.
      </p>
      <EmailPreviewDialog target={preview} onClose={() => setPreview(null)} />
    </>
  );
}

/** Three jobs: write the emails, wire them into the sequence, and see what
 *  has actually gone out. */
function BroadcastSubNav({ view, setView }: { view: CrmView; setView: (v: CrmView) => void }) {
  const tabs: { key: CrmView; label: string }[] = [
    { key: "campaigns", label: "Campaigns" },
    { key: "automation", label: "Automation" },
    { key: "templates", label: "Templates" },
    { key: "activity", label: "Activity log" },
  ];
  return (
    <div className="inline-flex rounded-lg bg-muted p-1">
      {tabs.map((t) => (
        <button
          key={t.key}
          type="button"
          onClick={() => setView(t.key)}
          className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
            view === t.key ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground"
          }`}
          data-testid={`tab-broadcast-${t.key}`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

function CrmEventPanel({ eventId, event }: { eventId: number; event?: PublicEvent | null }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [view, setView] = useState<CrmView>("lists");
  const [search, setSearch] = useState("");
  const [selectedContact, setSelectedContact] = useState<ContactRow | EngagementRecipient | null>(null);
  const [engagementCtx, setEngagementCtx] = useState<{ broadcastId: number; type: string; label: string } | null>(null);
  const [activeSegment, setActiveSegment] = useState<SegmentRow | null>(null);
  const [newListOpen, setNewListOpen] = useState(false);
  const [newListName, setNewListName] = useState("");
  const [newListBusy, setNewListBusy] = useState(false);
  const [bSource, setBSource] = useState("");

  // ── data ────────────────────────────────────────────────────────────────

  const { data: signupContacts = [], isLoading: loadingSignups } = useQuery<{ email: string; firstName: string }[]>({
    queryKey: ["/api/admin/signups-contacts", eventId],
    queryFn: () => adminGet<{ email: string; firstName: string }[]>(`/api/admin/events/${eventId}/signup-contacts`),
  });

  const { data: contactList = [], isLoading: loadingContacts } = useQuery<ContactRow[]>({
    queryKey: ["/api/admin/contacts"],
    queryFn: () => adminGet<ContactRow[]>("/api/admin/contacts"),
  });
  const activeContacts = contactList.filter((c) => c.status === "active");

  const { data: broadcastList = [], isLoading: loadingBroadcasts } = useQuery<BroadcastRow[]>({
    queryKey: ["/api/admin/broadcasts", eventId],
    queryFn: () => adminGet<BroadcastRow[]>(`/api/admin/broadcasts?eventId=${eventId}`),
  });

  // Cadence emails are filed by source; campaigns are everything else, so the
  // two tabs never show each other's rows.
  const cadenceBySource = useMemo(() => {
    const m = new Map<string, BroadcastRow>();
    for (const b of broadcastList) if (b.source?.startsWith("cadence:")) m.set(b.source, b);
    return m;
  }, [broadcastList]);
  const oneOffBroadcasts = useMemo(
    () => broadcastList.filter((b) => !b.source?.startsWith("cadence:")),
    [broadcastList],
  );

  /**
   * The list reads as a history, so it is ordered like one.
   *
   * Sent mail first in the order it went out — the first thing anyone received
   * is the first thing on the page — then anything scheduled by when it fires,
   * then the drafts. Sorting the whole list by creation date instead buried
   * the one email that has actually been sent under seven that never have.
   */
  /**
   * Three lists, from one table.
   *
   * A template is copy with no send date and no recipients — it is picked
   * when building something else. A campaign goes out once. An automation
   * step is wired to a moment in the sequence and carries its source.
   * Sixteen rows in one list, some with a status that meant something and
   * some where it never could, is what made this screen unreadable.
   */
  const templateBroadcasts = useMemo(
    () => broadcastList.filter((b) => b.isTemplate),
    [broadcastList],
  );
  const campaignBroadcasts = useMemo(
    () => broadcastList.filter((b) => !b.isTemplate && b.source === "manual"),
    [broadcastList],
  );

  const orderedBroadcasts = useMemo(() => {
    const rank = (b: BroadcastRow) => (b.status === "sent" ? 0 : b.status === "scheduled" ? 1 : 2);
    const when = (b: BroadcastRow) => Date.parse(b.sentAt ?? b.scheduledFor ?? b.createdAt) || 0;
    return [...broadcastList].sort((a, b) => {
      const ra = rank(a);
      const rb = rank(b);
      if (ra !== rb) return ra - rb;
      // Sent and scheduled read forwards in time; drafts read newest-first,
      // because an unsent draft is a to-do, not a record.
      return ra === 2 ? when(b) - when(a) : when(a) - when(b);
    });
  }, [broadcastList]);


  const { data: teamMembers = [] } = useQuery<TeamMember[]>({
    queryKey: ["/api/admin/events", eventId, "team"],
    queryFn: () => adminGet<TeamMember[]>(`/api/admin/events/${eventId}/team`),
  });

  const { data: importLog = [] } = useQuery<ContactImport[]>({
    queryKey: ["/api/admin/contacts/imports"],
    queryFn: () => adminGet<ContactImport[]>("/api/admin/contacts/imports"),
  });

  const { data: customSegments = [], refetch: refetchSegments } = useQuery<SegmentRow[]>({
    queryKey: ["/api/admin/segments", eventId],
    queryFn: () => adminGet<SegmentRow[]>(`/api/admin/segments?eventId=${eventId ?? ""}`),
  });

  const { data: engagementRecipients = [], isLoading: loadingEngagement } = useQuery<EngagementRecipient[]>({
    queryKey: ["/api/admin/broadcasts", engagementCtx?.broadcastId, "recipients", engagementCtx?.type],
    queryFn: () => adminGet<EngagementRecipient[]>(`/api/admin/broadcasts/${engagementCtx!.broadcastId}/recipients?engagement=${engagementCtx!.type}`),
    enabled: !!engagementCtx && view === "list-engagement",
  });

  // ── import ──────────────────────────────────────────────────────────────

  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const [showImport, setShowImport] = useState(false);

  async function importCsv(e: React.FormEvent) {
    e.preventDefault();
    if (!csvFile) return;
    setImporting(true);
    try {
      const csvText = await csvFile.text();
      const result: { inserted: number; updated: number; total: number } = await adminSend("POST", "/api/admin/contacts/import", { csv: csvText }).then((r) => r.json());
      toast({ title: "Imported", description: `${result.inserted} new, ${result.updated} updated of ${result.total} rows.` });
      setCsvFile(null); setShowImport(false);
      queryClient.invalidateQueries({ queryKey: ["/api/admin/contacts"] });
    } catch (err) {
      toast({ title: "Import failed", description: (err as Error).message, variant: "destructive" });
    } finally { setImporting(false); }
  }

  async function createList(e: React.FormEvent) {
    e.preventDefault();
    if (!newListName.trim()) return;
    setNewListBusy(true);
    try {
      await adminSend("POST", "/api/admin/segments", { eventId: eventId ?? null, name: newListName.trim(), filterJson: {} });
      setNewListName(""); setNewListOpen(false);
      refetchSegments();
      toast({ title: "List created", description: `"${newListName.trim()}" is ready. Add contacts by emailing from the Broadcasts tab.` });
    } catch (err) {
      toast({ title: "Failed", description: (err as Error).message, variant: "destructive" });
    } finally { setNewListBusy(false); }
  }

  async function deleteSegment(seg: SegmentRow) {
    await adminSend("DELETE", `/api/admin/segments/${seg.id}`, null);
    refetchSegments();
  }

  // ── compose / send ──────────────────────────────────────────────────────

  const [editingBroadcast, setEditingBroadcast] = useState<BroadcastRow | null>(null);
  const [bSubject, setBSubject] = useState("");
  const [bBody, setBBody] = useState("");
  const [bSegment, setBSegment] = useState<string>("signups");
  const [bSender, setBSender] = useState("team");
  const [bBanner, setBBanner] = useState("welcome");
  const [bScheduledFor, setBScheduledFor] = useState("");
  const [bBusy, setBBusy] = useState(false);
  const [bShowPreview, setBShowPreview] = useState(false);
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiOpen, setAiOpen] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);

  function openCompose(prefillSegment?: string, source?: string) {
    setEditingBroadcast(null);
    setBSource(source ?? "");
    setBSubject(""); setBBody("");
    setBSegment((prefillSegment ?? "signups") as any);
    setBSender("team"); setBBanner("welcome"); setBScheduledFor("");
    setBShowPreview(false);
    setView("compose");
  }

  function openEngagementView(broadcastId: number, type: "delivered" | "opened" | "clicked" | "bounced" | "unopened", label: string) {
    setEngagementCtx({ broadcastId, type, label });
    setSearch("");
    setView("list-engagement");
  }
  function openEdit(b: BroadcastRow) {
    setEditingBroadcast(b);
    setBSource(b.source ?? "");
    setBSubject(b.subject); setBBody(b.bodyText);
    setBSegment(b.segment as "signups" | "contacts" | "all");
    setBSender(b.sender ?? "team");
    setBBanner(b.banner ?? "welcome");
    setBScheduledFor(b.scheduledFor ? b.scheduledFor.slice(0, 16) : "");
    setBShowPreview(false);
    setView("compose");
  }

  async function saveDraft(e: React.FormEvent) {
    e.preventDefault();
    if (!bSubject.trim() || !bBody.trim()) return;
    setBBusy(true);
    const scheduledFor = bScheduledFor ? new Date(bScheduledFor).toISOString() : null;
    try {
      if (!editingBroadcast) {
        await adminSend("POST", "/api/admin/broadcasts", { subject: bSubject.trim(), bodyText: bBody.trim(), eventId, segment: bSegment, sender: bSender ?? "team", banner: bBanner, scheduledFor, ...(bSource ? { source: bSource } : {}) });
      } else {
        await adminSend("PUT", `/api/admin/broadcasts/${editingBroadcast.id}`, { subject: bSubject.trim(), bodyText: bBody.trim(), segment: bSegment, sender: bSender ?? "team", banner: bBanner, scheduledFor });
      }
      queryClient.invalidateQueries({ queryKey: ["/api/admin/broadcasts", eventId] });
      toast({ title: scheduledFor ? "Scheduled ✓" : "Draft saved", description: scheduledFor ? `Will send at ${new Date(scheduledFor).toLocaleString()}` : undefined });
      setView("campaigns");
    } catch (err) {
      toast({ title: "Save failed", description: (err as Error).message, variant: "destructive" });
    } finally { setBBusy(false); }
  }

  async function draftWithAI() {
    if (!aiPrompt.trim()) return;
    setAiLoading(true);
    try {
      const res = await adminSend("POST", "/api/admin/ai/draft-email", { prompt: aiPrompt });
      const result = await res.json() as { subject: string; body: string };
      setBSubject(result.subject ?? "");
      setBBody(result.body ?? "");
      setAiOpen(false);
      setAiPrompt("");
    } catch (err) {
      toast({ title: "AI draft failed", description: (err as Error).message, variant: "destructive" });
    } finally { setAiLoading(false); }
  }

  const [confirmBroadcast, setConfirmBroadcast] = useState<BroadcastRow | null>(null);

  /** Copy one into a fresh draft and open it, so the copy is the next thing on screen. */
  async function duplicateBroadcast(b: BroadcastRow) {
    setBBusy(true);
    try {
      const copy: BroadcastRow = await adminSend("POST", `/api/admin/broadcasts/${b.id}/duplicate?eventId=${eventId}`).then((r) => r.json());
      await queryClient.invalidateQueries({ queryKey: ["/api/admin/broadcasts", eventId] });
      openEdit(copy);
      toast({ title: "Copied to a new draft", description: "Nothing is sent until you press send." });
    } catch (err) {
      toast({ title: "Couldn't duplicate", description: (err as Error).message, variant: "destructive" });
    } finally { setBBusy(false); }
  }

  /** The set of signed-up emails, for excluding them from a recruitment send. */
  const signedUpEmails = useMemo(
    () => new Set(signupContacts.map((c) => c.email.trim().toLowerCase())),
    [signupContacts],
  );
  const notSignedUpCount = useMemo(
    () => activeContacts.filter((c) => !signedUpEmails.has(c.email.trim().toLowerCase())).length,
    [activeContacts, signedUpEmails],
  );

  /** The audiences a broadcast can go to, with live counts beside each. */
  const segmentOptions = useMemo(
    () => [
      { value: "signups", label: "Signed-up podcasters", count: signupContacts.length },
      { value: "contacts", label: "Imported contacts", count: activeContacts.length },
      { value: "not-signed-up", label: "On the list, no slot yet", count: notSignedUpCount },
      // Counted on the server, where the follower figures live. -1 means
      // "ask when you send" rather than a number this page could only guess.
      { value: "no-audience-link", label: "Booked, but no social link on file", count: -1 },
      { value: "all", label: "Both", count: signupContacts.length + activeContacts.length },
      ...customSegments.map((sg) => ({ value: `segment:${sg.id}`, label: sg.name, count: -1 })),
    ],
    [signupContacts.length, activeContacts.length, notSignedUpCount, customSegments],
  );

  /** Which segment's recipient list is open, if any. */
  const [previewSegment, setPreviewSegment] = useState<string | null>(null);

  /** Change a draft's audience from the list, without opening the editor. */
  async function setBroadcastSegment(b: BroadcastRow, segment: string) {
    setBBusy(true);
    try {
      await adminSend("PUT", `/api/admin/broadcasts/${b.id}`, { segment });
      await queryClient.invalidateQueries({ queryKey: ["/api/admin/broadcasts", eventId] });
    } catch (err) {
      toast({ title: "Couldn't change the audience", description: (err as Error).message, variant: "destructive" });
    } finally { setBBusy(false); }
  }

  /**
   * Wire a template into a cadence slot, or take it back out.
   *
   * A slot holds one template. If something is already in the slot it is taken
   * out first rather than left behind — two drafts claiming the same trigger
   * is the kind of thing nobody notices until both of them send.
   */
  async function setBroadcastSource(b: BroadcastRow, source: string) {
    setBBusy(true);
    try {
      if (source.startsWith("cadence:")) {
        const occupant = broadcastList.find((x) => x.source === source && x.id !== b.id);
        if (occupant) {
          if (!window.confirm(`"${occupant.subject}" is already in that slot. Move it out and put "${b.subject}" in?`)) {
            return;
          }
          await adminSend("PUT", `/api/admin/broadcasts/${occupant.id}`, { source: "manual" });
        }
      }
      await adminSend("PUT", `/api/admin/broadcasts/${b.id}`, { source });
      await queryClient.invalidateQueries({ queryKey: ["/api/admin/broadcasts", eventId] });
      const step = CADENCE_STEPS.find((x) => `cadence:${x.key}` === source);
      toast({
        title: step ? `Now sending as ${step.label}` : "Taken out of the cadence",
        description: step ? step.blurb || "It fires automatically at that point." : "It stays here as a template you can send by hand.",
      });
    } catch (err) {
      toast({ title: "Couldn't change that", description: (err as Error).message, variant: "destructive" });
    } finally { setBBusy(false); }
  }

  async function sendTest() {
    if (!editingBroadcast) {
      toast({ title: "Save draft first", description: "Save the draft before sending a test email." });
      return;
    }
    setBBusy(true);
    try {
      const result: { ok: boolean; to: string } = await adminSend("POST", `/api/admin/broadcasts/${editingBroadcast.id}/test?eventId=${eventId}`).then((r) => r.json());
      // The endpoint reports whether the provider accepted it. Saying "sent"
      // regardless is how a dead mail provider stays invisible.
      if (result.ok) {
        toast({ title: "Test sent ✓", description: `Preview email sent to ${result.to}` });
      } else {
        toast({
          title: "Test not sent",
          description: `The mail provider rejected it. Nothing arrived at ${result.to}.`,
          variant: "destructive",
        });
      }
    } catch (err) {
      toast({ title: "Test failed", description: (err as Error).message, variant: "destructive" });
    } finally { setBBusy(false); }
  }

  function recipientCount(seg: string) {
    if (seg === "signups") return signupContacts.length;
    if (seg === "contacts") return activeContacts.length;
    if (seg === "not-signed-up") return notSignedUpCount;
    if (seg === "no-audience-link") return -1; // the server knows; this page doesn't
    if (seg.startsWith("engagement:")) return -1; // unknown until send
    return signupContacts.length + activeContacts.length;
  }

  function segmentLabel(seg: string) {
    if (SEGMENT_LABELS[seg]) return SEGMENT_LABELS[seg];
    if (seg.startsWith("engagement:")) {
      const [, bId, type] = seg.split(":");
      const b = broadcastList.find((x) => x.id === Number(bId));
      const typeLabel: Record<string, string> = { delivered: "delivered", opened: "who opened", clicked: "who clicked", bounced: "bounced", unopened: "delivered but not opened" };
      return `Contacts ${typeLabel[type] ?? type}${b ? ` — "${b.subject}"` : ""}`;
    }
    return seg;
  }

  async function confirmAndSend() {
    if (!confirmBroadcast) return;
    const b = confirmBroadcast;
    setConfirmBroadcast(null);
    setBBusy(true);
    try {
      const result: { sent: number; failed: number } = await adminSend("POST", `/api/admin/broadcasts/${b.id}/send?eventId=${eventId}`).then((r) => r.json());
      toast({ title: "Sent ✓", description: `${result.sent} delivered${result.failed ? `, ${result.failed} failed` : ""}.` });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/broadcasts", eventId] });
    } catch (err) {
      toast({ title: "Send failed", description: (err as Error).message, variant: "destructive" });
    } finally { setBBusy(false); }
  }

  async function deleteBroadcast(id: number) {
    if (!window.confirm("Delete this draft?")) return;
    await adminSend("DELETE", `/api/admin/broadcasts/${id}`);
    queryClient.invalidateQueries({ queryKey: ["/api/admin/broadcasts", eventId] });
  }

  // ── helpers ─────────────────────────────────────────────────────────────

  const filteredSignups = signupContacts.filter((c) =>
    !search || c.email.includes(search.toLowerCase()) || c.firstName.toLowerCase().includes(search.toLowerCase())
  );
  const filteredContacts = activeContacts.filter((c) =>
    !search || c.email.includes(search.toLowerCase()) ||
    `${c.firstName} ${c.lastName}`.toLowerCase().includes(search.toLowerCase())
  );

  // ── sub-nav ─────────────────────────────────────────────────────────────

  const navItems: { id: CrmView; label: string }[] = [
    { id: "lists", label: "Contacts" },
    { id: "campaigns", label: "Broadcasts" },
  ];
  const activeNav = view === "list-signups" || view === "list-contacts" || view === "list-engagement" ? "lists"
    : view === "compose" ? "campaigns"
    : view;

  return (
    <div className="flex flex-col gap-0">
      {selectedContact && (
        <ContactDrawer contact={selectedContact} onClose={() => setSelectedContact(null)} broadcastList={broadcastList} eventId={eventId} />
      )}
      {/* Horizontal sub-nav */}
      <div className="flex border-b mb-6">
        {navItems.map((n) => (
          <button
            key={n.id}
            onClick={() => setView(n.id)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
              activeNav === n.id
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {n.label}
          </button>
        ))}
      </div>

      {/* ── CONTACTS: list directory ── */}
      {view === "lists" && (
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">Select a list to view or email its contacts</p>
            <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setNewListOpen(true)}>
              <Plus className="h-3.5 w-3.5" /> New list
            </Button>
          </div>

          {/* New list dialog */}
          {newListOpen && (
            <Card className="border-primary/50 shadow-sm">
              <CardContent className="pt-4 pb-4">
                <form onSubmit={createList} className="flex items-center gap-3 flex-wrap">
                  <div className="flex-1 min-w-48">
                    <Input
                      autoFocus
                      placeholder='List name, e.g. "Hot leads — clicked email"'
                      value={newListName}
                      onChange={(e) => setNewListName(e.target.value)}
                    />
                  </div>
                  <Button type="submit" disabled={newListBusy || !newListName.trim()} size="sm">
                    {newListBusy ? "Creating…" : "Create list"}
                  </Button>
                  <Button type="button" variant="ghost" size="sm" onClick={() => { setNewListOpen(false); setNewListName(""); }}>Cancel</Button>
                </form>
                <p className="text-xs text-muted-foreground mt-2">The list starts empty. Add contacts by saving from an engagement view or importing a CSV.</p>
              </CardContent>
            </Card>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Signed-up card */}
            <div
              className="border rounded-xl p-5 cursor-pointer hover:border-primary hover:bg-accent/30 transition-colors flex flex-col gap-3"
              onClick={() => { setSearch(""); setView("list-signups"); }}
            >
              <div className="flex items-start justify-between">
                <div>
                  <p className="font-semibold text-sm">Signed-up podcasters</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Registered for this event</p>
                </div>
                <span className="text-2xl font-bold text-primary">{loadingSignups ? "—" : signupContacts.length}</span>
              </div>
              <div className="flex items-center gap-2 mt-auto">
                <Button size="sm" variant="outline" className="gap-1.5 h-7 text-xs" onClick={(e) => { e.stopPropagation(); openCompose("signups"); }}>
                  <Mail className="h-3 w-3" /> Email list
                </Button>
                <span className="text-xs text-muted-foreground flex items-center gap-1 ml-auto">View <ChevronRight className="h-3 w-3" /></span>
              </div>
            </div>

            {/* Imported contacts card */}
            <div
              className="border rounded-xl p-5 cursor-pointer hover:border-primary hover:bg-accent/30 transition-colors flex flex-col gap-3"
              onClick={() => { setSearch(""); setView("list-contacts"); }}
            >
              <div className="flex items-start justify-between">
                <div>
                  <p className="font-semibold text-sm">Imported contacts</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Podcasters from CSV — not signed up</p>
                </div>
                <span className="text-2xl font-bold text-primary">{loadingContacts ? "—" : activeContacts.length}</span>
              </div>
              {importLog.length > 0 && (
                <div className="space-y-1">
                  {importLog.slice(0, 2).map((imp) => (
                    <p key={imp.id} className="text-xs text-muted-foreground">
                      {new Date(imp.importedAt).toLocaleDateString()} — {imp.inserted} added, {imp.updated} updated ({imp.total} total)
                    </p>
                  ))}
                </div>
              )}
              <div className="flex items-center gap-2 mt-auto">
                <Button size="sm" variant="outline" className="gap-1.5 h-7 text-xs" onClick={(e) => { e.stopPropagation(); setShowImport((v) => !v); }}>
                  <Upload className="h-3 w-3" /> Import CSV
                </Button>
                <Button size="sm" variant="outline" className="gap-1.5 h-7 text-xs" onClick={(e) => { e.stopPropagation(); openCompose("contacts"); }}>
                  <Mail className="h-3 w-3" /> Email list
                </Button>
                <span className="text-xs text-muted-foreground flex items-center gap-1 ml-auto">View <ChevronRight className="h-3 w-3" /></span>
              </div>
            </div>
          </div>

          {/* Custom segments */}
          {customSegments.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {customSegments.map((seg) => (
                <div
                  key={seg.id}
                  className="border rounded-xl p-5 cursor-pointer hover:border-primary hover:bg-accent/30 transition-colors flex flex-col gap-3"
                  onClick={() => { setActiveSegment(seg); setSearch(""); setView("list-segment"); }}
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="font-semibold text-sm">{seg.name}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">Custom list · {new Date(seg.createdAt).toLocaleDateString()}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 mt-auto">
                    <Button size="sm" variant="outline" className="gap-1.5 h-7 text-xs" onClick={(e) => { e.stopPropagation(); openCompose(`segment:${seg.id}`); }}>
                      <Mail className="h-3 w-3" /> Email list
                    </Button>
                    <button
                      className="text-xs text-muted-foreground hover:text-destructive ml-auto"
                      onClick={(e) => { e.stopPropagation(); if (confirm(`Delete "${seg.name}"?`)) deleteSegment(seg); }}
                    >Delete</button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {showImport && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Import contacts from CSV</CardTitle>
                <CardDescription>Select a CSV file. Required column: <code>email</code>. Optional: <code>first_name</code>, <code>last_name</code>.</CardDescription>
              </CardHeader>
              <CardContent>
                <form onSubmit={importCsv} className="flex items-center gap-3 flex-wrap">
                  <label className="flex items-center gap-2 cursor-pointer border rounded-md px-3 py-2 text-sm hover:bg-accent transition-colors">
                    <Upload className="h-4 w-4" />
                    {csvFile ? csvFile.name : "Choose CSV file"}
                    <input type="file" accept=".csv,text/csv" className="sr-only" onChange={(e) => setCsvFile(e.target.files?.[0] ?? null)} />
                  </label>
                  {csvFile && (
                    <Button type="submit" disabled={importing} className="gap-1.5">
                      <Upload className="h-4 w-4" /> Import {csvFile.name}
                    </Button>
                  )}
                  <Button type="button" variant="ghost" className="text-muted-foreground" onClick={() => { setShowImport(false); setCsvFile(null); }}>Cancel</Button>
                </form>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* ── CONTACTS: signed-up list view ── */}
      {view === "list-signups" && (
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <button onClick={() => setView("lists")} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
              <ArrowLeft className="h-3.5 w-3.5" /> All lists
            </button>
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold">Signed-up podcasters</span>
              <Badge>{signupContacts.length}</Badge>
            </div>
            <Button size="sm" className="gap-1.5 ml-auto" onClick={() => openCompose("signups")}>
              <Mail className="h-3.5 w-3.5" /> Email this list
            </Button>
          </div>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
            <Input
              placeholder="Search name or email…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          <Card>
            <CardContent className="p-0">
              {loadingSignups ? (
                <div className="p-4 flex flex-col gap-2">{[1,2,3,4,5].map((i) => <Skeleton key={i} className="h-10" />)}</div>
              ) : filteredSignups.length === 0 ? (
                <p className="p-4 text-sm text-muted-foreground">{search ? "No matches." : "No one has signed up yet."}</p>
              ) : (
                <div className="divide-y">
                  {filteredSignups.map((c, i) => (
                    <button
                      key={i}
                      onClick={() => setSelectedContact({ email: c.email, firstName: c.firstName, lastName: "" })}
                      className="w-full flex items-center gap-3 px-4 py-3 hover:bg-muted/50 text-left transition-colors"
                    >
                      <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                        <span className="text-xs font-bold text-primary">{(c.firstName || c.email)[0].toUpperCase()}</span>
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium truncate">{c.firstName || "—"}</p>
                        <p className="text-xs text-muted-foreground truncate">{c.email}</p>
                      </div>
                      <span className="shrink-0 text-xs px-2 py-0.5 rounded-full font-medium bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300">Signed up</span>
                    </button>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* ── CONTACTS: imported list view ── */}
      {view === "list-contacts" && (
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <button onClick={() => setView("lists")} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
              <ArrowLeft className="h-3.5 w-3.5" /> All lists
            </button>
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold">Imported contacts</span>
              <Badge variant="secondary">{activeContacts.length}</Badge>
            </div>
            <div className="flex gap-2 ml-auto">
              <Button size="sm" variant="outline" className="gap-1.5" onClick={() => { setView("lists"); setShowImport(true); }}>
                <Upload className="h-3.5 w-3.5" /> Import CSV
              </Button>
              <Button size="sm" className="gap-1.5" onClick={() => openCompose("contacts")}>
                <Mail className="h-3.5 w-3.5" /> Email this list
              </Button>
            </div>
          </div>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
            <Input
              placeholder="Search name or email…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          <Card>
            <CardContent className="p-0">
              {loadingContacts ? (
                <div className="p-4 flex flex-col gap-2">{[1,2,3,4,5].map((i) => <Skeleton key={i} className="h-10" />)}</div>
              ) : filteredContacts.length === 0 ? (
                <p className="p-4 text-sm text-muted-foreground">{search ? "No matches." : "No imported contacts yet — use Import CSV above."}</p>
              ) : (
                <div className="divide-y">
                  {filteredContacts.map((c) => (
                    <button
                      key={c.id}
                      onClick={() => setSelectedContact(c)}
                      className="w-full flex items-center gap-3 px-4 py-3 hover:bg-muted/50 text-left transition-colors"
                    >
                      <div className="h-8 w-8 rounded-full bg-secondary flex items-center justify-center shrink-0">
                        <span className="text-xs font-bold">{(c.firstName || c.email)[0].toUpperCase()}</span>
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium truncate">{[c.firstName, c.lastName].filter(Boolean).join(" ") || "—"}</p>
                        <p className="text-xs text-muted-foreground truncate">{c.email}</p>
                      </div>
                      <span className={`shrink-0 text-xs px-2 py-0.5 rounded-full font-medium ${LIFECYCLE_COLORS[c.lifecycleStage] ?? LIFECYCLE_COLORS.lead}`}>
                        {LIFECYCLE_LABELS[c.lifecycleStage] ?? c.lifecycleStage}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* ── CONTACTS: engagement filter view ── */}
      {view === "list-engagement" && engagementCtx && (
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <button onClick={() => setView("campaigns")} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
              <ArrowLeft className="h-3.5 w-3.5" /> Broadcasts
            </button>
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-sm font-semibold truncate">{engagementCtx.label}</span>
              {!loadingEngagement && <Badge variant="secondary">{engagementRecipients.length}</Badge>}
            </div>
            <Button
              size="sm"
              className="gap-1.5 ml-auto"
              disabled={engagementRecipients.length === 0}
              onClick={() => openCompose(`engagement:${engagementCtx.broadcastId}:${engagementCtx.type}`)}
            >
              <Mail className="h-3.5 w-3.5" /> Email these {engagementRecipients.length || "…"}
            </Button>
          </div>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
            <Input placeholder="Search name or email…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
          </div>
          <Card>
            <CardContent className="p-0">
              {loadingEngagement ? (
                <div className="p-4 flex flex-col gap-2">{[1,2,3,4,5].map((i) => <Skeleton key={i} className="h-10" />)}</div>
              ) : engagementRecipients.length === 0 ? (
                <p className="p-4 text-sm text-muted-foreground">No contacts in this group yet.</p>
              ) : (
                <div className="divide-y">
                  {engagementRecipients
                    .filter((c) => !search || c.email.includes(search.toLowerCase()) || `${c.firstName} ${c.lastName}`.toLowerCase().includes(search.toLowerCase()))
                    .map((c) => (
                    <button
                      key={c.email}
                      onClick={() => setSelectedContact(c)}
                      className="w-full flex items-center gap-3 px-4 py-3 hover:bg-muted/50 text-left transition-colors"
                    >
                      <div className="h-8 w-8 rounded-full bg-secondary flex items-center justify-center shrink-0">
                        <span className="text-xs font-bold">{(c.firstName || c.email)[0].toUpperCase()}</span>
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium truncate">{[c.firstName, c.lastName].filter(Boolean).join(" ") || "—"}</p>
                        <p className="text-xs text-muted-foreground truncate">{c.email}</p>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* ── BROADCASTS: list ── */}
      {view === "automation" && (
        <div className="flex flex-col gap-4">
          <BroadcastSubNav view={view} setView={setView} />
          <p className="text-sm text-muted-foreground">
            Everything a podcaster receives, in the order it reaches them.
          </p>

          <CadenceList
            event={event}
            cadenceBySource={cadenceBySource}
            onEdit={openEdit}
            onWrite={(source) => openCompose(undefined, source)}
            onSchedule={async (b, whenIso) => {
              // Only the date: the update route treats a missing scheduledFor
              // as "unschedule", and every other field is left as it is.
              await adminSend("PUT", `/api/admin/broadcasts/${b.id}`, { scheduledFor: whenIso });
              await queryClient.invalidateQueries({ queryKey: ["/api/admin/broadcasts", eventId] });
              toast({ title: "Scheduled ✓", description: `"${b.subject}" goes ${new Date(whenIso).toLocaleString(undefined, { weekday: "long", day: "numeric", month: "long", hour: "numeric", minute: "2-digit" })}.` });
            }}
          />
        </div>
      )}

      {/* ── ACTIVITY LOG ── */}
      {view === "activity" && (
        <div className="flex flex-col gap-4">
          <BroadcastSubNav view={view} setView={setView} />
          <ActivityLog broadcasts={broadcastList} eventId={eventId} onViewEngagement={openEngagementView} onSelectContact={setSelectedContact} />
        </div>
      )}

      {(view === "campaigns" || view === "templates") && (
        <div className="flex flex-col gap-4">
          <BroadcastSubNav view={view} setView={setView} />
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              {view === "templates" ? (
                <>
                  {templateBroadcasts.length} template{templateBroadcasts.length !== 1 ? "s" : ""} · copy to
                  start a campaign or an automation step from
                </>
              ) : (
                <>
                  {campaignBroadcasts.length} campaign{campaignBroadcasts.length !== 1 ? "s" : ""} · one email,
                  one send
                </>
              )}
            </p>
            <Button size="sm" className="gap-1.5" onClick={() => openCompose()}>
              <Plus className="h-4 w-4" /> {view === "templates" ? "New template" : "New campaign"}
            </Button>
          </div>

          {loadingBroadcasts ? (
            <div className="flex flex-col gap-2">{[1,2,3].map((i) => <Skeleton key={i} className="h-16" />)}</div>
          ) : broadcastList.length === 0 ? (
            <div className="rounded-xl border border-dashed p-10 text-center">
              <Mail className="h-8 w-8 mx-auto mb-3 text-muted-foreground/50" />
              <p className="font-medium text-sm">No broadcasts yet</p>
              <p className="text-xs text-muted-foreground mt-1 mb-4">Compose an email to signed-up podcasters or your imported contacts.</p>
              <Button size="sm" onClick={() => openCompose()} className="gap-1.5"><Plus className="h-3.5 w-3.5" /> New broadcast</Button>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {/* Inline send-confirmation banner */}
              {confirmBroadcast && (
                <div className="rounded-xl border-2 border-primary bg-primary/5 px-4 py-3.5 flex flex-col sm:flex-row sm:items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-sm">Ready to send?</p>
                    <p className="text-sm text-muted-foreground mt-0.5">
                      You're about to send <span className="font-medium text-foreground">"{confirmBroadcast.subject}"</span> to{" "}
                      <span className="font-medium text-foreground">{recipientCount(confirmBroadcast.segment) >= 0 ? `${recipientCount(confirmBroadcast.segment)} ` : ""}{segmentLabel(confirmBroadcast.segment)}</span>.
                      This cannot be undone.
                    </p>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <Button size="sm" disabled={bBusy} onClick={confirmAndSend} className="gap-1.5">
                      <Send className="h-3.5 w-3.5" /> Send now
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setConfirmBroadcast(null)}>Cancel</Button>
                  </div>
                </div>
              )}

              <SegmentPreview
                segment={previewSegment}
                eventId={eventId}
                label={previewSegment ? (SEGMENT_LABELS[previewSegment] ?? previewSegment) : ""}
                onClose={() => setPreviewSegment(null)}
              />

              {/* The tab decides the list. Sorting stays as it was — sent
                  and scheduled read forwards in time, drafts newest first,
                  because an unsent draft is a to-do and not a record. */}
              {orderedBroadcasts
                .filter((b) => (view === "templates" ? b.isTemplate : !b.isTemplate && b.source === "manual"))
                .map((b) => (
                <BroadcastCard
                  key={b.id}
                  b={b}
                  eventId={eventId}
                  onDuplicate={duplicateBroadcast}
                  onSetSource={setBroadcastSource}
                  onSetSegment={setBroadcastSegment}
                  onPreview={setPreviewSegment}
                  segmentOptions={segmentOptions}
                  dimmed={!!(confirmBroadcast && confirmBroadcast.id !== b.id)}
                  bBusy={bBusy}
                  recipientCount={recipientCount}
                  onEdit={openEdit}
                  onConfirm={setConfirmBroadcast}
                  onDelete={deleteBroadcast}
                  onViewEngagement={openEngagementView}
                />
                ))}
            </div>
          )}
        </div>
      )}

      {/* ── COMPOSE ── */}
      {view === "compose" && (
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-3">
            <button onClick={() => setView("campaigns")} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
              <ArrowLeft className="h-3.5 w-3.5" /> Broadcasts
            </button>
            <span className="text-sm font-semibold">{editingBroadcast ? "Edit draft" : "New broadcast"}</span>
            <div className="ml-auto flex rounded-md border overflow-hidden text-xs">
              <button
                type="button"
                onClick={() => setBShowPreview(false)}
                className={`px-3 py-1.5 font-medium transition-colors ${!bShowPreview ? "bg-primary text-primary-foreground" : "hover:bg-accent"}`}
              >Compose</button>
              <button
                type="button"
                onClick={() => setBShowPreview(true)}
                className={`px-3 py-1.5 font-medium transition-colors ${bShowPreview ? "bg-primary text-primary-foreground" : "hover:bg-accent"}`}
              >Preview</button>
            </div>
          </div>

          {bShowPreview ? (
            <div className="flex flex-col gap-3">
              <p className="text-xs text-muted-foreground">Preview — <code>{"{{First_Name}}"}</code> shown as "Friend"</p>
              <div className="border rounded-xl overflow-hidden max-w-[600px] shadow-sm">
                <div className="relative h-36 overflow-hidden">
                  <img
                    src={{ welcome: "/listeners-bg.jpg", podcasters: "/podcasters-bg.jpg", marathon: "/hero-3.jpg", schedule: "/agenda-bg.jpg" }[bBanner] ?? "/listeners-bg.jpg"}
                    alt=""
                    className="absolute inset-0 w-full h-full object-cover"
                  />
                  {(() => {
                    const previewMember = bSender.startsWith("member:") ? teamMembers.find((m) => m.id === Number(bSender.split(":")[1])) : null;
                    return (
                      <div className="absolute inset-0 flex flex-col justify-end p-6" style={{ background: "linear-gradient(135deg,rgba(5,56,119,0.90) 0%,rgba(5,56,119,0.60) 100%)" }}>
                        <p className="text-[#F0A71F] text-xs font-bold uppercase tracking-widest opacity-75">
                          {previewMember ? `${previewMember.name} · MilitaryVoice.ai` : "MilitaryVoice.ai"}
                        </p>
                      </div>
                    );
                  })()}
                </div>
                {(() => {
                  const previewMember = bSender.startsWith("member:") ? teamMembers.find((m) => m.id === Number(bSender.split(":")[1])) : null;
                  return (
                    <div className="bg-white p-6 flex flex-col gap-3 text-gray-800 text-sm">
                      <h2 className="text-xl font-bold text-gray-900">{bSubject.replace(/\{\{First_Name\}\}/gi, "Friend") || "Subject line"}</h2>
                      <div className="space-y-3">
                        <p>Hi Friend,</p>
                        {bBody.replace(/\{\{First_Name\}\}/gi, "Friend").split(/\n\n+/).map((para, i) => (
                          <p key={i}>{para}</p>
                        ))}
                      </div>
                      {previewMember && (
                        <div className="flex items-center gap-3 mt-4 pt-4 border-t border-gray-200">
                          {previewMember.photoUrl && <img src={previewMember.photoUrl} alt={previewMember.name} className="w-10 h-10 rounded-full object-cover flex-shrink-0" />}
                          <div>
                            <p className="font-semibold text-sm">{previewMember.name}</p>
                            <p className="text-xs text-gray-500">{previewMember.title}, MilitaryVoice.ai</p>
                          </div>
                        </div>
                      )}
                      <p className="text-xs text-gray-400 mt-2">Unsubscribe link appears here in the actual email.</p>
                    </div>
                  );
                })()}
              </div>
              <div className="flex gap-2">
                <Button type="button" variant="outline" onClick={() => setBShowPreview(false)}>Back to compose</Button>
                <Button type="button" variant="outline" disabled={bBusy || !editingBroadcast} onClick={sendTest} className="gap-1.5">
                  <Send className="h-3.5 w-3.5" /> Send test to me
                </Button>
              </div>
            </div>
          ) : (
          <Card>
            <CardContent className="pt-5">
              <form onSubmit={saveDraft} className="flex flex-col gap-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <Label className="mb-1.5 block">Send to</Label>
                    {bSegment.startsWith("engagement:") ? (
                      <div className="flex items-center gap-2">
                        <div className="flex-1 rounded-md border px-3 py-2 text-sm bg-muted/30 text-muted-foreground truncate">{segmentLabel(bSegment)}</div>
                        <Button type="button" size="sm" variant="ghost" className="h-9 text-xs" onClick={() => setBSegment("signups")}>Change</Button>
                      </div>
                    ) : (
                      <Select value={bSegment} onValueChange={setBSegment}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="signups">Signed-up podcasters ({signupContacts.length})</SelectItem>
                          <SelectItem value="contacts">Imported contacts ({activeContacts.length})</SelectItem>
                          {/* The recruitment audience: on the list, hasn't taken a
                              slot. Asking someone to sign up when they already
                              have is the fastest way to look like nobody's home. */}
                          <SelectItem value="not-signed-up">On the list, no slot yet ({notSignedUpCount})</SelectItem>
                          {/* Empties itself: the moment a link comes in and is
                              looked up, that person drops out, so this can be
                              sent again without nagging anyone who complied. */}
                          <SelectItem value="no-audience-link">Booked, but no social link on file</SelectItem>
                          <SelectItem value="all">Both — {signupContacts.length + activeContacts.length} total</SelectItem>
                        </SelectContent>
                      </Select>
                    )}
                  </div>
                  <div>
                    <Label className="mb-1.5 block">From</Label>
                    <Select value={bSender} onValueChange={setBSender}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="team">MilitaryVoice.ai Team</SelectItem>
                        {teamMembers.map((m) => (
                          <SelectItem key={m.id} value={`member:${m.id}`}>
                            {m.name} — {m.title}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div>
                  <Label className="mb-2 block">
                    Header image
                    <span className="ml-2 text-xs font-normal text-muted-foreground">
                      each one is the real file, cropped as it will arrive
                    </span>
                  </Label>
                  {/* The preview used to show /hero-3.jpg while the email sent
                      /email/studio.jpg — so what you picked was not what you
                      saw. Every tile now points at the file that actually
                      ships. */}
                  <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
                    {[
                      { key: "welcome", label: "Listeners", src: "/email/welcome.jpg" },
                      { key: "podcasters", label: "Podcasters", src: "/email/podcasters.jpg" },
                      { key: "marathon", label: "Studio", src: "/email/studio.jpg" },
                      { key: "conversation", label: "Conversation", src: "/email/conversation.jpg" },
                      { key: "desk", label: "Desk", src: "/email/desk.jpg" },
                      { key: "mic", label: "Microphone", src: "/email/mic.jpg" },
                      { key: "headphones", label: "Headphones", src: "/email/headphones.jpg" },
                      { key: "board", label: "Mixing board", src: "/email/board.jpg" },
                      { key: "schedule", label: "Agenda", src: "/email/schedule.jpg" },
                    ].map((t) => (
                      <button
                        key={t.key}
                        type="button"
                        onClick={() => setBBanner(t.key)}
                        className={`rounded-lg overflow-hidden border-2 transition-all ${bBanner === t.key ? "border-primary shadow-md" : "border-transparent hover:border-muted-foreground/30"}`}
                      >
                        <img src={t.src} alt={t.label} loading="lazy" className="h-16 w-full object-cover" />
                        <p className={`text-xs py-1.5 text-center font-medium ${bBanner === t.key ? "text-primary" : "text-muted-foreground"}`}>{t.label}</p>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Schedule send */}
                <div>
                  <Label className="mb-1.5 block">Schedule send <span className="text-muted-foreground font-normal">(optional — leave blank to save as draft)</span></Label>
                  <input
                    type="datetime-local"
                    value={bScheduledFor}
                    onChange={(e) => setBScheduledFor(e.target.value)}
                    min={new Date().toISOString().slice(0, 16)}
                    className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  />
                  {bScheduledFor && (
                    <p className="mt-1 text-xs text-muted-foreground">Will send automatically at {new Date(bScheduledFor).toLocaleString()}</p>
                  )}
                </div>

                {/* AI draft assistant */}
                {aiOpen ? (
                  <div className="rounded-xl border border-violet-200 bg-violet-50 dark:bg-violet-950/30 dark:border-violet-800 p-4 space-y-3">
                    <p className="text-sm font-semibold text-violet-800 dark:text-violet-300">✨ Draft with AI</p>
                    <p className="text-xs text-violet-700 dark:text-violet-400">Describe what you want to say and Claude will write the subject line and body for you.</p>
                    <Textarea
                      autoFocus
                      rows={3}
                      value={aiPrompt}
                      onChange={(e) => setAiPrompt(e.target.value)}
                      placeholder="Invite military podcasters to claim a slot for the October 5 Marathtathon. Keep it warm and personal. Mention it's one slot per show."
                      className="text-sm"
                    />
                    <div className="flex gap-2">
                      <Button type="button" size="sm" disabled={aiLoading || !aiPrompt.trim()} onClick={draftWithAI} className="gap-1.5 bg-violet-600 hover:bg-violet-700 text-white">
                        {aiLoading ? "Writing…" : "✨ Generate"}
                      </Button>
                      <Button type="button" size="sm" variant="ghost" onClick={() => { setAiOpen(false); setAiPrompt(""); }}>Cancel</Button>
                    </div>
                  </div>
                ) : (
                  <Button type="button" variant="outline" size="sm" className="gap-1.5 text-violet-700 border-violet-300 hover:bg-violet-50 dark:text-violet-400 dark:border-violet-700" onClick={() => setAiOpen(true)}>
                    ✨ Draft with AI
                  </Button>
                )}

                <div>
                  <Label className="mb-1.5 block">Subject line</Label>
                  <Input value={bSubject} onChange={(e) => setBSubject(e.target.value)} placeholder="You're invited to the Podcast Marathon" />
                </div>
                <div>
                  <Label className="mb-1.5 block">Body</Label>
                  {/* Edits the rendered email, stores the marker text the
                      send path already reads — so nothing about how these go
                      out changed, and every email already written still
                      opens. See RichBody for the conversion both ways. */}
                  <RichBody
                    value={bBody}
                    onChange={setBBody}
                    placeholder="Hi {{First_Name}}, …"
                  />
                  <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                    Highlight text and use the toolbar, or ⌘B for bold and ⌘K for a link. Type{" "}
                    <code className="rounded bg-muted px-1 py-0.5 font-mono">{"{{First_Name}}"}</code> anywhere to drop
                    in the recipient's first name. Unsubscribe link is added automatically.
                  </p>
                </div>
                {/* The real renderer, in an iframe. A preview built by a
                    second code path is a preview of something nobody gets. */}
                <EmailPreview subject={bSubject} bodyText={bBody} sender={bSender} banner={bBanner} />

                <div className="flex gap-2 flex-wrap pt-1">
                  <Button type="submit" disabled={bBusy || !bSubject.trim() || !bBody.trim()} className="gap-1.5">
                    Save draft
                  </Button>
                  <Button type="button" variant="outline" disabled={bBusy || !editingBroadcast} onClick={sendTest} className="gap-1.5">
                    <Send className="h-3.5 w-3.5" /> Send test to me
                  </Button>
                  <Button type="button" variant="outline" onClick={() => setView("campaigns")}>Cancel</Button>
                </div>
              </form>
            </CardContent>
          </Card>
          )}
        </div>
      )}
    </div>
  );
}

export default function Admin({ tab }: { tab?: string } = {}) {
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
  // The URL is the source of truth for which section is open, so /admin/finances
  // can be bookmarked, linked in a note, and reached with the back button —
  // the same thing the podcasters' dashboard got.
  const [, navigate] = useLocation();
  const slug = (tab ?? "").toLowerCase();
  // Checked against the level you are actually on: the two levels share "crm"
  // and "team", and only one of them has "rooms".
  const eventTab = EVENT_SECTION_KEYS.has(slug) ? slug : "overview";
  const topTab = TOP_SECTION_KEYS.has(slug) ? slug : "events";
  const setEventTab = (key: string) =>
    navigate(key === "overview" || key === "events" ? "/admin" : `/admin/${key}`);
  const [openRoomId, setOpenRoomId] = useState<number | null>(null);
  const openRoom = (id: number | null) => {
    if (id) {
      localStorage.setItem("mv_admin_studio", String(id));
    }
    setOpenRoomId(id);
  };
  const queryClientTop = useQueryClient();
  const { toast: toastTop } = useToast();
  /** Refresh everything that reads the event list or the featured event. */
  async function refreshEventQueries() {
    await Promise.all(
      ["/api/admin/events", "/api/admin/event", "/api/event", "/api/events", "/api/signups", "/api/sponsors"].map((k) =>
        queryClientTop.invalidateQueries({ queryKey: [k] }),
      ),
    );
  }

  async function setEventVisible(id: number, visible: boolean) {
    try {
      await adminSend("PUT", `/api/admin/events/${id}`, { visible } as UpdateEvent);
      await refreshEventQueries();
      toastTop({
        title: visible ? "Event is public" : "Event is hidden",
        description: visible
          ? "It's back in the events list and its own pages work again."
          : "It's out of the events list, and its landing page, agenda and watch page all 404 — a direct link won't reach it either.",
      });
    } catch (err) {
      toastTop({ title: "Couldn't change that", description: (err as Error).message, variant: "destructive" });
    }
  }

  async function setEventClosed(id: number, closed: boolean) {
    try {
      await adminSend("PUT", `/api/admin/events/${id}`, { closed } as UpdateEvent);
      await refreshEventQueries();
      toastTop({
        title: closed ? "Lineup closed" : "Lineup open",
        description: closed
          ? "Nobody can claim a slot, including one freed by a cancellation. The picker says so rather than offering a time."
          : "Slots can be claimed again. Anything a cancellation freed is back on the board.",
      });
    } catch (err) {
      toastTop({ title: "Couldn't change that", description: (err as Error).message, variant: "destructive" });
    }
  }

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
      {/* The public nav is for people deciding whether to take part. Somebody
          who is already signed in loses a whole band of screen to a row of
          links they will never press — so it shows only on the way in, the
          same rule the podcasters' dashboard follows. */}
      {!isAuthenticated && <NavBar />}
      {isLoading ? (
        <div className="mx-auto mt-16 max-w-sm px-4">
          <Skeleton className="h-48 w-full rounded-xl" />
        </div>
      ) : !isAuthenticated ? (
        <LoginCard />
      ) : (
        // Wider than it was: the rail spends ~13.5rem, and the run of show and
        // the CRM tables were already using every pixel of max-w-7xl.
        <div className="mx-auto max-w-[94rem] px-4 py-5 sm:px-6">
          {/* One line at the top: the mark, and who you are. "Admin dashboard"
              is gone — the rail below already says which section you are in,
              and the mark says which product. */}
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <Link href="/" className="shrink-0" title="Back to the public site" data-testid="link-admin-home">
              <LogoLockup className="h-8 w-auto" />
            </Link>
            <div className="flex min-w-0 items-center gap-2">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#053877]/10 text-xs font-bold text-[#053877] dark:bg-white/10 dark:text-white">
                {(admin?.name || admin?.email || "?").trim().charAt(0).toUpperCase()}
              </span>
              <span className="hidden min-w-0 sm:block">
                <span className="block truncate text-sm font-semibold">{admin?.name || admin?.email}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {admin?.isOwner ? "Owner" : "Admin"}
                </span>
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={logout}
                className="ml-1 shrink-0 gap-1.5 rounded-full"
                data-testid="button-admin-logout"
              >
                <LogOut className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Sign out</span>
              </Button>
            </div>
          </div>

          {selectedEventId && selectedEvent ? (
            <>
              <Tabs value={eventTab} onValueChange={setEventTab}>
                <div className="flex flex-col gap-4 lg:flex-row lg:gap-7">
                  <AdminNav
                    groups={EVENT_GROUPS}
                    value={eventTab}
                    onChange={setEventTab}
                    isMobile={isMobile}
                  />
                  <div className="min-w-0 flex-1">
                {/* The event header lives in the content column, not above the
                    whole shell: left-justified with the tiles it belongs to,
                    rather than floating over the rail. */}
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
                    {selectedEvent.isFeatured && selectedEvent.visible !== false && (
                      <Badge className="ml-3 bg-[#F0A71F] align-middle text-[#1a1200] hover:bg-[#F0A71F]">Live site</Badge>
                    )}
                  </h2>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <label
                    className={`flex items-center gap-2 rounded-full border border-border px-3 py-1.5 text-sm font-medium ${
                      selectedEvent.isFeatured ? "opacity-60" : ""
                    }`}
                    title={
                      selectedEvent.isFeatured
                        ? "The live-site event can't be hidden — the homepage follows it. Make another event live first."
                        : undefined
                    }
                  >
                    {/* Green for live. This is the one switch on the page whose
                        "on" state means the public can see something, and the
                        default navy read as off at a glance — worse still when
                        the live-site event locks it on and the disabled styling
                        greys it out. */}
                    <Switch
                      checked={selectedEvent.visible !== false}
                      disabled={selectedEvent.isFeatured}
                      onCheckedChange={(v) => setEventVisible(selectedEvent.id, v)}
                      className="data-[state=checked]:bg-[#1a9e5f] disabled:opacity-100 disabled:cursor-default"
                      data-testid="switch-event-visible"
                    />
                    <span className={selectedEvent.visible !== false ? "font-semibold text-[#15834f] dark:text-[#3ac486]" : "text-muted-foreground"}>
                      {selectedEvent.visible !== false ? "Public" : "Hidden"}
                    </span>
                  </label>
                  {/* Visible and closed answer different questions — whether
                      anyone can find it, and whether anyone can still get on
                      it. A full event stays public all the way through the
                      show; it just stops taking people. */}
                  <label className="flex items-center gap-2 rounded-full border border-border px-3 py-1.5 text-sm font-medium">
                    <Switch
                      checked={selectedEvent.closed === true}
                      onCheckedChange={(v) => setEventClosed(selectedEvent.id, v)}
                      className="data-[state=checked]:bg-[#ED1C24]"
                      data-testid="switch-event-closed"
                    />
                    <span className={selectedEvent.closed === true ? "font-semibold text-[#ED1C24]" : "text-muted-foreground"}>
                      {selectedEvent.closed === true ? "Lineup closed" : "Taking signups"}
                    </span>
                  </label>
                  {!selectedEvent.isFeatured && (
                    <Button variant="outline" size="sm" className="gap-1.5 rounded-full" onClick={() => makeLive(selectedEvent.id)} data-testid="button-make-live">
                      <Star className="h-3.5 w-3.5" /> Make this the live-site event
                    </Button>
                  )}
                </div>
              </div>
                <TabsContent value="overview" className="mt-2 lg:mt-0">
                  <EventOverview eventId={selectedEventId} event={selectedEvent} go={setEventTab} />
                </TabsContent>
                <TabsContent value="studio" className="mt-2 lg:mt-0">
                  <StudioConsole key={`ev-${selectedEventId}`} adminGet={adminGet} adminSend={adminSend} view="live" eventId={selectedEventId} kind="event" onLeave={() => setEventTab("overview")} />
                </TabsContent>
                <TabsContent value="clips" className="mt-2 lg:mt-0">
                  <AdminClips eventId={selectedEventId} adminGet={adminGet} adminSend={adminSend} />
                </TabsContent>
                <TabsContent value="run" className="mt-2 lg:mt-0">
                  <RunOfShow adminGet={adminGet} adminSend={adminSend} eventId={selectedEventId} />
                </TabsContent>
                <TabsContent value="team" className="mt-2 lg:mt-0">
                  <EventTeamPanel eventId={selectedEventId} />
                </TabsContent>
                <TabsContent value="promotion" className="mt-2 flex flex-col gap-12 lg:mt-0">
                  <RiccohImages event={selectedEvent} />
                  <RiccohPosts event={selectedEvent} />
                </TabsContent>
                <TabsContent value="finances" className="mt-2 lg:mt-0">
                  <FinancesCard event={selectedEvent} />
                </TabsContent>
                <TabsContent value="crm" className="mt-2 lg:mt-0">
                  <CrmEventPanel eventId={selectedEventId} event={selectedEvent} />
                </TabsContent>
                {/* These four used to be desktop-only, reachable on a phone
                    only by hunting for a tile on Overview. The rail lists
                    everything at every width, so they are simply here. */}
                <TabsContent value="setup" className="mt-2 lg:mt-0">
                  <EventSettingsCard eventId={selectedEventId} />
                </TabsContent>
                <TabsContent value="signups" className="mt-2 flex flex-col gap-8 lg:mt-0">
                  <SignupsCard eventId={selectedEventId} />
                  <AudienceFiguresPanel eventId={selectedEventId} />
                </TabsContent>
                <TabsContent value="sponsors" className="mt-2 flex flex-col gap-8 lg:mt-0">
                  <SponsorPackagesCard eventId={selectedEventId} />
                  <SponsorsCard eventId={selectedEventId} />
                </TabsContent>
                  </div>
                </div>
              </Tabs>
            </>
          ) : openRoomId ? (
            <RoomView roomId={openRoomId} onBack={() => openRoom(null)} />
          ) : (
            <Tabs value={topTab} onValueChange={setEventTab}>
              <div className="flex flex-col gap-4 lg:flex-row lg:gap-7">
                <AdminNav groups={TOP_GROUPS} value={topTab} onChange={setEventTab} isMobile={isMobile} />
                <div className="min-w-0 flex-1">
                  <TabsContent value="events" className="mt-2 flex flex-col gap-8 lg:mt-0">
                    <EventPicker onOpen={(id) => { setEventTab("overview"); pickEvent(id); }} />
                    <NewEventCard />
                  </TabsContent>
                  <TabsContent value="rooms" className="mt-2 lg:mt-0">
                    <RoomsPanel onOpen={openRoom} />
                  </TabsContent>
                  <TabsContent value="crm" className="mt-2 lg:mt-0">
                    <CrmPanel />
                  </TabsContent>
                  <TabsContent value="team" className="mt-2 lg:mt-0">
                    <TeamCard />
                  </TabsContent>
                </div>
              </div>
            </Tabs>
          )}
        </div>
      )}
    </div>
  );
}
