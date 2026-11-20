import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, Copy, Pause, Play, Radio } from "lucide-react";
import { NavBar } from "@/components/NavBar";
import { SiteFooter } from "@/components/SiteFooter";
import { useToast } from "@/hooks/use-toast";
import { Chat, type ChatMsg } from "@/components/BioPageView";

/**
 * A show hosted on MilitaryVoices, in public: its art and story, where to
 * follow it, and every episode to play right here. Plays count as downloads
 * (they go through the same /e/ link the apps use).
 */

type Ep = { id: number; title: string; notes: string; publishedAt: string; durationSec: number; episodeNumber: number | null; season: number | null; artworkUrl: string; audio: string };
type Data = { chat: string | null; chatWelcome?: string; show: { title: string; description: string; author: string; artworkUrl: string; category: string; website: string; appleUrl: string; spotifyUrl: string; feedUrl: string }; episodes: Ep[] };

const hms = (sec: number) => { const s = Math.round(sec); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60; return h ? `${h}:${String(m).padStart(2, "0")}:${String(x).padStart(2, "0")}` : `${m}:${String(x).padStart(2, "0")}`; };
const dateOf = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

export default function PodcastPage({ slug }: { slug: string }) {
  const { toast } = useToast();
  const q = useQuery<Data>({ queryKey: ["/api/public/podcast", slug], queryFn: async () => { const r = await fetch(`/api/public/podcast/${encodeURIComponent(slug)}`); if (!r.ok) throw new Error("not found"); return r.json(); }, retry: false });
  const [playing, setPlaying] = useState<number | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  useEffect(() => { if (q.data?.show.title) document.title = `${q.data.show.title} · MilitaryVoices.ai`; }, [q.data?.show.title]);

  const s = q.data?.show;
  const [chat, setChat] = useState(false);
  const [about, setAbout] = useState(false);
  const eps = q.data?.episodes ?? [];
  // The newest episode: the list comes newest first, but don't count on it.
  const latest = eps.length ? [...eps].sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt))[0] : null;
  const dark = typeof document !== "undefined" && document.documentElement.classList.contains("dark");
  const handle = q.data?.chat;
  return (
    <div className="min-h-screen bg-[#04102b]">
      {s && handle && (
        <>
          {chat && <div className="fixed inset-0 z-30" onClick={() => setChat(false)} aria-hidden />}
          <Chat corner handle={handle} name={s.title} avatar={s.artworkUrl} welcome={q.data?.chatWelcome} accent={dark ? "#F0A71F" : "#053877"} ink={dark ? "#ffffff" : "#0b1020"} sub={dark ? "rgba(255,255,255,0.68)" : "rgba(11,16,32,0.62)"} line={dark ? "rgba(255,255,255,0.12)" : "rgba(11,16,32,0.10)"} dark={dark} preview={false} open={chat} setOpen={setChat}
            onAsk={async (x) => {
              const r = await fetch(`/api/public/bio/${encodeURIComponent(handle)}/ask`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(x) });
              const j = (await r.json().catch(() => ({}))) as { message?: string; token?: string; createdAt?: string };
              if (!r.ok) throw new Error(j.message || "Couldn't send that. Try again.");
              return j;
            }}
            onLoad={async (tokens) => {
              const r = await fetch(`/api/public/bio/${encodeURIComponent(handle)}/messages`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tokens }) });
              if (!r.ok) throw new Error("Couldn't load your messages.");
              return ((await r.json()) as { messages: ChatMsg[] }).messages;
            }} />
        </>
      )}
      <NavBar />
      {/* 20 Nov 2026 (Andrew): the Directory's dark navy Featured style. A smaller cover beside the
          title, author, a short description and a gold Play latest, then the episodes on the same navy. */}
      <main className="bg-[#04102b] pb-16 text-white">
        {q.isLoading ? (
          <div className="mx-auto max-w-5xl px-4 pt-8 sm:px-6"><div className="h-64 animate-pulse rounded-3xl bg-white/5" /></div>
        ) : !s ? (
          <div className="mx-auto max-w-5xl px-4 py-24 text-center sm:px-6">
            <h1 className="text-2xl font-bold">We couldn't find that show</h1>
            <p className="mt-2 text-white/70">It may have moved. Try the directory of MilitaryVoices podcasts.</p>
            <a href="/directory" className="mt-4 inline-block font-semibold text-[#F0A71F] underline">See the directory</a>
          </div>
        ) : (
          <div className="mx-auto max-w-5xl px-4 pt-6 sm:px-6 sm:pt-8">
            <section className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 gap-y-4 rounded-3xl bg-gradient-to-br from-[#0a2350] to-[#071a3d] p-5 ring-1 ring-white/10 sm:grid-cols-[240px_minmax(0,1fr)] sm:grid-rows-[auto_auto] sm:gap-x-8 sm:gap-y-0 sm:p-7" data-testid="podcast-page">
              {s.artworkUrl && <img src={s.artworkUrl} alt="" className="h-24 w-24 shrink-0 rounded-xl object-cover shadow-xl ring-1 ring-white/10 sm:row-span-2 sm:h-[240px] sm:w-[240px] sm:rounded-2xl" />}
              {/* Phone: a small cover beside the title, the rest full width below. Wider: the cover on the left of it all. */}
              <div className={`min-w-0 sm:self-end ${s.artworkUrl ? "" : "col-span-2"}`}>
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#F0A71F]">{s.category ? `${s.category} podcast` : "Podcast"}</p>
                <h1 className="mt-1.5 text-balance text-2xl font-bold leading-tight tracking-tight sm:text-4xl">{s.title}</h1>
                {s.author && <p className="mt-1 text-[15px] text-white/75">by <span className="font-semibold text-white">{s.author}</span></p>}
              </div>
              <div className="col-span-2 min-w-0 sm:col-span-1 sm:col-start-2 sm:self-start">
                {s.description && (
                  <>
                    <p className={`max-w-2xl text-[15px] leading-relaxed text-white/80 sm:mt-3 ${about ? "whitespace-pre-line" : "line-clamp-3"}`} data-testid="podcast-description">{about ? s.description : s.description.replace(/\s*\n+\s*/g, " ")}</p>
                    {s.description.length > 220 && <button type="button" onClick={() => setAbout((v) => !v)} className="mt-1 text-sm font-semibold text-[#F0A71F] hover:underline">{about ? "Less" : "More about the show"}</button>}
                  </>
                )}
                <div className="mt-5 flex flex-wrap items-center gap-2.5">
                  {latest && (
                    <button type="button" onClick={() => { setPlaying(latest.id); document.getElementById(`ep-${latest.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" }); }} className="inline-flex h-11 items-center gap-2 rounded-full bg-[#F0A71F] pl-2 pr-5 text-sm font-bold text-[#1a1200] shadow-lg shadow-black/20 hover:bg-[#f5b840]" data-testid="podcast-play-latest">
                      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[#1a1200]/10"><Play className="h-3.5 w-3.5 translate-x-px fill-current" /></span>
                      Play latest
                    </button>
                  )}
                  <button type="button" onClick={() => navigator.clipboard.writeText(s.feedUrl).then(() => toast({ title: "Feed copied", description: "Paste it into any podcast app to follow." }))} className="inline-flex h-11 items-center gap-1.5 rounded-full border border-white/25 px-4 text-sm font-semibold text-white hover:bg-white/10" data-testid="podcast-follow">
                    <Radio className="h-4 w-4 text-[#F0A71F]" /> <span className="sm:hidden">Follow</span><span className="hidden sm:inline">Follow (RSS)</span> <Copy className="h-3.5 w-3.5 text-white/60" />
                  </button>
                  {s.appleUrl && <a href={s.appleUrl} target="_blank" rel="noreferrer" className="inline-flex h-11 items-center gap-2 rounded-full bg-white/10 px-4 text-sm font-semibold text-white hover:bg-white/15"><img src="/brands/apple-podcasts.svg" alt="" className="h-5 w-5" /> Apple Podcasts</a>}
                  {s.spotifyUrl && <a href={s.spotifyUrl} target="_blank" rel="noreferrer" className="inline-flex h-11 items-center gap-2 rounded-full bg-white/10 px-4 text-sm font-semibold text-white hover:bg-white/15"><img src="/brands/spotify.svg" alt="" className="h-5 w-5" /> Spotify</a>}
                  {s.website && <a href={s.website} target="_blank" rel="noreferrer" className="px-2 text-sm font-semibold text-white/80 underline hover:text-white">Website</a>}
                </div>
              </div>
            </section>

            <section className="mt-8">
              <h2 className="mb-3 text-lg font-bold">{eps.length} episode{eps.length === 1 ? "" : "s"}</h2>
              <ul className="space-y-2.5">
                {eps.map((e) => (
                  <li key={e.id} id={`ep-${e.id}`} className={`scroll-mt-24 rounded-2xl p-4 ring-1 transition-colors ${playing === e.id ? "bg-white/[0.09] ring-[#F0A71F]/50" : "bg-white/[0.05] ring-white/10 hover:bg-white/[0.07]"}`} data-testid={`podcast-episode-${e.id}`}>
                    <div className="flex items-start gap-3.5">
                      {(e.artworkUrl || s.artworkUrl) && <img src={e.artworkUrl || s.artworkUrl} alt="" loading="lazy" className="hidden h-16 w-16 shrink-0 rounded-xl object-cover sm:block" />}
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold leading-snug">{e.episodeNumber != null ? `${e.episodeNumber}. ` : ""}{e.title}</p>
                        <p className="mt-0.5 text-xs text-white/60">{dateOf(e.publishedAt)}{e.durationSec ? ` · ${hms(e.durationSec)}` : ""}</p>
                        {e.notes && (
                          <>
                            <p className={`mt-1.5 whitespace-pre-line text-sm text-white/75 ${open === e.id ? "" : "line-clamp-2"}`}>{e.notes}</p>
                            {e.notes.length > 160 && <button type="button" onClick={() => setOpen(open === e.id ? null : e.id)} className="mt-0.5 text-xs font-semibold text-[#F0A71F]">{open === e.id ? "Less" : "More"}</button>}
                          </>
                        )}
                        {playing === e.id && <audio src={e.audio} controls autoPlay preload="none" className="mt-3 w-full" onEnded={() => setPlaying(null)} />}
                      </div>
                      <button type="button" onClick={() => setPlaying(playing === e.id ? null : e.id)} aria-label={playing === e.id ? `Pause ${e.title}` : `Play ${e.title}`} className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full ${playing === e.id ? "bg-[#F0A71F] text-[#1a1200]" : "bg-white/10 text-white hover:bg-[#F0A71F] hover:text-[#1a1200]"}`}>
                        {playing === e.id ? <Pause className="h-4 w-4 fill-current" /> : <Play className="h-4 w-4 translate-x-px fill-current" />}
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
              <p className="mt-4 flex items-center gap-1.5 text-xs text-white/55"><Check className="h-3.5 w-3.5" /> Hosted on MilitaryVoices.ai</p>
            </section>
          </div>
        )}
      </main>
      <SiteFooter />
    </div>
  );
}
