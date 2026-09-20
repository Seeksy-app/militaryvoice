import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { NavBar } from "@/components/NavBar";
import { Button } from "@/components/ui/button";
import { apiRequest, resolveUploadUrl } from "@/lib/queryClient";
import { Camera, CheckCircle2, Loader2, AlertTriangle } from "lucide-react";

// One page, one job: take one good photograph of a podcaster.
//
// No sign-in. Asking thirty busy people to remember which address they used,
// wait for a code, find the right screen and then upload is four chances to
// give up before the thing we actually need. The link in the email is the
// screen.
//
// The page says why it is asking, because "upload a photo" gets a screenshot
// of a logo and "we are printing you at nine inches across" gets a photograph.

const HEADLINE_FONT = { fontFamily: "'General Sans', 'Inter', sans-serif" } as const;

interface Who {
  hostName: string;
  podcastName: string;
  currentPhotoUrl: string;
  alreadyPrintable: boolean;
}

export default function Headshot({ token }: { token: string }) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [preview, setPreview] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");

  const { data: who, isLoading } = useQuery<Who>({
    queryKey: ["/api/headshot", token],
    queryFn: async () => (await apiRequest("GET", `/api/headshot/${token}`)).json(),
    retry: false,
  });

  async function send(file: File) {
    setError("");
    setBusy(true);
    try {
      const form = new FormData();
      form.append("photo", file);
      const res = await fetch(`/api/headshot/${token}`, { method: "POST", body: form });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message || "That didn't go through.");
      setDone(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function pick(file: File | undefined) {
    if (!file) return;
    setDone(false);
    setPreview(URL.createObjectURL(file));
    void send(file);
  }

  return (
    <div className="min-h-screen bg-background">
      <NavBar />
      <div className="mx-auto max-w-2xl px-4 py-12 sm:px-6">
        {isLoading ? (
          <p className="text-sm text-muted-foreground">One moment…</p>
        ) : !who ? (
          <div className="rounded-2xl border border-border bg-card p-6">
            <div className="flex items-center gap-2 font-semibold">
              <AlertTriangle className="h-4 w-4 text-[#ED1C24]" /> That link isn't valid
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              It may have been rotated. Reply to the email we sent and we'll send you a fresh one.
            </p>
          </div>
        ) : (
          <>
            <div className="text-xs font-semibold uppercase tracking-[0.14em] text-primary">
              The Podcast Marathon · print edition
            </div>
            <h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl" style={HEADLINE_FONT}>
              {who.hostName ? `${who.hostName.split(/\s+/)[0]}, we need a better photo of you` : "We need a better photo of you"}
            </h1>
            <p className="mt-4 text-base leading-relaxed text-muted-foreground">
              {who.podcastName ? <><span className="font-semibold text-foreground">{who.podcastName}</span> gets its own page in the keepsake magazine. </> : null}
              The photo we hold is 720 pixels, which is fine on a screen and prints about the size of a
              postage stamp. We print you nine inches across, so we need the original.
            </p>

            {/* What "good" means, before they choose — not after we reject one. */}
            <ul className="mt-5 space-y-1.5 text-sm text-muted-foreground">
              <li>· The biggest file you have. Straight off the camera or phone is perfect.</li>
              <li>· A photograph of <span className="font-semibold text-foreground">you</span>, not your show artwork — we already have that.</li>
              <li>· Don't crop it. We'll do that, and a designer wants the shoulders and the room.</li>
            </ul>

            {/* Most people here have no headshot, and the one thing they get
                wrong is the camera they use: the selfie camera is a fraction
                of the resolution of the one on the back. */}
            <p className="mt-4 rounded-xl border border-border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
              <span className="font-semibold text-foreground">Haven't got one?</span> Your phone will do it.
              Use the back camera rather than the selfie camera — it's several times sharper — stand facing a
              window, and get someone else to press the button.
            </p>

            <div className="mt-7 rounded-2xl border-2 border-dashed border-border bg-muted/20 p-6">
              <div className="flex flex-wrap items-center gap-5">
                <div className="h-24 w-24 shrink-0 overflow-hidden rounded-xl bg-muted">
                  {preview || who.currentPhotoUrl ? (
                    <img
                      src={preview || resolveUploadUrl(who.currentPhotoUrl)}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-muted-foreground">
                      <Camera className="h-6 w-6" />
                    </div>
                  )}
                </div>

                <div className="min-w-0 flex-1">
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => pick(e.target.files?.[0])}
                    data-testid="input-headshot"
                  />
                  <Button
                    size="lg"
                    className="gap-2 rounded-full"
                    disabled={busy}
                    onClick={() => fileRef.current?.click()}
                    data-testid="button-choose-headshot"
                  >
                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
                    {busy ? "Sending…" : done ? "Send a different one" : "Choose a photo"}
                  </Button>
                  <p className="mt-2 text-xs text-muted-foreground">
                    Up to 25MB. It goes straight to us — nothing is posted anywhere.
                  </p>
                </div>
              </div>

              {done && (
                <div className="mt-5 flex items-center gap-2 rounded-xl bg-emerald-500/10 px-4 py-3 text-sm font-semibold text-emerald-700 dark:text-emerald-400">
                  <CheckCircle2 className="h-4 w-4" /> Got it — that's what we'll print. Thank you.
                </div>
              )}
              {error && (
                <div className="mt-5 flex items-center gap-2 rounded-xl bg-[#ED1C24]/10 px-4 py-3 text-sm font-semibold text-[#ED1C24]">
                  <AlertTriangle className="h-4 w-4" /> {error}
                </div>
              )}
            </div>

            {who.alreadyPrintable && !done && (
              <p className="mt-4 text-sm text-muted-foreground">
                We already hold a print-quality photo of you — you only need this if you'd rather we
                used a different one.
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
