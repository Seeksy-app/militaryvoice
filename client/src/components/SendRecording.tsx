// Send us a recording (27 Nov 2026): a share link, an optional passcode and note, for one show. The team picks it
// up and brings it into the Library; the list underneath shows where each one is. The link and passcode are never
// shown back here (server/recordingIn.ts keeps them sealed).
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Link2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiRequest } from "@/lib/queryClient";

type Sent = { id: string; showId: number; site: string; note: string; status: "sent" | "picked" | "library"; createdAt: string };

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
const day = (iso: string) => { try { return new Date(iso).toLocaleDateString([], { month: "short", day: "numeric" }); } catch { return ""; } };

export function SendRecording({ showId }: { showId: number }) {
  const qc = useQueryClient();
  const key = ["/api/host/recordings-in", showId];
  const { data: sent = [] } = useQuery<Sent[]>({ queryKey: key, queryFn: async () => (await apiRequest("GET", `/api/host/recordings-in?showId=${showId}`)).json() });
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
      await apiRequest("POST", "/api/host/recordings-in", { showId, link, passcode, note });
      setLink(""); setPasscode(""); setNote("");
      setDone(true);
      void qc.invalidateQueries({ queryKey: key });
    } catch (e) {
      setErr((e as Error).message || "That didn't go through. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-2xl border border-border bg-card p-4 shadow-sm" data-testid="send-recording">
      <h2 className="flex items-center gap-2 text-sm font-semibold"><Link2 className="h-4 w-4 text-[#053877] dark:text-[#8fb5e8]" /> Send us a recording</h2>
      <p className="mt-0.5 text-xs text-muted-foreground [text-wrap:pretty]">Recorded on Zoom, or saved in Dropbox or Google Drive? Paste the share link and we'll bring it into your Library.</p>
      <form className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_170px]" onSubmit={(e) => { e.preventDefault(); void send(); }}>
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
              <span className="min-w-0 flex-1 truncate">{r.note || `${siteName(r.site)} recording`}<span className="text-xs text-muted-foreground"> · {r.note ? `${siteName(r.site)} · ` : ""}{day(r.createdAt)}</span></span>
              <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${STATUS[r.status].cls}`}>{STATUS[r.status].label}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
