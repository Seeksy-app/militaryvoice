// Send us a recording (27 Nov 2026): a share link, an optional passcode and note, for one show. The team picks it
// up and brings it into the Library; the list underneath shows where each one is. The link and passcode are never
// shown back here (server/recordingIn.ts keeps them sealed).
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Link2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { apiRequest } from "@/lib/queryClient";

type Sent = { id: string; showId: number; site: string; note: string; publishDate: string; status: "sent" | "picked" | "library"; createdAt: string };

const STATUS: Record<Sent["status"], { label: string; cls: string }> = {
  sent: { label: "Sent", cls: "bg-muted text-muted-foreground" },
  picked: { label: "Picked up", cls: "bg-[#F0A71F]/15 text-[#8a5300] dark:text-[#f5c46b]" },
  library: { label: "In your Library", cls: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" },
};
/** zoom.us → Zoom, so the list reads like a person wrote it. */
export function siteName(site: string): string {
  const s = site.toLowerCase();
  if (/(^|\.)zoom\.us$/.test(s)) return "Zoom";
  if (/(^|\.)dropbox(usercontent)?\.com$/.test(s) || s === "db.tt") return "Dropbox";
  if (/^(drive|docs)\.google\.com$/.test(s)) return "Google Drive";
  if (/(^|\.)(onedrive\.live\.com|1drv\.ms|sharepoint\.com)$/.test(s)) return "OneDrive";
  if (/(^|\.)box\.com$/.test(s)) return "Box";
  if (/(^|\.)wetransfer\.com$|^we\.tl$/.test(s)) return "WeTransfer";
  if (/(^|\.)riverside\.fm$/.test(s)) return "Riverside";
  if (/(^|\.)streamyard\.com$/.test(s)) return "StreamYard";
  if (/(^|\.)(youtube\.com|youtu\.be)$/.test(s)) return "YouTube";
  return site;
}
const day = (iso: string) => { try { return new Date(/^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso}T12:00:00` : iso).toLocaleDateString([], { month: "short", day: "numeric" }); } catch { return ""; } };

/**
 * The Library's way in, beside Upload a video (Andrew, 27 Nov: "when we pull it from Zoom, aren't we going to put it in
 * the library"). Opens the form in a dialog; with no show given it asks which show when they have more than one.
 * New episode has its own way in (an option beside Import from an RSS feed).
 */
export function SendRecordingButton({ showId }: { showId?: number }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="inline-flex h-10 shrink-0 items-center gap-2 rounded-full border border-border bg-card px-4 text-[14px] font-semibold text-foreground hover:bg-muted" title="A Zoom, Dropbox or Google Drive share link. We bring it into your Library." data-testid="send-recording-open"><Link2 className="h-4 w-4" /> Send us a recording</button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="text-balance">Send us a recording</DialogTitle>
            <DialogDescription className="[text-wrap:pretty]">Recorded on Zoom, or saved in Dropbox or Google Drive? Paste the share link and we'll bring it into your Library.</DialogDescription>
          </DialogHeader>
          <SendRecording showId={showId} bare />
        </DialogContent>
      </Dialog>
    </>
  );
}

type ShowPick = { id: number; title: string; nextDate: string };

export function SendRecording({ showId, bare = false }: { /** One show (New episode); left out, the form asks which (the Library). */ showId?: number; /** In a dialog or panel: no card frame or heading of its own. */ bare?: boolean }) {
  const qc = useQueryClient();
  const key = ["/api/host/recordings-in", showId ?? "all"];
  const { data } = useQuery<{ sent: Sent[]; nextDate: string; shows?: ShowPick[] }>({ queryKey: key, queryFn: async () => (await apiRequest("GET", `/api/host/recordings-in${showId ? `?showId=${showId}` : ""}`)).json() });
  const sent = data?.sent ?? [];
  const shows = data?.shows ?? [];
  const [picked, setPicked] = useState<number | null>(null);
  const forShow = showId ?? picked ?? shows[0]?.id ?? 0;
  // The show's next release day when it keeps a steady rhythm (Andrew, 27 Nov): filled in, theirs to change.
  const nextDate = showId ? data?.nextDate ?? "" : shows.find((x) => x.id === forShow)?.nextDate ?? "";
  const [publishDate, setPublishDate] = useState("");
  const [touched, setTouched] = useState(false);
  useEffect(() => { if (!touched) setPublishDate(nextDate); }, [nextDate, touched]);
  const [link, setLink] = useState("");
  const [passcode, setPasscode] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState(false);

  const send = async () => {
    setErr("");
    setDone(false);
    if (!link.trim()) { setErr("Paste the share link first."); return; }
    setBusy(true);
    try {
      await apiRequest("POST", "/api/host/recordings-in", { showId: forShow, link, passcode, note, publishDate });
      setLink(""); setPasscode(""); setNote(""); setPublishDate(nextDate); setTouched(false);
      setDone(true);
      void qc.invalidateQueries({ queryKey: key });
    } catch (e) {
      setErr((e as Error).message || "That didn't go through. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={bare ? "" : "rounded-2xl border border-border bg-card p-4 shadow-sm"} data-testid="send-recording">
      {!bare && <>
        <h2 className="flex items-center gap-2 text-sm font-semibold"><Link2 className="h-4 w-4 text-[#053877] dark:text-[#8fb5e8]" /> Send us a recording</h2>
        <p className="mt-0.5 text-xs text-muted-foreground [text-wrap:pretty]">Recorded on Zoom, or saved in Dropbox or Google Drive? Paste the share link and we'll bring it into your Library.</p>
      </>}
      <form className={`${bare ? "" : "mt-3 "}grid gap-2 sm:grid-cols-[minmax(0,1fr)_170px]`} onSubmit={(e) => { e.preventDefault(); void send(); }}>
        {!showId && shows.length > 1 && (
          <label className="block sm:col-span-2">
            <span className="mb-1 block text-xs font-medium">Which show</span>
            <select value={forShow} onChange={(e) => setPicked(Number(e.target.value))} className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm" data-testid="send-recording-show">
              {shows.map((x) => <option key={x.id} value={x.id}>{x.title}</option>)}
            </select>
          </label>
        )}
        <label className="block">
          <span className="mb-1 block text-xs font-medium">Recording link</span>
          <Input value={link} onChange={(e) => setLink(e.target.value)} placeholder="Paste the share link" inputMode="url" autoComplete="off" spellCheck={false} className="h-9" data-testid="send-recording-link" />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium">Passcode <span className="font-normal text-muted-foreground">(optional)</span></span>
          <Input value={passcode} onChange={(e) => setPasscode(e.target.value)} placeholder="If it has one" autoComplete="off" spellCheck={false} className="h-9" data-testid="send-recording-passcode" />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium">Episode title or note <span className="font-normal text-muted-foreground">(optional)</span></span>
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Episode title, or a note for us" maxLength={300} className="h-9" data-testid="send-recording-note" />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium">Publish date</span>
          <Input type="date" value={publishDate} onChange={(e) => { setPublishDate(e.target.value); setTouched(true); }} className="h-9" aria-describedby="send-recording-date-hint" data-testid="send-recording-date" />
        </label>
        <p id="send-recording-date-hint" className="self-center text-xs text-muted-foreground [text-wrap:pretty]">{nextDate && publishDate === nextDate ? "When should it come out? We filled in your show's next release day. Change it if you like." : "When should it come out? Leave it empty if you're not sure yet."}</p>
        <div className="flex items-end">
          <Button type="submit" disabled={busy} className="h-9 w-full gap-1.5 rounded-lg bg-[#053877] text-white hover:bg-[#0a4a99]" data-testid="send-recording-send">{busy && <Loader2 className="h-4 w-4 animate-spin" />} Send recording</Button>
        </div>
      </form>
      {err && <p className="mt-2 text-xs font-medium text-destructive" role="alert">{err}</p>}
      {done && <p className="mt-2 flex items-center gap-1.5 text-sm font-medium text-emerald-700 dark:text-emerald-300" role="status" data-testid="send-recording-done"><Check className="h-4 w-4 shrink-0" /> Got it. We'll pick it up, and you'll see it here when it's in your Library.</p>}
      {sent.length > 0 && (
        <ul className="mt-3 divide-y divide-border border-t border-border" data-testid="send-recording-list">
          {sent.map((r) => (
            <li key={r.id} className="flex items-center gap-3 py-2 text-sm">
              <span className="min-w-0 flex-1"><span className="block truncate">{r.note || `${siteName(r.site)} recording`}</span><span className="block truncate text-xs text-muted-foreground">{r.note ? `${siteName(r.site)} · ` : ""}Sent {day(r.createdAt)}{r.publishDate ? ` · publishes ${day(r.publishDate)}` : ""}</span></span>
              <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${STATUS[r.status].cls}`}>{STATUS[r.status].label}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
