import "@livekit/components-styles";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { LiveKitRoom, PreJoin, VideoConference, type LocalUserChoices } from "@livekit/components-react";
import { ArrowLeft, Check, Circle, Copy, Loader2, Radio, Square } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

/**
 * Your room: quick, like Zoom. Check your camera and mic, then you're in.
 * The owner records to their Library, goes live to YouTube or their streaming
 * keys, and invites guests; a guest on the invite link just joins.
 */
type Studio = { you?: string; id: number; name: string; inviteLink: string; recording: { since: string } | null; live: { since: string; watchUrl: string } | null; youtube: boolean; youtubeOn: boolean; streams: { id: string; name: string; on: boolean }[]; ready: boolean; canRecord: boolean };

const say = (e: unknown) => ((e as Error).message ?? "").replace(/^\d+:\s*/, "").replace(/^\{"message":"|"\}$/g, "") || "Try again in a moment.";
const clock = (since: string, now: number) => { const s = Math.max(0, Math.floor((now - Date.parse(since)) / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };

export default function MyStudio({ invite }: { invite?: string }) {
  const owner = !invite;
  const [conn, setConn] = useState<{ url: string; token: string; name: string } | null>(null);
  const [choices, setChoices] = useState<LocalUserChoices | null>(null);
  const [error, setError] = useState("");
  const [left, setLeft] = useState(false);
  const guestInfo = useQuery<{ name: string }>({ queryKey: ["/api/my-studio/invite", invite], enabled: !owner, queryFn: async () => (await apiRequest("GET", `/api/my-studio/invite/${invite}`)).json(), retry: false });
  const studio = useQuery<Studio>({ queryKey: ["/api/host/my-studio"], enabled: owner, queryFn: async () => (await apiRequest("GET", "/api/host/my-studio")).json(), retry: false, refetchInterval: conn ? 8000 : false });

  const join = async (c: LocalUserChoices) => {
    setError("");
    try {
      const r = owner
        ? await apiRequest("POST", "/api/host/my-studio/token", { name: c.username })
        : await apiRequest("POST", `/api/my-studio/invite/${invite}/token`, { name: c.username });
      setChoices(c);
      setConn(await r.json());
    } catch (e) {
      setError((e as { status?: number }).status === 401 ? "Sign in to open your room." : say(e));
    }
  };

  const title = owner ? studio.data?.name : guestInfo.data?.name;
  if (left) {
    return (
      <div data-lk-theme="default" className="flex min-h-screen flex-col items-center justify-center gap-4 bg-[#04102b] p-6 text-center text-white">
        <p className="text-2xl font-bold">{owner ? "You've left your room" : "Thanks for joining"}</p>
        {owner ? (
          <div className="flex flex-wrap justify-center gap-3">
            <button type="button" onClick={() => { setLeft(false); setConn(null); }} className="rounded-full bg-white px-5 py-2.5 font-semibold text-[#04102b]">Go back in</button>
            <a href="/host/dashboard/library" className="rounded-full border border-white/30 px-5 py-2.5 font-semibold">Your Library</a>
          </div>
        ) : <p className="text-white/70">You can close this tab.</p>}
      </div>
    );
  }

  if (!conn) {
    const blocked = owner ? (studio.error ? "Sign in to open your room." : "") : guestInfo.error ? say(guestInfo.error) : "";
    return (
      <div data-lk-theme="default" className="flex min-h-screen flex-col items-center justify-center gap-5 bg-[#04102b] p-4 text-white">
        {owner && <a href="/host/dashboard/rooms" className="absolute left-4 top-4 flex items-center gap-1.5 text-sm text-white/70 hover:text-white"><ArrowLeft className="h-4 w-4" /> Room settings</a>}
        <div className="text-center">
          <p className="text-sm uppercase tracking-[0.12em] text-white/60">{owner ? "Your room" : "You're invited to"}</p>
          <h1 className="mt-1 text-2xl font-bold">{title || (owner ? "Your room" : "a room")}</h1>
          <p className="mt-1 text-sm text-white/60">Check your camera and microphone, then join.</p>
        </div>
        {blocked ? (
          <div className="rounded-2xl bg-white/10 p-5 text-center">
            <p>{blocked}</p>
            {owner && <a href="/host/dashboard/rooms" className="mt-3 inline-block rounded-full bg-white px-5 py-2 font-semibold text-[#04102b]">Sign in</a>}
          </div>
        ) : (
          <div className="w-full max-w-xl" data-testid="my-studio-prejoin">
            <PreJoin key={studio.data?.you ?? ""} defaults={{ username: owner ? studio.data?.you ?? "" : "" }} persistUserChoices={false} joinLabel={owner ? "Enter my room" : "Join"} userLabel="Your name" onSubmit={(c) => void join(c)} onError={(e) => setError(/permission/i.test(e.message) ? "Allow your camera and microphone for this site (the icon in the address bar), then reload." : e.message)} />
          </div>
        )}
        {error && <p className="max-w-md text-center text-sm text-red-300">{error}</p>}
      </div>
    );
  }

  return (
    <LiveKitRoom
      data-lk-theme="default"
      serverUrl={conn.url}
      token={conn.token}
      connect
      video={choices?.videoEnabled ? { deviceId: choices.videoDeviceId } : false}
      audio={choices?.audioEnabled ? { deviceId: choices.audioDeviceId } : false}
      onDisconnected={() => setLeft(true)}
      style={{ height: "100dvh", display: "flex", flexDirection: "column", background: "#04102b" }}
    >
      <TopBar owner={owner} name={conn.name} studio={studio.data} />
      <div className="min-h-0 flex-1"><VideoConference /></div>
    </LiveKitRoom>
  );
}

/** The owner's controls over the room: Record, Go live, Invite. A guest sees the name and any REC or LIVE. */
function TopBar({ owner, name, studio }: { owner: boolean; name: string; studio?: Studio }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [busy, setBusy] = useState<"" | "rec" | "live">("");
  const [copied, setCopied] = useState(false);
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(t); }, []);
  const act = async (k: "rec" | "live", path: string, on: boolean) => {
    if (k === "live" && !on && !window.confirm("End the live stream?")) return;
    setBusy(k);
    try {
      const s = (await (await apiRequest("POST", `/api/host/my-studio/${path}`, { on })).json()) as Studio;
      qc.setQueryData(["/api/host/my-studio"], s);
      if (k === "rec") toast(on ? { title: "Recording" } : { title: "Recording saved", description: "It's in your Library in a minute or two, ready for Pōstify." });
      if (k === "live" && on) toast({ title: "You're live", description: s.live?.watchUrl ? "On YouTube and any streaming keys that are on." : "On your streaming keys." });
    } catch (e) {
      toast({ title: k === "rec" ? "Couldn't record" : "Couldn't go live", description: say(e), variant: "destructive" });
    } finally { setBusy(""); }
  };
  const rec = studio?.recording;
  const live = studio?.live;
  const pill = "flex h-9 items-center gap-1.5 rounded-full px-4 text-sm font-semibold transition-colors disabled:opacity-60";
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-white/10 px-4 py-2 text-white" data-testid="my-studio-bar">
      <span className="mr-auto truncate text-sm font-semibold">{name}</span>
      {rec && <span className="flex items-center gap-1.5 text-sm font-semibold tabular-nums text-red-400"><Circle className="h-2.5 w-2.5 fill-current" /> REC {clock(rec.since, now)}</span>}
      {live && <span className="flex items-center gap-1.5 rounded bg-red-600 px-2 py-0.5 text-xs font-bold tabular-nums">LIVE {clock(live.since, now)}</span>}
      {owner && studio && (
        <>
          {studio.canRecord && (
            <button type="button" onClick={() => void act("rec", "record", !rec)} disabled={busy !== ""} className={`${pill} ${rec ? "bg-white text-[#04102b]" : "bg-red-600 hover:bg-red-500"}`} data-testid="my-studio-record">
              {busy === "rec" ? <Loader2 className="h-4 w-4 animate-spin" /> : rec ? <Square className="h-3.5 w-3.5 fill-current" /> : <Circle className="h-3.5 w-3.5 fill-current" />}{rec ? "Stop recording" : "Record"}
            </button>
          )}
          <button type="button" onClick={() => void act("live", "live", !live)} disabled={busy !== ""} className={`${pill} ${live ? "bg-white text-[#04102b]" : "border border-white/30 hover:bg-white/10"}`} title={live ? "" : studio.youtube && studio.youtubeOn ? "Goes live on your YouTube channel" : "Goes live on your streaming keys"} data-testid="my-studio-live">
            {busy === "live" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Radio className="h-4 w-4" />}{live ? "End live" : "Go live"}
          </button>
          {live?.watchUrl && <a href={live.watchUrl} target="_blank" rel="noreferrer" className="text-xs text-white/70 underline hover:text-white">Watch on YouTube</a>}
          <button type="button" onClick={() => { void navigator.clipboard.writeText(studio.inviteLink).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 2000); }); }} className={`${pill} border border-white/30 hover:bg-white/10`} data-testid="my-studio-invite">
            {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}{copied ? "Link copied" : "Invite a guest"}
          </button>
        </>
      )}
    </div>
  );
}
