import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, Copy, Pause, Play, Radio } from "lucide-react";
import { NavBar } from "@/components/NavBar";
import { SiteFooter } from "@/components/SiteFooter";
import { useToast } from "@/hooks/use-toast";

/**
 * A show hosted on MilitaryVoices, in public: its art and story, where to
 * follow it, and every episode to play right here. Plays count as downloads
 * (they go through the same /e/ link the apps use).
 */

type Ep = { id: number; title: string; notes: string; publishedAt: string; durationSec: number; episodeNumber: number | null; season: number | null; artworkUrl: string; audio: string };
type Data = { show: { title: string; description: string; author: string; artworkUrl: string; category: string; website: string; appleUrl: string; spotifyUrl: string; feedUrl: string }; episodes: Ep[] };

const hms = (sec: number) => { const s = Math.round(sec); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60; return h ? `${h}:${String(m).padStart(2, "0")}:${String(x).padStart(2, "0")}` : `${m}:${String(x).padStart(2, "0")}`; };
const dateOf = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

export default function PodcastPage({ slug }: { slug: string }) {
  const { toast } = useToast();
  const q = useQuery<Data>({ queryKey: ["/api/public/podcast", slug], queryFn: async () => { const r = await fetch(`/api/public/podcast/${encodeURIComponent(slug)}`); if (!r.ok) throw new Error("not found"); return r.json(); }, retry: false });
  const [playing, setPlaying] = useState<number | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  useEffect(() => { if (q.data?.show.title) document.title = `${q.data.show.title} · MilitaryVoices.ai`; }, [q.data?.show.title]);

  const s = q.data?.show;
  return (
    <div className="min-h-screen bg-background">
      <NavBar />
      <main className="mx-auto max-w-4xl px-4 pb-16 pt-8 sm:px-6">
        {q.isLoading ? (
          <div className="h-64 animate-pulse rounded-2xl bg-muted" />
        ) : !s ? (
          <div className="py-24 text-center">
            <h1 className="text-2xl font-bold">We couldn't find that show</h1>
            <p className="mt-2 text-muted-foreground">It may have moved. Try the directory of MilitaryVoices podcasts.</p>
            <a href="/directory" className="mt-4 inline-block font-semibold text-[#053877] underline">See the directory</a>
          </div>
        ) : (
          <>
            <section className="flex flex-col gap-6 sm:flex-row sm:items-start" data-testid="podcast-page">
              {s.artworkUrl && <img src={s.artworkUrl} alt="" className="h-48 w-48 shrink-0 rounded-2xl object-cover shadow-md sm:h-56 sm:w-56" />}
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#b36b00]">{s.category} · Podcast</p>
                <h1 className="mt-1 text-balance text-3xl font-bold tracking-tight sm:text-4xl">{s.title}</h1>
                {s.author && <p className="mt-1 text-lg text-muted-foreground">{s.author}</p>}
                <p className="mt-3 whitespace-pre-line text-[15px] leading-relaxed text-foreground/85">{s.description}</p>
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  {s.appleUrl && <a href={s.appleUrl} target="_blank" rel="noreferrer" className="rounded-full bg-[#872EC4] px-4 py-2 text-sm font-semibold text-white hover:opacity-90">Apple Podcasts</a>}
                  {s.spotifyUrl && <a href={s.spotifyUrl} target="_blank" rel="noreferrer" className="rounded-full bg-[#1DB954] px-4 py-2 text-sm font-semibold text-black hover:opacity-90">Spotify</a>}
                  <button type="button" onClick={() => navigator.clipboard.writeText(s.feedUrl).then(() => toast({ title: "Feed copied", description: "Paste it into any podcast app to follow." }))} className="inline-flex items-center gap-1.5 rounded-full border border-border px-4 py-2 text-sm font-semibold hover:bg-muted">
                    <Radio className="h-4 w-4 text-[#b36b00]" /> RSS <Copy className="h-3.5 w-3.5 text-muted-foreground" />
                  </button>
                  {s.website && <a href={s.website} target="_blank" rel="noreferrer" className="px-2 text-sm font-semibold text-[#053877] underline dark:text-[#8fb5e8]">Website</a>}
                </div>
              </div>
            </section>

            <section className="mt-10">
              <h2 className="mb-3 text-lg font-bold">{q.data!.episodes.length} episode{q.data!.episodes.length === 1 ? "" : "s"}</h2>
              <ul className="divide-y divide-border rounded-2xl border border-border bg-card">
                {q.data!.episodes.map((e) => (
                  <li key={e.id} className="p-4" data-testid={`podcast-episode-${e.id}`}>
                    <div className="flex items-start gap-3">
                      <button type="button" onClick={() => setPlaying(playing === e.id ? null : e.id)} aria-label={playing === e.id ? `Pause ${e.title}` : `Play ${e.title}`} className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#053877] text-white hover:bg-[#0a4a99]">
                        {playing === e.id ? <Pause className="h-4 w-4 fill-current" /> : <Play className="h-4 w-4 translate-x-px fill-current" />}
                      </button>
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold leading-snug">{e.episodeNumber != null ? `${e.episodeNumber}. ` : ""}{e.title}</p>
                        <p className="text-xs text-muted-foreground">{dateOf(e.publishedAt)}{e.durationSec ? ` · ${hms(e.durationSec)}` : ""}</p>
                        {e.notes && (
                          <>
                            <p className={`mt-1.5 whitespace-pre-line text-sm text-foreground/80 ${open === e.id ? "" : "line-clamp-2"}`}>{e.notes}</p>
                            {e.notes.length > 160 && <button type="button" onClick={() => setOpen(open === e.id ? null : e.id)} className="mt-0.5 text-xs font-semibold text-[#053877] dark:text-[#8fb5e8]">{open === e.id ? "Less" : "More"}</button>}
                          </>
                        )}
                        {playing === e.id && <audio src={e.audio} controls autoPlay preload="none" className="mt-3 w-full" onEnded={() => setPlaying(null)} />}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
              <p className="mt-4 flex items-center gap-1.5 text-xs text-muted-foreground"><Check className="h-3.5 w-3.5" /> Hosted on MilitaryVoices.ai</p>
            </section>
          </>
        )}
      </main>
      <SiteFooter />
    </div>
  );
}
