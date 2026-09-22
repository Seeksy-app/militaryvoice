import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Linkedin, Mail, Phone, Trash2, ClipboardPaste, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { adminGet, adminSend } from "@/lib/adminApi";

export type SponsorLeadRow = {
  id: number;
  eventId: number;
  name: string;
  company: string;
  title: string;
  linkedin: string;
  email: string;
  phone: string;
  notes: string;
  status: string;
  owner: string;
  createdAt: string;
  updatedAt: string;
};

const STATUSES = ["new", "contacted", "in_talks", "sponsor", "passed"] as const;
const STATUS_LABEL: Record<string, string> = { new: "New", contacted: "Contacted", in_talks: "In talks", sponsor: "Sponsor", passed: "Passed" };
const STATUS_CLASS: Record<string, string> = {
  new: "bg-[#053877]/10 text-[#053877]",
  contacted: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  in_talks: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  sponsor: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  passed: "bg-muted text-muted-foreground",
};

/**
 * Turn whatever was pasted into a lead. A LinkedIn URL, a signature block, a
 * line of "Name, Company, email" — the fields it can find are filled, and
 * what it can't tell goes into notes so nothing pasted is lost.
 */
export function parseLead(raw: string): Partial<SponsorLeadRow> {
  const text = raw.trim();
  const out: Partial<SponsorLeadRow> = { notes: "" };
  const linkedin = text.match(/https?:\/\/(?:[a-z]{2,3}\.)?linkedin\.com\/[^\s)>,]+/i)?.[0] ?? "";
  const email = text.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/)?.[0] ?? "";
  const phone = text.match(/(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/)?.[0] ?? "";
  if (linkedin) {
    out.linkedin = linkedin;
    // /in/first-last-1234 → "First Last"
    const slug = linkedin.match(/linkedin\.com\/in\/([^/?#]+)/i)?.[1];
    if (slug) out.name = slug.replace(/-[a-z0-9]{5,}$/i, "").split("-").filter(Boolean).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
  }
  if (email) out.email = email;
  if (phone) out.phone = phone.trim();
  const lines = text.split(/\n+/).map((l) => l.trim()).filter((l) => l && !/linkedin\.com|@|^\+?[\d\s().-]{7,}$|^https?:\/\//i.test(l));
  // "Name, Company" or "Name - Company" on one line; otherwise the first
  // plain line is the name and the second the company or title.
  const first = lines[0] ?? "";
  const split = first.split(/\s*[,|·–—-]\s*|\s+at\s+/);
  if (!out.name && split[0]) out.name = split[0];
  if (split[1]) out.company = split[1];
  if (!out.company && lines[1] && /inc|llc|ltd|group|co\b|company|corp|media|network|studio|agency|bank|foundation|partners/i.test(lines[1])) out.company = lines[1];
  else if (!out.title && lines[1]) out.title = lines[1];
  if (!out.company && lines[2]) out.company = lines[2];
  const used = new Set([first, lines[1] ?? "", lines[2] ?? ""]);
  out.notes = text.split(/\n+/).map((l) => l.trim()).filter((l) => l && !used.has(l) && l !== linkedin && l !== email && l !== phone).join("\n");
  return out;
}

export function SponsorLeads({ eventId }: { eventId: number }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [paste, setPaste] = useState("");
  const [filter, setFilter] = useState<"open" | "all">("open");
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState<Partial<SponsorLeadRow>>({});

  const { data: leads = [], isLoading } = useQuery<SponsorLeadRow[]>({
    queryKey: ["/api/admin/sponsor-leads", eventId],
    queryFn: () => adminGet<SponsorLeadRow[]>(`/api/admin/sponsor-leads?eventId=${eventId}`),
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["/api/admin/sponsor-leads", eventId] });

  const add = useMutation({
    mutationFn: async (raw: string) => {
      const parsed = parseLead(raw);
      if (!parsed.name && !parsed.email && !parsed.linkedin) throw new Error("Couldn't find a name, an email or a LinkedIn link in that.");
      return adminSend("POST", "/api/admin/sponsor-leads", { eventId, ...parsed, owner: "Riccoh" }).then((r) => r.json());
    },
    onSuccess: (lead: SponsorLeadRow) => {
      setPaste("");
      refresh();
      toast({ title: "Lead added", description: `${lead.name || lead.email || lead.linkedin}${lead.company ? ` · ${lead.company}` : ""}` });
    },
    onError: (err: Error) => toast({ title: "Couldn't add that", description: err.message, variant: "destructive" }),
  });

  async function patch(id: number, fields: Partial<SponsorLeadRow>) {
    await adminSend("PATCH", `/api/admin/sponsor-leads/${id}`, fields);
    refresh();
  }
  async function remove(id: number) {
    if (!window.confirm("Remove this lead?")) return;
    await adminSend("DELETE", `/api/admin/sponsor-leads/${id}`);
    refresh();
  }

  const shown = useMemo(() => leads.filter((l) => filter === "all" || (l.status !== "sponsor" && l.status !== "passed")), [leads, filter]);
  const counts = useMemo(() => STATUSES.reduce((acc, s) => ({ ...acc, [s]: leads.filter((l) => l.status === s).length }), {} as Record<string, number>), [leads]);

  return (
    <div className="flex flex-col gap-4" data-testid="sponsor-leads">
      <div>
        <h3 className="text-base font-semibold">Leads for Riccoh</h3>
        <p className="text-sm text-muted-foreground">Paste a LinkedIn link, a signature, or "Name, Company, email". One paste, one lead.</p>
      </div>
      <div className="rounded-xl border border-dashed border-[#053877]/40 bg-[#053877]/[0.03] p-3">
        <Textarea
          value={paste}
          onChange={(e) => setPaste(e.target.value)}
          onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && paste.trim()) add.mutate(paste); }}
          rows={3}
          placeholder={"https://www.linkedin.com/in/jane-smith\nor\nJane Smith, Acme Outdoor, jane@acme.com"}
          className="resize-none bg-background text-sm"
          data-testid="sponsor-leads-paste"
        />
        <div className="mt-2 flex items-center justify-between gap-2">
          <span className="text-[11px] text-muted-foreground">⌘↵ adds it</span>
          <Button size="sm" className="gap-1.5 rounded-full bg-[#053877] text-white hover:bg-[#0a4a99]" disabled={!paste.trim() || add.isPending} onClick={() => add.mutate(paste)} data-testid="sponsor-leads-add">
            <ClipboardPaste className="h-3.5 w-3.5" /> Add lead
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1.5 text-[11px]">
          {STATUSES.map((s) => (
            <span key={s} className={`rounded-full px-2 py-0.5 font-medium ${STATUS_CLASS[s]}`}>{STATUS_LABEL[s]} {counts[s] ?? 0}</span>
          ))}
        </div>
        <button type="button" onClick={() => setFilter((f) => (f === "open" ? "all" : "open"))} className="text-xs text-muted-foreground hover:text-foreground">
          {filter === "open" ? "Show all" : "Open only"}
        </button>
      </div>

      {isLoading ? null : shown.length === 0 ? (
        <p className="text-sm text-muted-foreground">{leads.length === 0 ? "No leads yet. Paste the first one above." : "Nothing open. Show all to see sponsors and passes."}</p>
      ) : (
        <div className="flex flex-col gap-2">
          {shown.map((l) => (
            <div key={l.id} className="rounded-xl border border-border bg-card p-3" data-testid={`sponsor-lead-${l.id}`}>
              {editing === l.id ? (
                <div className="grid gap-2 sm:grid-cols-2">
                  <Input value={draft.name ?? ""} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} placeholder="Name" className="h-8 text-sm" />
                  <Input value={draft.company ?? ""} onChange={(e) => setDraft((d) => ({ ...d, company: e.target.value }))} placeholder="Company" className="h-8 text-sm" />
                  <Input value={draft.title ?? ""} onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))} placeholder="Title" className="h-8 text-sm" />
                  <Input value={draft.email ?? ""} onChange={(e) => setDraft((d) => ({ ...d, email: e.target.value }))} placeholder="Email" className="h-8 text-sm" />
                  <Input value={draft.phone ?? ""} onChange={(e) => setDraft((d) => ({ ...d, phone: e.target.value }))} placeholder="Phone" className="h-8 text-sm" />
                  <Input value={draft.linkedin ?? ""} onChange={(e) => setDraft((d) => ({ ...d, linkedin: e.target.value }))} placeholder="LinkedIn URL" className="h-8 text-sm" />
                  <Textarea value={draft.notes ?? ""} onChange={(e) => setDraft((d) => ({ ...d, notes: e.target.value }))} placeholder="Notes" rows={2} className="sm:col-span-2 text-sm" />
                  <div className="flex gap-2 sm:col-span-2">
                    <Button size="sm" className="h-7 text-xs" onClick={async () => { await patch(l.id, draft); setEditing(null); }}>Save</Button>
                    <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setEditing(null)}>Cancel</Button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">{l.name || l.email || "Lead"}{l.company ? <span className="font-normal text-muted-foreground"> · {l.company}</span> : null}</p>
                      {l.title && <p className="truncate text-xs text-muted-foreground">{l.title}</p>}
                    </div>
                    <select
                      value={l.status}
                      onChange={(e) => patch(l.id, { status: e.target.value })}
                      className={`shrink-0 rounded-full border-0 px-2 py-0.5 text-[11px] font-medium ${STATUS_CLASS[l.status] ?? ""}`}
                      data-testid={`sponsor-lead-status-${l.id}`}
                    >
                      {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
                    </select>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-3 text-xs">
                    {l.linkedin && <a href={l.linkedin} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[#053877] hover:underline"><Linkedin className="h-3.5 w-3.5" /> LinkedIn <ExternalLink className="h-3 w-3 opacity-60" /></a>}
                    {l.email && <a href={`mailto:${l.email}`} className="inline-flex items-center gap-1 text-[#053877] hover:underline"><Mail className="h-3.5 w-3.5" /> {l.email}</a>}
                    {l.phone && <span className="inline-flex items-center gap-1 text-muted-foreground"><Phone className="h-3.5 w-3.5" /> {l.phone}</span>}
                  </div>
                  {l.notes && <p className="mt-2 whitespace-pre-wrap text-xs text-muted-foreground">{l.notes}</p>}
                  <div className="mt-2 flex items-center justify-between text-[11px] text-muted-foreground">
                    <span>{l.owner} · added {new Date(l.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>
                    <span className="flex gap-2">
                      <button type="button" onClick={() => { setEditing(l.id); setDraft({ name: l.name, company: l.company, title: l.title, email: l.email, phone: l.phone, linkedin: l.linkedin, notes: l.notes }); }} className="hover:text-foreground">Edit</button>
                      <button type="button" onClick={() => remove(l.id)} className="inline-flex items-center gap-1 text-destructive/80 hover:text-destructive"><Trash2 className="h-3 w-3" /> Remove</button>
                    </span>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
