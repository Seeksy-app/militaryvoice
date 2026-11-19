import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";

/**
 * "I'll stream in", in the Radio booth: a stream key for this booking, for a
 * host who produces in StreamYard, Restream or OBS. Their feed goes on air in
 * their live window like a booth camera. Sits on the booth's dark page.
 */
type Payload = {
  configured: boolean;
  key: { url: string; streamKey: string; arriving: boolean; problem: string; dead: boolean } | null;
  startAtUtc: string;
  onAirAtUtc: string;
  offAirAtUtc: string;
  opensAtUtc: string;
};

const et = (iso: string) => new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" }).format(new Date(iso));
const say = (e: unknown) => ((e as Error).message ?? "").replace(/^\d+:\s*/, "").replace(/^\{"message":"|"\}$/g, "") || "Try again in a moment.";

function Field({ label, value, secret }: { label: string; value: string; secret?: boolean }) {
  const [shown, setShown] = useState(!secret);
  const [copied, setCopied] = useState(false);
  return (
    <div className="text-left">
      <p className="text-xs font-semibold uppercase tracking-[0.08em] text-white/70">{label}</p>
      <div className="mt-1 flex items-center gap-2">
        <input readOnly value={shown ? value : "•".repeat(Math.min(value.length, 28))} onFocus={(e) => shown && e.currentTarget.select()} className="min-w-0 flex-1 rounded-lg border border-white/20 bg-black/30 px-3 py-2 font-mono text-xs text-white" aria-label={label} />
        {secret && <button type="button" onClick={() => setShown((v) => !v)} className="rounded-lg border border-white/20 px-3 py-2 text-xs text-white/80 hover:text-white">{shown ? "Hide" : "Show"}</button>}
        <button type="button" onClick={() => navigator.clipboard.writeText(value).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }, () => {})} className="rounded-lg bg-white px-3 py-2 text-xs font-semibold text-[#000741]">{copied ? "Copied" : "Copy"}</button>
      </div>
    </div>
  );
}

export function RadioStreamIn({ id }: { id: number | string }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const qk = ["/api/booth/stream-in", String(id)];
  const q = useQuery<Payload>({ queryKey: qk, queryFn: async () => (await apiRequest("GET", `/api/booth/${id}/stream-in`)).json(), retry: false, refetchInterval: open ? 5000 : false });
  const make = useMutation({
    mutationFn: async (renew: boolean) => (await apiRequest("POST", `/api/booth/${id}/stream-in`, { renew })).json(),
    onSuccess: (j) => { setError(""); qc.setQueryData(qk, j); setOpen(true); },
    onError: (e) => setError(say(e)),
  });
  const end = useMutation({
    mutationFn: async () => apiRequest("POST", `/api/booth/${id}/end`, {}),
    onSuccess: () => setError(""),
    onError: (e) => setError(say(e)),
  });
  // Only the host (or an admin) sees this; the server says so with a 401 for anyone else.
  if (q.isError || (q.data && !q.data.configured)) return null;
  const d = q.data;
  const k = d?.key ?? null;

  return (
    <div className="w-full max-w-xl rounded-2xl border border-white/15 bg-white/5 p-5 text-center" data-testid="radio-stream-in">
      {!open && !k ? (
        <>
          <p className="text-sm text-white/80">Produce your show in StreamYard, Restream or OBS?</p>
          <button type="button" onClick={() => make.mutate(false)} disabled={make.isPending} className="mt-2 rounded-full border border-white/40 px-5 py-2 text-sm font-semibold text-white hover:bg-white/10 disabled:opacity-60" data-testid="button-radio-stream-in">{make.isPending ? "Setting up…" : "I'll stream in instead"}</button>
        </>
      ) : (
        <div className="flex flex-col gap-4">
          <p className="text-base font-semibold">Stream in from your own software</p>
          {k?.problem && <p className="rounded-xl border border-red-300/40 bg-red-500/15 p-3 text-sm text-red-100">{k.problem}</p>}
          {k && !k.dead && (
            <>
              <Field label="Server URL" value={k.url} />
              <Field label="Stream key" value={k.streamKey} secret />
              <p className="text-sm text-white/80" data-testid="radio-stream-in-status">{k.arriving ? "Your stream is arriving. We'll put you on air at " + et(d!.onAirAtUtc) + " ET." : "Waiting for your stream."}</p>
            </>
          )}
          {(!k || k.dead) && <button type="button" onClick={() => make.mutate(true)} disabled={make.isPending} className="mx-auto rounded-full bg-white px-5 py-2 text-sm font-semibold text-[#000741] disabled:opacity-60">{make.isPending ? "Setting up…" : "Make a new key"}</button>}
          <ol className="list-decimal space-y-1 pl-5 text-left text-sm text-white/80">
            <li>In StreamYard, choose Destinations, then Custom RTMP. In OBS, set Settings, Stream, Service to Custom.</li>
            <li>Paste the Server URL and the Stream key, and start streaming any time from {et(d?.opensAtUtc ?? "")} ET.</li>
            <li>You're on air {d ? `${et(d.onAirAtUtc)}–${et(d.offAirAtUtc)} ET` : ""}. Keep streaming until we say thank you, and use End my show here if you finish early.</li>
          </ol>
          {d && Date.now() >= Date.parse(d.onAirAtUtc) && Date.now() < Date.parse(d.offAirAtUtc) && (
            <button type="button" onClick={() => end.mutate()} disabled={end.isPending || end.isSuccess} className="mx-auto rounded-full bg-[#ED1C24] px-5 py-2 text-sm font-bold text-white disabled:opacity-60" data-testid="button-radio-end-show">{end.isSuccess ? "Show ended" : "End my show"}</button>
          )}
          <p className="text-xs text-white/60">This key is for this booking only. Anyone with it can stream as you, so keep it to yourself.</p>
        </div>
      )}
      {error && <p className="mt-2 text-sm text-red-300">{error}</p>}
    </div>
  );
}
