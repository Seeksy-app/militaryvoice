import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, Loader2, Plus, Radio, RefreshCw, Trash2, Video, Youtube } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

type Studio = { id: number; name: string; inviteLink: string; recording: { since: string } | null; live: { since: string; watchUrl: string } | null; youtube: boolean; youtubeOn: boolean; streams: { id: string; name: string; key: string; on: boolean }[]; ready: boolean; canRecord: boolean };
const say = (e: unknown) => ((e as Error).message ?? "").replace(/^\d+:\s*/, "").replace(/^\{"message":"|"\}$/g, "") || "Try again in a moment.";

/**
 * Studio: your own, any time. Record your podcast or just film something (it lands in
 * your Library for Pōstify), invite guests on a link, and go live to YouTube or any
 * streaming key. One button in, the rest is set once.
 */
export function StudioHome() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const q = useQuery<Studio>({ queryKey: ["/api/host/my-studio"], queryFn: async () => (await apiRequest("GET", "/api/host/my-studio")).json() });
  const [copied, setCopied] = useState(false);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ name: "", url: "", key: "" });
  const [busy, setBusy] = useState(false);
  const patch = async (body: Record<string, unknown>) => {
    setBusy(true);
    try { qc.setQueryData(["/api/host/my-studio"], await (await apiRequest("PATCH", "/api/host/my-studio", body)).json()); return true; }
    catch (e) { toast({ title: "Didn't save", description: say(e), variant: "destructive" }); return false; }
    finally { setBusy(false); }
  };
  if (q.isLoading || !q.data) return <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  const s = q.data;
  const card = "rounded-2xl border border-border bg-card p-5 shadow-sm";

  return (
    <div className="mx-auto max-w-3xl space-y-5" data-testid="studio-home">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Studio</h1>
        <p className="mt-1 text-sm text-muted-foreground">Your own studio, any time: record your podcast or just film something, with guests, and go live if you like. Recordings land in your Library, ready for Pōstify.</p>
      </div>

      <section className="flex flex-wrap items-center gap-4 rounded-2xl bg-[#04102b] p-6 text-white shadow-sm">
        <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-white/10"><Video className="h-7 w-7" /></span>
        <div className="min-w-0 flex-1">
          <p className="text-lg font-bold">{s.name}</p>
          <p className="text-sm text-white/70">{s.live ? "You're live now." : s.recording ? "Recording now." : "Check your camera and mic, then you're in."}</p>
        </div>
        <a href="/my-studio" className="inline-flex h-11 items-center gap-2 rounded-full bg-[#F0A71F] px-6 font-bold text-[#1a1200] hover:bg-[#f5b94a]" data-testid="studio-enter"><Radio className="h-5 w-5" /> Enter my studio</a>
      </section>

      <section className={card}>
        <p className="font-semibold">Invite a guest</p>
        <p className="mt-0.5 text-sm text-muted-foreground">Send them this link. They type their name and come straight in: no account needed.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Input readOnly value={s.inviteLink} className="min-w-0 flex-1 font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
          <Button type="button" onClick={() => void navigator.clipboard.writeText(s.inviteLink).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 2000); })} className="gap-1.5 rounded-full bg-[#053877] text-white hover:bg-[#0a4a99]" data-testid="studio-copy-invite">{copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}{copied ? "Copied" : "Copy link"}</Button>
          <Button type="button" variant="ghost" onClick={() => { if (window.confirm("Make a new link? The old one stops working.")) void patch({ newInvite: true }); }} disabled={busy} className="gap-1.5 rounded-full text-muted-foreground"><RefreshCw className="h-4 w-4" /> New link</Button>
        </div>
      </section>

      <section className={card}>
        <p className="font-semibold">When you go live</p>
        <p className="mt-0.5 text-sm text-muted-foreground">Go live streams your studio to everywhere switched on here, all at once.</p>
        <div className="mt-3 divide-y divide-border rounded-xl border border-border">
          <div className="flex items-center gap-3 px-3 py-2.5">
            <Youtube className="h-5 w-5 shrink-0 text-red-600" />
            <span className="min-w-0 flex-1 text-sm"><span className="font-medium">YouTube</span><span className="block text-xs text-muted-foreground">{s.youtube ? "A new live video on your channel each time" : "Not connected yet"}</span></span>
            {s.youtube ? <Switch checked={s.youtubeOn} onCheckedChange={(v) => void patch({ youtubeOn: v })} disabled={busy} data-testid="studio-youtube-on" /> : <a href="/host/dashboard/integrations" className="text-sm font-semibold text-[#053877] hover:underline dark:text-white">Connect YouTube</a>}
          </div>
          {s.streams.map((x) => (
            <div key={x.id} className="flex items-center gap-3 px-3 py-2.5">
              <Radio className="h-5 w-5 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 text-sm"><span className="font-medium">{x.name}</span><span className="block truncate text-xs text-muted-foreground">Key {x.key || "in the address"}</span></span>
              <Switch checked={x.on} onCheckedChange={() => void patch({ toggleStream: x.id })} disabled={busy} />
              <button type="button" onClick={() => { if (window.confirm(`Remove ${x.name}?`)) void patch({ removeStream: x.id }); }} className="rounded p-1 text-muted-foreground hover:text-destructive" aria-label="Remove"><Trash2 className="h-4 w-4" /></button>
            </div>
          ))}
        </div>
        {adding ? (
          <div className="mt-3 grid gap-2 rounded-xl border border-border p-3 sm:grid-cols-3">
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Name, e.g. Facebook" />
            <Input value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} placeholder="Server (rtmp://…)" />
            <Input value={form.key} onChange={(e) => setForm({ ...form, key: e.target.value })} placeholder="Stream key" type="password" />
            <div className="flex gap-2 sm:col-span-3">
              <Button type="button" onClick={async () => { if (await patch({ addStream: form })) { setAdding(false); setForm({ name: "", url: "", key: "" }); } }} disabled={busy || !form.url.trim()} className="rounded-full bg-[#053877] text-white hover:bg-[#0a4a99]">Add</Button>
              <Button type="button" variant="ghost" onClick={() => setAdding(false)}>Cancel</Button>
            </div>
            <p className="text-xs text-muted-foreground sm:col-span-3">Facebook, LinkedIn, Twitch, Kick and most others give you a server and a stream key in their "Live" or "Stream" settings.</p>
          </div>
        ) : (
          <Button type="button" variant="outline" size="sm" onClick={() => setAdding(true)} className="mt-3 gap-1.5 rounded-full" data-testid="studio-add-stream"><Plus className="h-4 w-4" /> Add a streaming key</Button>
        )}
      </section>
    </div>
  );
}
