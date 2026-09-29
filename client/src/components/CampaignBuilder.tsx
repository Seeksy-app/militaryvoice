import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft, ArrowDown, ArrowUp, Check, CircleAlert, GripVertical, Heading2, Image as ImageIcon, Loader2, Minus, Monitor,
  MousePointerClick, Quote, Send, Smartphone, Sparkles, Trash2, Type, Upload, CalendarClock, Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, SelectGroup, SelectLabel } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { RichBody } from "@/components/RichBody";
import { adminGet, adminSend } from "@/lib/adminApi";

/**
 * The campaign builder: blocks on the left, the real email on the right.
 *
 * Blocks are only a way of editing: they are written out as the same marked-up
 * text every campaign already stores (## heading, ![picture](url),
 * [[Button]](url), ---, > quote), so the send path, the scheduler and every
 * email written before this all work unchanged.
 */

type Block =
  | { id: string; type: "text"; text: string }
  | { id: string; type: "heading"; text: string }
  | { id: string; type: "image"; src: string; alt: string }
  | { id: string; type: "button"; label: string; href: string }
  | { id: string; type: "quote"; text: string }
  | { id: string; type: "divider" };
type BlockType = Block["type"];

type Member = { id: number; name: string; title: string; photoUrl: string };
/** The fields of a campaign (broadcasts row) the builder reads. */
type BroadcastRow = { id: number; subject: string; bodyText: string; segment: string; sender: string | null; banner: string | null; status: string; scheduledFor: string | null; preheader?: string; isTemplate?: boolean };
type SegmentOption = { value: string; label: string; count: number };

let seq = 0;
const nid = () => `b${Date.now().toString(36)}${(seq++).toString(36)}`;

const HEAD = /^\s*#{2,3}\s+(.*)$/;
const IMG = /^\s*!\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)\s*$/;
const BTN = /^\s*\[\[([^\]]+)\]\]\((https?:\/\/[^\s)]+)\)\s*$/;
const RULE = /^\s*-{3,}\s*$/;

/** Stored text → blocks. Paragraphs in a row stay one text block. */
export function toBlocks(body: string): Block[] {
  const out: Block[] = [];
  for (const chunk of body.split(/\n{2,}/).map((c) => c.trim()).filter(Boolean)) {
    const lines = chunk.split("\n");
    const one = lines.length === 1 ? lines[0] : "";
    let b: Block | null = null;
    if (one && RULE.test(one)) b = { id: nid(), type: "divider" };
    else if (one && HEAD.test(one)) b = { id: nid(), type: "heading", text: one.match(HEAD)![1].trim() };
    else if (one && IMG.test(one)) { const [, alt, src] = one.match(IMG)!; b = { id: nid(), type: "image", src, alt }; }
    else if (one && BTN.test(one)) { const [, label, href] = one.match(BTN)!; b = { id: nid(), type: "button", label, href }; }
    else if (lines.every((l) => /^\s*>/.test(l))) b = { id: nid(), type: "quote", text: lines.map((l) => l.replace(/^\s*>\s?/, "")).join("\n") };
    if (b) { out.push(b); continue; }
    const last = out[out.length - 1];
    if (last?.type === "text") last.text = `${last.text}\n\n${chunk}`;
    else out.push({ id: nid(), type: "text", text: chunk });
  }
  return out;
}

/** Blocks → the stored text. Half-filled pictures and buttons are left out rather than sent broken. */
export function fromBlocks(blocks: Block[]): string {
  return blocks
    .map((b) => {
      switch (b.type) {
        case "text": return b.text.trim();
        case "heading": return b.text.trim() ? `## ${b.text.trim()}` : "";
        case "image": return /^https?:\/\//.test(b.src) ? `![${b.alt.replace(/[[\]]/g, "")}](${b.src.trim()})` : "";
        case "button": return b.label.trim() && /^https?:\/\//.test(b.href.trim()) ? `[[${b.label.trim().replace(/[[\]]/g, "")}]](${b.href.trim()})` : "";
        case "quote": return b.text.trim() ? b.text.trim().split("\n").map((l) => `> ${l}`).join("\n") : "";
        case "divider": return "---";
      }
    })
    .filter(Boolean)
    .join("\n\n");
}

const BLOCK_KINDS: { type: BlockType; label: string; icon: typeof Type }[] = [
  { type: "text", label: "Text", icon: Type },
  { type: "heading", label: "Heading", icon: Heading2 },
  { type: "image", label: "Picture", icon: ImageIcon },
  { type: "button", label: "Button", icon: MousePointerClick },
  { type: "quote", label: "Callout", icon: Quote },
  { type: "divider", label: "Divider", icon: Minus },
];
const blank = (type: BlockType): Block =>
  type === "text" ? { id: nid(), type, text: "" }
  : type === "heading" ? { id: nid(), type, text: "" }
  : type === "image" ? { id: nid(), type, src: "", alt: "" }
  : type === "button" ? { id: nid(), type, label: "", href: "https://www.militaryvoices.ai" }
  : type === "quote" ? { id: nid(), type, text: "" }
  : { id: nid(), type: "divider" };

/** What an inbox shows when there's no preview text: the first words, marks and links taken out. */
const inboxSnippet = (body: string) =>
  body.replace(/\{\{First_Name\}\}/gi, "Sam").replace(/\((https?:\/\/[^\s)]+)\)/g, "").replace(/^\s*-{3,}\s*$/gm, "").replace(/[#>*_[\]!]/g, "").replace(/\s+/g, " ").trim().slice(0, 140);

/** Ready-made layouts for a blank campaign. */
const STARTERS: { key: string; label: string; blurb: string; subject: string; preheader: string; body: string }[] = [
  {
    key: "note", label: "Personal note", blurb: "Just words, like a letter from a person.",
    subject: "", preheader: "",
    body: "Hi {{First_Name}},\n\n",
  },
  {
    key: "announce", label: "Announcement", blurb: "A headline, a few lines and one button.",
    subject: "", preheader: "",
    body: "## Big news\n\nHi {{First_Name}},\n\nTell them what's happening and why it matters to them.\n\n[[Find out more]](https://www.militaryvoices.ai)",
  },
  {
    key: "newsletter", label: "Newsletter", blurb: "A picture and two stories, each with a link.",
    subject: "", preheader: "",
    body: "## This month at MilitaryVoices\n\nHi {{First_Name}},\n\nA line or two to open.\n\n---\n\n## First story\n\nWhat happened, in a few sentences.\n\n[[Read more]](https://www.militaryvoices.ai)\n\n---\n\n## Second story\n\nAnother few sentences.\n\n> One thing worth remembering from this month.",
  },
];

const BANNERS = [
  { key: "welcome", label: "Listeners", src: "/email/welcome.jpg" },
  { key: "podcasters", label: "Podcasters", src: "/email/podcasters.jpg" },
  { key: "marathon", label: "Studio", src: "/email/studio.jpg" },
  { key: "conversation", label: "Conversation", src: "/email/conversation.jpg" },
  { key: "desk", label: "Desk", src: "/email/desk.jpg" },
  { key: "mic", label: "Microphone", src: "/email/mic.jpg" },
  { key: "headphones", label: "Headphones", src: "/email/headphones.jpg" },
  { key: "board", label: "Mixing board", src: "/email/board.jpg" },
  { key: "schedule", label: "Agenda", src: "/email/schedule.jpg" },
];

async function uploadImage(file: File): Promise<string> {
  const signed = (await (await adminSend("POST", "/api/admin/media/upload-url", { fileName: file.name, contentType: file.type, size: file.size })).json()) as { uploadUrl: string; publicUrl?: string };
  if (!signed.publicUrl) throw new Error("That file is too big for an email picture.");
  const r = await fetch(signed.uploadUrl, { method: "PUT", headers: { "content-type": file.type || "application/octet-stream" }, body: file });
  if (!r.ok) throw new Error(`Upload failed (${r.status}).`);
  return signed.publicUrl;
}

/** One email of an automation: the same editor, saved to its step, with no audience or send. */
export type StepDraft = { subject: string; preheader: string; sender: string; banner: string; bodyText: string };
export type StepMode = { back: string; onSave: (d: StepDraft) => Promise<void>; onTest: (d: StepDraft) => Promise<{ ok: boolean; to: string }> };

export function CampaignBuilder({ eventId, initial, source, initialSegment, segmentOptions, teamMembers, onClose, step }: {
  eventId: number;
  initial: BroadcastRow | null;
  source?: string;
  initialSegment?: string;
  segmentOptions: SegmentOption[];
  teamMembers: Member[];
  onClose: () => void;
  step?: StepMode;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [saved, setSaved] = useState<BroadcastRow | null>(initial);
  const [subject, setSubject] = useState(initial?.subject ?? "");
  const [preheader, setPreheader] = useState(initial?.preheader ?? "");
  const [segment, setSegment] = useState(initial?.segment ?? initialSegment ?? "signups");
  const [sender, setSender] = useState(initial?.sender ?? "team");
  const [banner, setBanner] = useState(initial?.banner ?? "welcome");
  const [blocks, setBlocks] = useState<Block[]>(() => toBlocks(initial?.bodyText ?? ""));
  const [device, setDevice] = useState<"phone" | "desktop">("desktop");
  const [busy, setBusy] = useState<string | null>(null);
  const [review, setReview] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiPrompt, setAiPrompt] = useState("");
  const body = useMemo(() => fromBlocks(blocks), [blocks]);
  const started = blocks.length > 0 || !!initial;

  const tags = useQuery<{ tag: string; count: number }[]>({ queryKey: ["/api/admin/contact-tags"], queryFn: () => adminGet("/api/admin/contact-tags") });
  const templates = useQuery<BroadcastRow[]>({ queryKey: ["/api/admin/broadcasts", eventId], queryFn: () => adminGet(`/api/admin/broadcasts?eventId=${eventId}`) });
  const audience = useQuery<{ count: number; people: { email: string; firstName: string }[] }>({
    enabled: !step,
    queryKey: ["/api/admin/segment-preview", segment, eventId],
    queryFn: () => adminGet(`/api/admin/segment-preview?segment=${encodeURIComponent(segment)}&eventId=${eventId}`),
  });

  // The real renderer, a moment after typing stops.
  const [html, setHtml] = useState("");
  useEffect(() => {
    let off = false;
    const t = window.setTimeout(async () => {
      try {
        const r = await adminSend("POST", "/api/admin/broadcasts/preview", { subject, bodyText: body || " ", sender, banner, preheader });
        const h = await r.text();
        if (!off) setHtml(h);
      } catch { /* keeps the last good preview */ }
    }, 450);
    return () => { off = true; window.clearTimeout(t); };
  }, [subject, body, sender, banner, preheader]);

  const update = (id: string, patch: Partial<Block>) => setBlocks((bs) => bs.map((b) => (b.id === id ? ({ ...b, ...patch } as Block) : b)));
  const remove = (id: string) => setBlocks((bs) => bs.filter((b) => b.id !== id));
  const move = (from: number, to: number) => setBlocks((bs) => {
    if (to < 0 || to >= bs.length || from === to) return bs;
    const next = bs.slice();
    const [b] = next.splice(from, 1);
    next.splice(to, 0, b);
    return next;
  });
  const add = (type: BlockType, at?: number) => setBlocks((bs) => { const next = bs.slice(); next.splice(at ?? bs.length, 0, blank(type)); return next; });

  const drag = useRef<number | null>(null);
  const [over, setOver] = useState<number | null>(null);

  const senderName = sender.startsWith("member:") ? `${teamMembers.find((m) => `member:${m.id}` === sender)?.name ?? "Team"} | MilitaryVoices.ai` : "MilitaryVoices.ai";
  const segLabel = segment.startsWith("tag:") ? `Tagged “${segment.slice(4)}”` : segmentOptions.find((o) => o.value === segment)?.label ?? segment;
  const count = audience.data?.count;

  // What stands between this and a good send.
  const problems: string[] = [];
  const hints: string[] = [];
  if (!subject.trim()) problems.push("Write a subject line.");
  if (!body.trim()) problems.push("Add something to the email.");
  if (!step && count === 0) problems.push("Nobody is in this audience yet.");
  if (blocks.some((b) => b.type === "button" && (!b.label.trim() || !/^https?:\/\/\S+\.\S+/.test(b.href.trim())))) problems.push("A button needs words and a link starting https://.");
  if (blocks.some((b) => b.type === "image" && !b.src)) problems.push("A picture block is empty.");
  if (/\{\{(?!First_Name\}\}|Slot_Time\}\}|Remind_Me_Later\}\})[^}]*\}\}/i.test(`${subject}\n${body}`)) problems.push("There's a {{…}} the email can't fill in. Only {{First_Name}} works here.");
  if (!preheader.trim()) hints.push("Add preview text: it's the grey line after the subject in the inbox.");
  if (subject.length > 60) hints.push("Subject is long; phones cut it at about 40 characters.");
  if (!/\{\{First_Name\}\}/i.test(body)) hints.push("Say their name: type {{First_Name}} in a text block.");

  async function save(opts: { scheduledFor?: string | null; quiet?: boolean } = {}): Promise<BroadcastRow | null> {
    if (!subject.trim() || !body.trim()) {
      toast({ title: "Add a subject and some words first", variant: "destructive" });
      return null;
    }
    if (step) {
      await step.onSave({ subject: subject.trim(), preheader, sender, banner, bodyText: body });
      if (!opts.quiet) toast({ title: "Saved" });
      return { ...(initial as BroadcastRow), subject, bodyText: body };
    }
    const payload = { subject: subject.trim(), bodyText: body, segment, sender, banner, preheader, scheduledFor: opts.scheduledFor ?? null };
    const row: BroadcastRow = saved
      ? await adminSend("PUT", `/api/admin/broadcasts/${saved.id}`, payload).then((r) => r.json())
      : await adminSend("POST", "/api/admin/broadcasts", { ...payload, eventId, ...(source ? { source } : {}) }).then((r) => r.json());
    setSaved(row);
    await qc.invalidateQueries({ queryKey: ["/api/admin/broadcasts", eventId] });
    if (!opts.quiet) toast({ title: "Saved" });
    return row;
  }
  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    try { await fn(); } catch (e) { toast({ title: "That didn't work", description: (e as Error).message, variant: "destructive" }); } finally { setBusy(null); }
  };

  const sendTest = () => run("test", async () => {
    const row = await save({ quiet: true });
    if (!row) return;
    const r: { ok: boolean; to: string } = step
      ? await step.onTest({ subject: subject.trim(), preheader, sender, banner, bodyText: body })
      : await adminSend("POST", `/api/admin/broadcasts/${row.id}/test?eventId=${eventId}`).then((x) => x.json());
    toast(r.ok ? { title: "Test sent", description: `Check ${r.to}.` } : { title: "Test not sent", description: `The mail provider refused it. Nothing reached ${r.to}.`, variant: "destructive" });
  });

  const draftWithAI = () => run("ai", async () => {
    const r: { subject: string; body: string } = await adminSend("POST", "/api/admin/ai/draft-email", { prompt: aiPrompt }).then((x) => x.json());
    if (r.subject) setSubject(r.subject);
    setBlocks(toBlocks(r.body ?? ""));
    setAiOpen(false);
    setAiPrompt("");
  });

  const startFrom = (bodyText: string, subj = "", pre = "") => { setBlocks(toBlocks(bodyText)); if (subj) setSubject(subj); if (pre) setPreheader(pre); };
  const savedTemplates = (templates.data ?? []).filter((b) => b.isTemplate);

  return (
    <div className="flex flex-col gap-4" data-testid="campaign-builder">
      {/* One bar: back, what this is, and the three things you do with it. */}
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={onClose} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground" data-testid="builder-back"><ArrowLeft className="h-4 w-4" /> {step?.back ?? "Campaigns"}</button>
        <span className="min-w-0 truncate text-sm font-semibold">{subject.trim() || (initial ? "Edit campaign" : "New campaign")}</span>
        {saved?.status === "scheduled" && saved.scheduledFor && <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-400">Scheduled {new Date(saved.scheduledFor).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span>}
        <div className="ml-auto flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => void run("save", async () => { await save(); })} disabled={busy !== null} className="gap-1.5 rounded-full" data-testid="builder-save">{busy === "save" && <Loader2 className="h-3.5 w-3.5 animate-spin" />}Save</Button>
          <Button variant="outline" size="sm" onClick={sendTest} disabled={busy !== null || !subject.trim() || !body.trim()} className="gap-1.5 rounded-full" data-testid="builder-test">{busy === "test" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}Send me a test</Button>
          {!step && <Button size="sm" onClick={() => setReview(true)} disabled={busy !== null} className="gap-1.5 rounded-full bg-[#053877] text-white hover:bg-[#0a4a99]" data-testid="builder-review">Review &amp; send</Button>}
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        {/* Left: the settings, then the blocks. */}
        <div className="flex min-w-0 flex-col gap-4">
          <section className="rounded-2xl border border-border bg-card p-4 shadow-sm">
            <div className={`grid gap-3 ${step ? "" : "sm:grid-cols-2"}`}>
              {!step && <label className="block">
                <span className="mb-1 block text-xs font-medium text-muted-foreground">To</span>
                <Select value={segment} onValueChange={setSegment}>
                  <SelectTrigger data-testid="builder-to"><SelectValue>{segLabel}</SelectValue></SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectLabel>Lists</SelectLabel>
                      {segmentOptions.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}{o.count >= 0 ? ` (${o.count})` : ""}</SelectItem>)}
                    </SelectGroup>
                    {(tags.data ?? []).length > 0 && (
                      <SelectGroup>
                        <SelectLabel>Tags</SelectLabel>
                        {(tags.data ?? []).map((t) => <SelectItem key={t.tag} value={`tag:${t.tag}`}>Tagged “{t.tag}” ({t.count})</SelectItem>)}
                      </SelectGroup>
                    )}
                  </SelectContent>
                </Select>
                <span className="mt-1 flex items-center gap-1 text-xs text-muted-foreground"><Users className="h-3 w-3" />{audience.isFetching ? "Counting…" : count === undefined ? "" : `${count} ${count === 1 ? "person" : "people"}, unsubscribed left out`}</span>
              </label>}
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-muted-foreground">From</span>
                <Select value={sender} onValueChange={setSender}>
                  <SelectTrigger data-testid="builder-from"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="team">MilitaryVoices.ai Team</SelectItem>
                    {teamMembers.map((m) => <SelectItem key={m.id} value={`member:${m.id}`}>{m.name} ({m.title})</SelectItem>)}
                  </SelectContent>
                </Select>
              </label>
            </div>
            <label className="mt-3 block">
              <span className="mb-1 flex justify-between text-xs font-medium text-muted-foreground"><span>Subject</span><span className={subject.length > 60 ? "text-amber-600" : ""}>{subject.length}/60</span></span>
              <Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="What's in it for them, in a few words" data-testid="builder-subject" />
            </label>
            <label className="mt-3 block">
              <span className="mb-1 block text-xs font-medium text-muted-foreground">Preview text <span className="font-normal">(the grey line after the subject in the inbox)</span></span>
              <Input value={preheader} onChange={(e) => setPreheader(e.target.value.slice(0, 200))} placeholder="Finish the thought the subject starts" data-testid="builder-preheader" />
            </label>
            <div className="mt-3">
              <span className="mb-1 block text-xs font-medium text-muted-foreground">Header picture</span>
              <div className="flex gap-2 overflow-x-auto pb-1">
                {BANNERS.map((t) => (
                  <button key={t.key} type="button" onClick={() => setBanner(t.key)} title={t.label} className={`shrink-0 overflow-hidden rounded-lg border-2 ${banner === t.key ? "border-[#053877]" : "border-transparent opacity-80 hover:opacity-100"}`} data-testid={`builder-banner-${t.key}`}>
                    <img src={t.src} alt={t.label} loading="lazy" className="h-12 w-20 object-cover" />
                  </button>
                ))}
              </div>
            </div>
          </section>

          {!started ? (
            <section className="rounded-2xl border border-border bg-card p-4 shadow-sm" data-testid="builder-start">
              <p className="text-sm font-semibold">Start from</p>
              <div className="mt-3 grid gap-2 sm:grid-cols-3">
                {STARTERS.map((s) => (
                  <button key={s.key} type="button" onClick={() => startFrom(s.body, s.subject, s.preheader)} className="rounded-xl border border-border p-3 text-left hover:border-[#053877] hover:bg-accent" data-testid={`builder-starter-${s.key}`}>
                    <span className="block text-sm font-semibold">{s.label}</span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">{s.blurb}</span>
                  </button>
                ))}
              </div>
              {savedTemplates.length > 0 && (
                <>
                  <p className="mt-4 text-xs font-medium text-muted-foreground">Your templates</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {savedTemplates.slice(0, 12).map((t) => (
                      <button key={t.id} type="button" onClick={() => startFrom(t.bodyText, t.subject, t.preheader ?? "")} className="rounded-full border border-border px-3 py-1.5 text-sm hover:border-[#053877] hover:bg-accent">{t.subject}</button>
                    ))}
                  </div>
                </>
              )}
              <button type="button" onClick={() => setAiOpen(true)} className="mt-4 flex items-center gap-1.5 text-sm font-medium text-violet-700 hover:underline dark:text-violet-400" data-testid="builder-ai-start"><Sparkles className="h-4 w-4" /> Or have AI write it</button>
            </section>
          ) : (
            <section className="flex flex-col gap-2" data-testid="builder-blocks">
              {blocks.map((b, i) => (
                <div
                  key={b.id}
                  onDragOver={(e) => { if (drag.current === null) return; e.preventDefault(); setOver(i); }}
                  onDrop={(e) => { e.preventDefault(); if (drag.current !== null) move(drag.current, i); drag.current = null; setOver(null); }}
                  className={`group rounded-2xl border bg-card p-3 shadow-sm transition-colors ${over === i ? "border-[#053877]" : "border-border"}`}
                  data-testid={`block-${b.type}`}
                >
                  <div className="mb-2 flex items-center gap-1 text-xs font-medium text-muted-foreground">
                    <span
                      draggable
                      onDragStart={(e) => { drag.current = i; e.dataTransfer.effectAllowed = "move"; }}
                      onDragEnd={() => { drag.current = null; setOver(null); }}
                      className="cursor-grab rounded p-0.5 hover:bg-muted active:cursor-grabbing"
                      title="Drag to move"
                    ><GripVertical className="h-4 w-4" /></span>
                    {BLOCK_KINDS.find((k) => k.type === b.type)?.label}
                    <span className="ml-auto flex items-center gap-0.5">
                      <button type="button" onClick={() => move(i, i - 1)} disabled={i === 0} className="rounded p-1 hover:bg-muted disabled:opacity-30" aria-label="Move up"><ArrowUp className="h-3.5 w-3.5" /></button>
                      <button type="button" onClick={() => move(i, i + 1)} disabled={i === blocks.length - 1} className="rounded p-1 hover:bg-muted disabled:opacity-30" aria-label="Move down"><ArrowDown className="h-3.5 w-3.5" /></button>
                      <button type="button" onClick={() => remove(b.id)} className="rounded p-1 hover:bg-destructive/10 hover:text-destructive" aria-label="Remove"><Trash2 className="h-3.5 w-3.5" /></button>
                    </span>
                  </div>
                  <BlockEditor block={b} onChange={(p) => update(b.id, p)} />
                </div>
              ))}
              <div className="rounded-2xl border border-dashed border-border p-3" data-testid="builder-add">
                <p className="mb-2 text-xs font-medium text-muted-foreground">Add a block</p>
                <div className="flex flex-wrap gap-2">
                  {BLOCK_KINDS.map((k) => (
                    <button key={k.type} type="button" onClick={() => add(k.type)} className="flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-sm hover:border-[#053877] hover:bg-accent" data-testid={`add-${k.type}`}><k.icon className="h-4 w-4" />{k.label}</button>
                  ))}
                  <button type="button" onClick={() => setAiOpen(true)} className="flex items-center gap-1.5 rounded-full border border-violet-300 px-3 py-1.5 text-sm text-violet-700 hover:bg-violet-50 dark:border-violet-700 dark:text-violet-400 dark:hover:bg-violet-950/30" data-testid="builder-ai"><Sparkles className="h-4 w-4" />Rewrite with AI</button>
                </div>
              </div>
            </section>
          )}
        </div>

        {/* Right: the inbox line and the email, as they'll arrive. */}
        <div className="min-w-0 lg:sticky lg:top-4 lg:self-start">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-xs font-medium text-muted-foreground">Preview, with {"{{First_Name}}"} as “Sam”</p>
            <div className="inline-flex rounded-full border border-border bg-card p-0.5">
              {(["phone", "desktop"] as const).map((d) => (
                <button key={d} type="button" onClick={() => setDevice(d)} className={`flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium ${device === d ? "bg-[#053877] text-white" : "text-muted-foreground"}`} data-testid={`preview-${d}`}>
                  {d === "phone" ? <Smartphone className="h-3.5 w-3.5" /> : <Monitor className="h-3.5 w-3.5" />}{d === "phone" ? "Phone" : "Computer"}
                </button>
              ))}
            </div>
          </div>
          <div className="rounded-2xl border border-border bg-muted/40 p-3">
            <div className={`mx-auto transition-all ${device === "phone" ? "max-w-[375px]" : "max-w-full"}`}>
              <div className="mb-2 rounded-xl border border-border bg-card px-3 py-2 text-sm" data-testid="inbox-row">
                <div className="flex justify-between gap-2"><span className="truncate font-semibold">{senderName}</span><span className="shrink-0 text-xs text-muted-foreground">now</span></div>
                <div className="truncate font-medium">{subject.replace(/\{\{First_Name\}\}/gi, "Sam") || <span className="text-muted-foreground">Subject</span>}</div>
                <div className="truncate text-xs text-muted-foreground">{preheader.replace(/\{\{First_Name\}\}/gi, "Sam") || inboxSnippet(body)}</div>
              </div>
              {html ? (
                <iframe title="Email preview" srcDoc={html} sandbox="" className={`w-full rounded-lg border border-border bg-white ${device === "phone" ? "h-[640px]" : "h-[720px]"}`} data-testid="builder-preview" />
              ) : (
                <div className="flex h-[480px] items-center justify-center rounded-lg bg-white"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
              )}
            </div>
          </div>
        </div>
      </div>

      <Dialog open={aiOpen} onOpenChange={setAiOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Have AI write it</DialogTitle>
            <DialogDescription>Say who it's for and what you want them to do. It writes the subject and the email; you edit from there.</DialogDescription>
          </DialogHeader>
          <Textarea autoFocus rows={4} value={aiPrompt} onChange={(e) => setAiPrompt(e.target.value)} placeholder="Invite military podcasters to claim a slot on October 5. Warm and short, one button to sign up." />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setAiOpen(false)}>Cancel</Button>
            <Button onClick={draftWithAI} disabled={busy !== null || !aiPrompt.trim()} className="gap-1.5 bg-violet-600 text-white hover:bg-violet-700">{busy === "ai" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}Write it</Button>
          </div>
        </DialogContent>
      </Dialog>

      <ReviewDialog
        open={review}
        onOpenChange={setReview}
        problems={problems}
        hints={hints}
        count={count}
        people={audience.data?.people ?? []}
        segLabel={segLabel}
        senderName={senderName}
        subject={subject}
        busy={busy}
        initialWhen={saved?.scheduledFor ? saved.scheduledFor.slice(0, 16) : ""}
        onTest={sendTest}
        onSchedule={(iso) => run("schedule", async () => {
          const row = await save({ scheduledFor: iso, quiet: true });
          if (!row) return;
          toast({ title: iso ? "Scheduled" : "Back to a draft", description: iso ? `Goes out ${new Date(iso).toLocaleString()}.` : undefined });
          setReview(false);
          if (iso) onClose();
        })}
        onSendNow={() => run("send", async () => {
          const row = await save({ quiet: true });
          if (!row) return;
          const r: { sent: number; failed: number } = await adminSend("POST", `/api/admin/broadcasts/${row.id}/send?eventId=${eventId}`).then((x) => x.json());
          await qc.invalidateQueries({ queryKey: ["/api/admin/broadcasts", eventId] });
          toast({ title: `Sent to ${r.sent}`, description: r.failed ? `${r.failed} didn't go.` : "Opens and clicks show on the campaign as they come in." });
          setReview(false);
          onClose();
        })}
      />
    </div>
  );
}

function BlockEditor({ block: b, onChange }: { block: Block; onChange: (p: Partial<Block>) => void }) {
  const { toast } = useToast();
  const [uploading, setUploading] = useState(false);
  switch (b.type) {
    case "text":
      return <RichBody value={b.text} onChange={(text) => onChange({ text })} placeholder="Write here. Type {{First_Name}} for their name." />;
    case "heading":
      return <Input value={b.text} onChange={(e) => onChange({ text: e.target.value })} placeholder="A heading" className="text-lg font-bold" />;
    case "quote":
      return <Textarea rows={2} value={b.text} onChange={(e) => onChange({ text: e.target.value })} placeholder="The one line people read when they read nothing else" />;
    case "divider":
      return <hr className="my-2 border-border" />;
    case "button":
      return (
        <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
          <Input value={b.label} onChange={(e) => onChange({ label: e.target.value })} placeholder="Button words, e.g. Claim my slot" />
          <Input value={b.href} onChange={(e) => onChange({ href: e.target.value })} placeholder="https://" inputMode="url" />
        </div>
      );
    case "image":
      return (
        <div className="flex flex-col gap-2">
          {b.src ? (
            <img src={b.src} alt={b.alt} className="max-h-48 w-full rounded-lg object-cover" />
          ) : (
            <label className="flex h-28 cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-border text-sm text-muted-foreground hover:border-[#053877] hover:text-foreground">
              {uploading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Upload className="h-5 w-5" />}
              {uploading ? "Uploading…" : "Choose a picture"}
              <input type="file" accept="image/png,image/jpeg,image/gif,image/webp" className="sr-only" onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                setUploading(true);
                try { onChange({ src: await uploadImage(f), alt: b.alt || f.name.replace(/\.[a-z0-9]+$/i, "").replace(/[-_]+/g, " ") }); }
                catch (err) { toast({ title: "Upload didn't work", description: (err as Error).message, variant: "destructive" }); }
                finally { setUploading(false); }
              }} />
            </label>
          )}
          <div className="grid gap-2 sm:grid-cols-2">
            <Input value={b.alt} onChange={(e) => onChange({ alt: e.target.value })} placeholder="What it shows (for screen readers)" />
            <Input value={b.src} onChange={(e) => onChange({ src: e.target.value.trim() })} placeholder="…or paste a picture link" inputMode="url" />
          </div>
        </div>
      );
  }
}

function ReviewDialog({ open, onOpenChange, problems, hints, count, people, segLabel, senderName, subject, busy, initialWhen, onTest, onSchedule, onSendNow }: {
  open: boolean; onOpenChange: (v: boolean) => void; problems: string[]; hints: string[]; count?: number; people: { email: string; firstName: string }[];
  segLabel: string; senderName: string; subject: string; busy: string | null; initialWhen: string;
  onTest: () => void; onSchedule: (iso: string | null) => void; onSendNow: () => void;
}) {
  const [when, setWhen] = useState<"now" | "later">(initialWhen ? "later" : "now");
  const [at, setAt] = useState(initialWhen);
  const [showPeople, setShowPeople] = useState(false);
  useEffect(() => { if (open) { setWhen(initialWhen ? "later" : "now"); setAt(initialWhen); setShowPeople(false); } }, [open, initialWhen]);
  const blocked = problems.length > 0;
  const n = count ?? 0;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Review &amp; send</DialogTitle>
          <DialogDescription className="sr-only">Check who it goes to and when, then send.</DialogDescription>
        </DialogHeader>
        <dl className="divide-y divide-border rounded-xl border border-border text-sm">
          <div className="flex gap-3 px-3 py-2"><dt className="w-16 shrink-0 text-muted-foreground">To</dt><dd className="min-w-0">{segLabel} · <button type="button" onClick={() => setShowPeople((v) => !v)} className="font-medium text-[#053877] hover:underline dark:text-white">{count === undefined ? "counting…" : `${n} ${n === 1 ? "person" : "people"}`}</button></dd></div>
          {showPeople && <div className="max-h-40 overflow-y-auto px-3 py-2 text-xs text-muted-foreground">{people.map((p) => <div key={p.email} className="truncate">{p.firstName ? `${p.firstName} · ` : ""}{p.email}</div>)}</div>}
          <div className="flex gap-3 px-3 py-2"><dt className="w-16 shrink-0 text-muted-foreground">From</dt><dd className="min-w-0 truncate">{senderName}</dd></div>
          <div className="flex gap-3 px-3 py-2"><dt className="w-16 shrink-0 text-muted-foreground">Subject</dt><dd className="min-w-0">{subject || "—"}</dd></div>
        </dl>
        {problems.length > 0 && (
          <ul className="space-y-1 rounded-xl bg-destructive/10 p-3 text-sm text-destructive">
            {problems.map((p) => <li key={p} className="flex gap-2"><CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />{p}</li>)}
          </ul>
        )}
        {hints.length > 0 && (
          <ul className="space-y-1 text-sm text-muted-foreground">
            {hints.map((p) => <li key={p} className="flex gap-2"><CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />{p}</li>)}
          </ul>
        )}
        {!blocked && hints.length === 0 && <p className="flex items-center gap-2 text-sm text-emerald-700 dark:text-emerald-400"><Check className="h-4 w-4" /> Everything looks good.</p>}
        <div className="inline-flex w-fit rounded-full border border-border p-0.5">
          <button type="button" onClick={() => setWhen("now")} className={`rounded-full px-4 py-1.5 text-sm font-medium ${when === "now" ? "bg-[#053877] text-white" : "text-muted-foreground"}`}>Send now</button>
          <button type="button" onClick={() => setWhen("later")} className={`flex items-center gap-1 rounded-full px-4 py-1.5 text-sm font-medium ${when === "later" ? "bg-[#053877] text-white" : "text-muted-foreground"}`}><CalendarClock className="h-4 w-4" />Schedule</button>
        </div>
        {when === "later" && (
          <input type="datetime-local" value={at} min={new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16)} onChange={(e) => setAt(e.target.value)} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" data-testid="review-when" />
        )}
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="outline" onClick={onTest} disabled={busy !== null} className="gap-1.5 rounded-full">{busy === "test" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}Send me a test</Button>
          {when === "now" ? (
            <Button onClick={onSendNow} disabled={blocked || busy !== null || !n} className="gap-1.5 rounded-full bg-[#053877] text-white hover:bg-[#0a4a99]" data-testid="review-send">{busy === "send" && <Loader2 className="h-4 w-4 animate-spin" />}Send to {n} now</Button>
          ) : (
            <Button onClick={() => onSchedule(at ? new Date(at).toISOString() : null)} disabled={blocked || busy !== null || !at} className="gap-1.5 rounded-full bg-[#053877] text-white hover:bg-[#0a4a99]" data-testid="review-schedule">{busy === "schedule" && <Loader2 className="h-4 w-4 animate-spin" />}Schedule for {at ? new Date(at).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "…"}</Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
