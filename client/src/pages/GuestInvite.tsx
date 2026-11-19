import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

type Invite = { questions?: string[]; hostName: string; hostPhoto: string; show: string; guestName: string; whenText: string; zoomLink: string; linkLater?: boolean; note: string; answered: boolean };

/**
 * The guest's side of an interview invitation: a few questions before the interview and the photo they want shown with their name.
 * No account: the link is the key.
 */
/** Phone photos and PNGs are often bigger than an upload can carry (about 4.5 MB), so send a 1600px JPEG instead. Falls back to the original file if the browser can't read it. */
async function shrinkPhoto(file: File): Promise<Blob> {
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bmp.width * scale); canvas.height = Math.round(bmp.height * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const out = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, "image/jpeg", 0.88));
    return out && out.size < file.size ? out : file;
  } catch { return file; }
}

export default function GuestInvite({ token }: { token: string }) {
  useEffect(() => { document.title = "Your interview · MilitaryVoices.ai"; }, []);
  const q = useQuery<Invite>({ queryKey: ["/api/public/guest-invite", token], retry: false, queryFn: async () => { const r = await fetch(`/api/public/guest-invite/${token}`); if (!r.ok) throw new Error((await r.json().catch(() => ({}))).message || "That link isn't working."); return r.json(); } });
  const [f, setF] = useState({ name: "", title: "", bio: "", topics: "", links: "", avoid: "" });
  const [photo, setPhoto] = useState<File | null>(null);
  const [extra, setExtra] = useState<Record<string, string>>({});
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  useEffect(() => { if (q.data?.guestName) setF((x) => (x.name ? x : { ...x, name: q.data!.guestName })); }, [q.data?.guestName]);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));

  const shell = "min-h-screen bg-[#f5f7fb] px-4 py-8 text-[#14213a]";
  if (q.isLoading) return <div className={shell}><div className="mx-auto max-w-xl pt-20 text-center"><Loader2 className="mx-auto h-6 w-6 animate-spin" /></div></div>;
  if (q.error || !q.data) return <div className={shell}><div className="mx-auto max-w-xl pt-20 text-center"><p className="text-xl font-bold">This link isn't working</p><p className="mt-2 text-muted-foreground">{(q.error as Error)?.message || "Ask your host to send it again."}</p></div></div>;
  const d = q.data;

  const submit = async () => {
    setError(""); setBusy(true);
    try {
      const body = new FormData();
      for (const [k, v] of Object.entries(f)) body.append(k, v);
      body.append("consent", consent ? "yes" : "no");
      for (const [k, v] of Object.entries(extra)) body.append(k, v);
      if (photo) {
        const small = await shrinkPhoto(photo);
        if (small.size > 4_000_000) throw new Error("That photo is too large to send. Try a smaller picture, or a screenshot of it.");
        body.append("photo", small, small === photo ? photo.name : "photo.jpg");
      }
      const r = await fetch(`/api/public/guest-invite/${token}`, { method: "POST", body }).catch(() => { throw new Error("That didn't go through. Check your connection and press Send again."); });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.message || "That didn't go through. Try again.");
      setDone(true);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <div className={shell}>
      <div className="mx-auto max-w-xl">
        <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-black/5">
          <div className="flex items-center gap-4">
            {d.hostPhoto && <img src={d.hostPhoto} alt="" className="h-16 w-16 rounded-full object-cover ring-2 ring-[#F0A71F]" />}
            <div className="min-w-0">
              <p className="text-xs font-bold uppercase tracking-[0.14em] text-[#B9770E]">You're invited</p>
              <h1 className="text-2xl font-bold leading-tight [text-wrap:balance]">{d.show || "The podcast"}</h1>
              <p className="text-sm text-muted-foreground">with {d.hostName || "your host"}</p>
            </div>
          </div>
          {(d.whenText || d.zoomLink || d.linkLater || d.note) && (
            <div className="mt-4 space-y-1 rounded-xl bg-[#f5f7fb] p-4 text-sm">
              {d.whenText && <p><b>When:</b> {d.whenText}</p>}
              {d.zoomLink
                ? <p className="break-all"><b>{/\/room\/join\/|\/booth\//.test(d.zoomLink) ? "Your link to join" : "Zoom"}:</b> <a className="text-[#053877] underline" href={d.zoomLink}>{d.zoomLink}</a></p>
                : d.linkLater && <p><b>Zoom:</b> {d.hostName || "Your host"} will send you the link in a separate email.</p>}
              {d.note && <p className="whitespace-pre-line">{d.note}</p>}
            </div>
          )}
        </div>

        {done || d.answered ? (
          <div className="mt-4 rounded-2xl bg-white p-8 text-center shadow-sm ring-1 ring-black/5" data-testid="guest-invite-done">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-emerald-700"><Check className="h-6 w-6" /></div>
            <h2 className="mt-3 text-xl font-bold">Thank you</h2>
            <p className="mt-1 text-muted-foreground">{d.hostName || "Your host"} has your answers and your photo. See you at the interview.</p>
          </div>
        ) : (
          <form className="mt-4 space-y-4 rounded-2xl bg-white p-6 text-gray-900 shadow-sm ring-1 ring-black/5 [&_input:not([type=file]):not([type=checkbox])]:border-gray-300 [&_input:not([type=file]):not([type=checkbox])]:bg-white [&_input]:text-gray-900 [&_input::placeholder]:text-gray-400 [&_textarea]:border-gray-300 [&_textarea]:bg-white [&_textarea]:text-gray-900 [&_textarea::placeholder]:text-gray-400 [&_label]:text-gray-900" style={{ colorScheme: "light" }} onSubmit={(e) => { e.preventDefault(); void submit(); }}>
            <p className="text-sm text-muted-foreground">A few quick questions to get ready. It takes about five minutes.</p>
            <div className="space-y-1.5"><Label htmlFor="gi-name">Your name, as it should read</Label><Input id="gi-name" value={f.name} onChange={set("name")} maxLength={80} required /></div>
            <div className="space-y-1.5"><Label htmlFor="gi-title">What you do</Label><Input id="gi-title" value={f.title} onChange={set("title")} maxLength={120} placeholder="Author and Army veteran" /></div>
            <div className="space-y-1.5"><Label htmlFor="gi-bio">A short bio</Label><Textarea id="gi-bio" value={f.bio} onChange={set("bio")} rows={4} maxLength={1500} placeholder="Two or three sentences the host can read to introduce you." /></div>
            <div className="space-y-1.5"><Label htmlFor="gi-topics">What would you like to talk about?</Label><Textarea id="gi-topics" value={f.topics} onChange={set("topics")} rows={3} maxLength={1200} /></div>
            <div className="space-y-1.5"><Label htmlFor="gi-links">Where can people find you? (website, book, social)</Label><Textarea id="gi-links" value={f.links} onChange={set("links")} rows={2} maxLength={600} /></div>
            <div className="space-y-1.5"><Label htmlFor="gi-avoid">Anything you'd rather not discuss?</Label><Textarea id="gi-avoid" value={f.avoid} onChange={set("avoid")} rows={2} maxLength={600} /></div>
            {(d.questions ?? []).map((qq, i) => (
              <div key={i} className="space-y-1.5"><Label htmlFor={`gi-q${i}`}>{qq}</Label><Textarea id={`gi-q${i}`} value={extra[`q${i}`] ?? ""} onChange={(e) => setExtra((x) => ({ ...x, [`q${i}`]: e.target.value }))} rows={3} maxLength={2000} /></div>
            ))}
            <div className="space-y-1.5">
              <Label htmlFor="gi-photo">The photo you'd like shown with your name</Label>
              <input id="gi-photo" type="file" accept="image/*" className="block w-full text-sm" onChange={(e) => setPhoto(e.target.files?.[0] ?? null)} />
              <p className="text-xs text-muted-foreground">A clear picture of your face works best. It will be cropped to a circle.</p>
            </div>
            <label className="flex items-start gap-2 text-sm"><input id="gi-consent" type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-1" /><span>I'm happy for my name and this photo to appear with the episode and where it's shared.</span></label>
            {error && <p className="text-sm font-medium text-red-700" role="alert">{error}</p>}
            <Button type="submit" disabled={busy || !f.name.trim() || !photo || !consent} className="w-full rounded-full bg-[#053877] text-white hover:bg-[#0a4a99]" data-testid="guest-invite-send">{busy ? "Sending…" : "Send my answers"}</Button>
          </form>
        )}
        <p className="mt-6 text-center text-xs text-muted-foreground">MilitaryVoices.ai</p>
      </div>
    </div>
  );
}
