import { useEffect, useState } from "react";
import { Link } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Check, Download, Loader2, Plus, Send, Video, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { IconTile } from "@/components/ui/icon-tile";

interface ZoomState { configured: boolean; connected: boolean; zoomEmail: string; autoImport: boolean }
interface ZoomRec { meetingId: string; uuid: string; topic: string; startTime: string; durationMin: number; sizeBytes: number; importable: boolean; imported: boolean }

/**
 * Integrations → Zoom: connect it, and their cloud recordings come into the
 * Library — new ones on their own, past ones from a list.
 */
export function ZoomConnect({ row = false }: { row?: boolean } = {}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const zoom = useQuery<ZoomState>({ queryKey: ["/api/host/zoom"], queryFn: async () => (await apiRequest("GET", "/api/host/zoom")).json() });
  const [picking, setPicking] = useState(false);
  /** Added from Zoom's Marketplace: finish through Connect Zoom once we know who's here. */
  const [finish, setFinish] = useState(false);
  useEffect(() => {
    if (!finish || !zoom.data) return;
    setFinish(false);
    if (zoom.data.configured && !zoom.data.connected) window.location.href = "/api/host/zoom/connect";
  }, [finish, zoom.data]);

  // Back from Zoom's approval page.
  useEffect(() => {
    const url = new URL(window.location.href);
    const z = url.searchParams.get("zoom");
    if (!z) return;
    url.searchParams.delete("zoom");
    window.history.replaceState(null, "", url.pathname + url.search);
    const said: Record<string, { title: string; description?: string; variant?: "destructive" }> = {
      connected: { title: "Zoom is connected", description: "New cloud recordings will come into your Library." },
      declined: { title: "Zoom wasn't connected", description: "You can connect it any time." },
      expired: { title: "That took too long", description: "Press Connect Zoom again.", variant: "destructive" },
      failed: { title: "Zoom didn't connect", description: "Try again in a moment.", variant: "destructive" },
    };
    if (z === "finish") return setFinish(true);
    if (said[z]) toast(said[z]);
    if (z === "connected") void qc.invalidateQueries({ queryKey: ["/api/host/zoom"] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const auto = useMutation({
    mutationFn: async (on: boolean) => apiRequest("POST", "/api/host/zoom/auto", { on }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["/api/host/zoom"] }),
  });
  const disconnect = useMutation({
    mutationFn: async () => apiRequest("DELETE", "/api/host/zoom"),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["/api/host/zoom"] }); toast({ title: "Zoom disconnected" }); },
  });

  if (!zoom.data) return null;
  const z = zoom.data;
  return (
    <div className={row ? "px-5 py-3.5" : "mt-6 rounded-2xl border border-border bg-card p-5"} data-testid="zoom-connect">
      <div className="flex flex-wrap items-center gap-3.5">
        {/* Zoom's own blue, like the other brand marks in Integrations; the
            48px slot lines its name up with the rows around it. */}
        <IconTile icon={Video} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-foreground">Zoom</p>
          <p className="text-sm text-muted-foreground">
            {z.connected ? <>Connected as <span className="font-medium text-foreground">{z.zoomEmail || "your Zoom"}</span></> : "Your cloud recordings, into your Library, ready for Pōstify."}
            {" · "}
            <Link href="/help/zoom" className="font-medium text-primary hover:underline" data-testid="zoom-help-link">How it works</Link>
          </p>
        </div>
        {z.connected ? (
          /* One line: bring new ones in on their own, bring old ones in, or stop. */
          <div className="flex flex-wrap items-center gap-2">
            <label className="mr-1 flex cursor-pointer items-center gap-2 text-sm text-foreground" title="Each new cloud recording comes into your Library by itself">
              <Switch checked={z.autoImport} onCheckedChange={(v) => auto.mutate(v)} data-testid="zoom-auto" />
              Auto-import new
            </label>
            <Button variant="outline" size="sm" className="h-8 gap-1.5 rounded-full px-3.5 text-xs" onClick={() => setPicking(true)} data-testid="zoom-import-past"><Download className="h-3.5 w-3.5" /> Import past</Button>
            <Button variant="ghost" size="sm" className="h-8 rounded-full px-3 text-xs text-muted-foreground" onClick={() => disconnect.mutate()} disabled={disconnect.isPending}>Disconnect</Button>
          </div>
        ) : z.configured ? (
          <Button asChild size="sm" className="h-8 gap-2 rounded-full bg-[#0B5CFF] px-3.5 text-xs text-white hover:bg-[#0a4fe0]" data-testid="zoom-connect-button">
            <a href="/api/host/zoom/connect">Connect Zoom</a>
          </Button>
        ) : (
          <span className="rounded-full bg-muted px-3 py-1 text-xs font-medium text-muted-foreground">Coming soon</span>
        )}
      </div>
      <ZoomPicker open={picking} onOpenChange={setPicking} />
      {!z.connected && !row && <ImportLink />}
      {(z.connected || !row) && <EditorSend />}
    </div>
  );
}

/**
 * Send new recordings to my editor (7 Oct 2026): for a podcaster whose
 * production team adds the intro, outro and teaser. Each recording that comes
 * in by itself is emailed to them as a download link; no account needed.
 */
export function EditorSend() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const q = useQuery<{ on: boolean; emails: string[] }>({ queryKey: ["/api/host/editor-send"], queryFn: async () => (await apiRequest("GET", "/api/host/editor-send")).json() });
  const [emails, setEmails] = useState<string[] | null>(null);
  const [open, setOpen] = useState(false);
  const list = emails ?? (q.data?.emails.length ? q.data.emails : [""]);
  const save = useMutation({
    mutationFn: async (v: { on: boolean; emails: string[] }) => (await apiRequest("PUT", "/api/host/editor-send", v)).json(),
    onSuccess: (v: { on: boolean; emails: string[] }) => {
      qc.setQueryData(["/api/host/editor-send"], v);
      setEmails(null);
      setOpen(false);
      toast(v.on ? { title: "Your editor is set", description: `New recordings go to ${v.emails.join(", ")} as soon as they're in.` } : { title: "Stopped sending to your editor" });
    },
    onError: (e) => toast({ title: "Couldn't save that", description: (e as Error).message, variant: "destructive" }),
  });
  if (!q.data) return null;
  const on = q.data.on;
  const editing = open || (!on && emails !== null);
  const clean = list.map((e) => e.trim()).filter(Boolean);
  return (
    <div className="mt-3 rounded-xl border border-border bg-muted/30 p-3.5" data-testid="editor-send">
      <div className="flex flex-wrap items-center gap-3">
        <Send className="h-4 w-4 shrink-0 text-[#053877] dark:text-[#8ab4f8]" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-foreground">Send new recordings to my editor</p>
          <p className="text-xs text-muted-foreground">
            {on ? <>Going to <span className="font-medium text-foreground">{q.data.emails.join(", ")}</span>. They get a download link, no account needed, and replies come to you.</> : "Your editor gets each new recording by email, full quality, the moment it's in. No account needed."}
          </p>
        </div>
        <Switch
          checked={on || editing}
          onCheckedChange={(v) => { if (v) { setOpen(true); setEmails(list); } else if (on) save.mutate({ on: false, emails: q.data!.emails }); else { setOpen(false); setEmails(null); } }}
          data-testid="editor-send-switch"
        />
        {on && !open && <Button variant="ghost" size="sm" className="h-8 rounded-full px-3 text-xs" onClick={() => { setOpen(true); setEmails(q.data!.emails); }} data-testid="editor-send-edit">Change</Button>}
      </div>
      {editing && (
        <form className="mt-3 space-y-2" onSubmit={(e) => { e.preventDefault(); if (clean.length) save.mutate({ on: true, emails: clean }); }}>
          {list.map((v, i) => (
            <div key={i} className="flex items-center gap-2">
              <Input type="email" autoFocus={i === 0} value={v} onChange={(e) => setEmails(list.map((x, j) => (j === i ? e.target.value : x)))} placeholder="editor@theirstudio.com" className="h-9" data-testid={`editor-send-email-${i}`} />
              {list.length > 1 && <button type="button" onClick={() => setEmails(list.filter((_, j) => j !== i))} className="rounded-full p-1.5 text-muted-foreground hover:bg-muted" aria-label="Remove"><X className="h-4 w-4" /></button>}
            </div>
          ))}
          <div className="flex flex-wrap items-center gap-2">
            {list.length < 3 && <button type="button" onClick={() => setEmails([...list, ""])} className="inline-flex items-center gap-1 text-xs font-semibold text-[#053877] hover:underline dark:text-[#8ab4f8]"><Plus className="h-3.5 w-3.5" /> Add another editor</button>}
            <span className="flex-1" />
            <Button type="button" variant="ghost" size="sm" className="rounded-full" onClick={() => { setOpen(false); setEmails(null); }}>Cancel</Button>
            <Button type="submit" size="sm" disabled={!clean.length || save.isPending} className="rounded-full bg-[#053877] text-white hover:bg-[#0a4a99]" data-testid="editor-send-save">
              {save.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Save"}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}

/**
 * Automatic, without our own Zoom app: Zapier's Zoom "New Recording" trigger
 * posts each recording to the podcaster's personal import link.
 */
export function ImportLink({ bare = false }: { bare?: boolean } = {}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const link = useQuery<{ url: string }>({ queryKey: ["/api/host/import-link"], queryFn: async () => (await apiRequest("GET", "/api/host/import-link")).json() });
  const reset = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/host/import-link/reset")).json(),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["/api/host/import-link"] }); toast({ title: "New link made", description: "The old one stopped working. Update it in Zapier." }); },
  });
  const [copied, setCopied] = useState(false);
  const copy = () => link.data && navigator.clipboard.writeText(link.data.url).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); });
  return (
    <div id={bare ? undefined : "import-link"} className={bare ? "" : "mt-4 scroll-mt-24 border-t border-border pt-4"} data-testid="import-link">
      {!bare && <p className="text-sm font-semibold text-foreground">Make it automatic with Zapier</p>}
      {!bare && <p className="mt-0.5 text-sm text-muted-foreground">Each new Zoom cloud recording comes into your Library on its own. It takes about five minutes to set up, once.</p>}
      <div className={`${bare ? "" : "mt-3 "}flex flex-wrap items-center gap-2`}>
        <code className="min-w-0 flex-1 truncate rounded-lg border border-border bg-muted/50 px-3 py-2 text-xs" data-testid="import-link-url">{link.data?.url ?? "…"}</code>
        <Button size="sm" onClick={copy} disabled={!link.data} className="gap-1.5 rounded-full bg-[#053877] text-white hover:bg-[#0a4a99]" data-testid="import-link-copy">
          {copied ? <><Check className="h-3.5 w-3.5" /> Copied</> : "Copy your link"}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => reset.mutate()} disabled={reset.isPending} className="rounded-full text-muted-foreground">New link</Button>
      </div>
      <p className="mt-1 text-[11px] text-muted-foreground">Keep it private: anyone with it can add videos to your Library.</p>
      <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-sm text-foreground/85">
        <li>In <a href="https://zapier.com/app/zaps" target="_blank" rel="noreferrer" className="font-medium text-[#053877] underline-offset-2 hover:underline dark:text-[#8fb5e8]">Zapier</a>, make a new Zap. Trigger: <b>Zoom → New Recording</b>, and connect your Zoom.</li>
        <li>Action: <b>Webhooks by Zapier → POST</b>. URL: paste your link above. Payload type: <b>json</b>.</li>
        <li>Data: <b>url</b> = Recording Files Download Url, <b>file_type</b> = Recording Files File Type, <b>download_token</b> = Download Token, <b>title</b> = Topic, <b>start_time</b> = Start Time.</li>
        <li>Test it, then turn the Zap on. Your next cloud recording shows up in your Library as "Importing…", then it's ready.</li>
      </ol>
    </div>
  );
}

function ZoomPicker({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const recs = useQuery<ZoomRec[]>({ queryKey: ["/api/host/zoom/recordings"], queryFn: async () => (await apiRequest("GET", "/api/host/zoom/recordings")).json(), enabled: open });
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<string[]>([]);
  const bring = async (r: ZoomRec) => {
    setBusy(r.uuid);
    try {
      await apiRequest("POST", "/api/host/zoom/import", { uuid: r.uuid, meetingId: r.meetingId });
      setDone((d) => [...d, r.uuid]);
      void qc.invalidateQueries({ queryKey: ["/api/host/recordings"] });
      toast({ title: "Bringing it in", description: "It shows in your Library now and is ready in a few minutes." });
    } catch (e) {
      toast({ title: "Couldn't import that", description: (e as Error).message, variant: "destructive" });
    } finally {
      setBusy(null);
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Import from Zoom</DialogTitle>
          <DialogDescription>Your cloud recordings from the last 30 days. Each comes into your Library as its own episode.</DialogDescription>
        </DialogHeader>
        {recs.isLoading ? (
          <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : recs.error ? (
          <p className="text-sm text-destructive">{(recs.error as Error).message}</p>
        ) : !recs.data?.length ? (
          <p className="py-6 text-center text-sm text-muted-foreground">No cloud recordings in the last 30 days.</p>
        ) : (
          <ul className="divide-y divide-border">
            {recs.data.map((r) => {
              const inLib = r.imported || done.includes(r.uuid);
              return (
                <li key={r.uuid} className="flex items-center gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-foreground">{r.topic || "Zoom meeting"}</p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(r.startTime).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })} · {r.durationMin} min{r.sizeBytes ? ` · ${Math.round(r.sizeBytes / 1048576)} MB` : ""}
                    </p>
                  </div>
                  {inLib ? (
                    <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-600"><Check className="h-3.5 w-3.5" /> In your Library</span>
                  ) : r.importable ? (
                    <Button size="sm" variant="outline" className="rounded-full" disabled={busy !== null} onClick={() => void bring(r)}>
                      {busy === r.uuid ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Import"}
                    </Button>
                  ) : (
                    <span className="text-xs text-muted-foreground">No video</span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
