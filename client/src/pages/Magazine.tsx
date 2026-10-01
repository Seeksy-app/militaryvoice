import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import QRCode from "qrcode";
import { Loader2, Printer } from "lucide-react";

// The keepsake magazine. Every page is drawn at US Letter, 816 × 1056 CSS
// pixels (8.5 × 11 inches at 96 dpi), so printing it to PDF is the print file
// as it is. On screen the pages are scaled down to fit. ?print=1 opens the
// print dialog as soon as the pictures have loaded.

type Show = {
  signupId: number; number: number; time: string; podcastName: string; hostName: string; branch: string; service: string;
  headshot: string; printQuality: boolean; art: string; blurb: string; quote: string; link: string;
};
type Mag = {
  event: { name: string; day: string; occasion: string; tagline: string };
  published: boolean; admin?: boolean; welcome: string;
  host: { name: string; title: string; photo: string };
  shows: Show[]; sponsors: { name: string; logo: string; url: string }[];
  cover?: { photo: string };
  ads?: Ad[];
};
type Ad = { id: number; name: string; headline: string; body: string; site: string; link: string; logo: string; artwork: string };

const NAVY = "#000741";
const GOLD = "#F0A71F";
const HEAD = { fontFamily: "'General Sans', 'Inter', sans-serif" } as const;
const W = 816;
const H = 1056;

function Page({ children, bg = "#fff", color = "#0b1a3a", n }: { children: ReactNode; bg?: string; color?: string; n?: number }) {
  return (
    <section className="mag-page relative overflow-hidden" style={{ width: W, height: H, background: bg, color }}>
      {children}
      {n != null && <span className="absolute bottom-5 right-8 text-[11px] font-semibold tabular-nums opacity-60">{n}</span>}
    </section>
  );
}

function Qr({ url, size = 96 }: { url: string; size?: number }) {
  const [src, setSrc] = useState("");
  useEffect(() => { void QRCode.toDataURL(url, { margin: 1, width: size * 3, color: { dark: NAVY, light: "#ffffff" } }).then(setSrc).catch(() => {}); }, [url, size]);
  return src ? <img src={src} alt="" style={{ width: size, height: size }} /> : <span style={{ width: size, height: size }} className="block bg-slate-100" />;
}

/** A full-page ad: their own artwork edge to edge, or one we set from their logo, words and a QR. */
function AdPage({ ad, n }: { ad: Ad; n: number }) {
  if (ad.artwork) {
    return (
      <Page n={n}>
        <img src={ad.artwork} alt={ad.name} className="absolute inset-0 h-full w-full object-cover" />
      </Page>
    );
  }
  return (
    <Page bg={NAVY} color="#fff" n={n}>
      <div className="absolute inset-0 flex flex-col items-center px-16 pb-16 pt-24 text-center">
        <p className="text-[12px] font-bold uppercase tracking-[0.3em]" style={{ color: GOLD }}>A word from our sponsor</p>
        <div className="mt-14 flex h-40 w-full items-center justify-center">
          {ad.logo ? <img src={ad.logo} alt={ad.name} className="max-h-full max-w-[460px] object-contain" /> : <span className="text-[44px] font-bold" style={HEAD}>{ad.name}</span>}
        </div>
        {ad.headline && <h2 className="mt-14 text-balance text-[48px] font-bold leading-[1.05] tracking-tight" style={HEAD}>{ad.headline}</h2>}
        {ad.body && <p className="mt-6 max-w-[560px] text-pretty text-[19px] leading-[1.55] text-white/80">{ad.body}</p>}
        {ad.link && (
          <div className="mt-auto flex flex-col items-center gap-4">
            <div className="rounded-2xl bg-white p-3"><Qr url={ad.link} size={132} /></div>
            <p className="text-[18px] font-semibold" style={{ color: GOLD }}>{(ad.site || ad.link).replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "")}</p>
          </div>
        )}
      </div>
    </Page>
  );
}

function ShowPage({ s, n, event }: { s: Show; n: number; event: Mag["event"] }) {
  const who = [s.branch, s.service].filter(Boolean).join(" · ");
  return (
    <Page n={n}>
      {/* The host, big: the reason we asked for the print-quality photo. */}
      <div className="absolute inset-x-0 top-0" style={{ height: 560 }}>
        {s.headshot ? <img src={s.headshot} alt="" className="h-full w-full object-cover" style={{ objectPosition: "50% 22%" }} /> : <div className="h-full w-full" style={{ background: NAVY }} />}
        <div className="absolute inset-x-0 bottom-0 h-40" style={{ background: "linear-gradient(to top, rgba(0,7,65,0.55), transparent)" }} />
        <span className="absolute left-8 top-8 rounded-full px-3.5 py-1.5 text-[12px] font-bold uppercase tracking-[0.14em]" style={{ background: GOLD, color: "#1a1200" }}>
          Show {s.number} · {s.time}
        </span>
      </div>
      {s.art && <img src={s.art} alt="" className="absolute rounded-xl object-cover shadow-xl" style={{ left: 40, top: 480, width: 150, height: 150, border: "5px solid #fff" }} />}
      <div className="absolute" style={{ left: s.art ? 212 : 40, right: 40, top: 578 }}>
        <h2 className="text-balance text-[34px] font-bold leading-[1.05] tracking-tight" style={{ ...HEAD, color: NAVY }}>{s.podcastName}</h2>
        <p className="mt-1.5 text-[15px] font-medium text-slate-600">with {s.hostName}{who ? ` · ${who}` : ""}</p>
      </div>
      <div className="absolute" style={{ left: 40, right: 40, top: 670 }}>
        {s.blurb && <p className="text-[15.5px] leading-[1.55] text-slate-800">{s.blurb}</p>}
        {s.quote && (
          <blockquote className="mt-5 border-l-4 pl-5" style={{ borderColor: GOLD }}>
            <p className="text-[21px] font-semibold italic leading-snug" style={{ ...HEAD, color: NAVY }}>“{s.quote}”</p>
            <footer className="mt-1.5 text-[13px] font-semibold text-slate-500">{s.hostName}</footer>
          </blockquote>
        )}
      </div>
      <footer className="absolute inset-x-0 bottom-0 flex items-center gap-4 px-10 pb-10 pt-4" style={{ borderTop: "1px solid #e5e7eb" }}>
        <Qr url={s.link} size={84} />
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-bold" style={{ color: NAVY }}>Scan to follow {s.podcastName}</p>
          <p className="truncate text-[12px] text-slate-500">{s.link.replace(/^https?:\/\/(www\.)?/, "")}</p>
        </div>
        <p className="text-right text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">{event.name}<br />{event.day}</p>
      </footer>
    </Page>
  );
}

export default function Magazine({ slug }: { slug?: string }) {
  const printing = typeof window !== "undefined" && new URLSearchParams(window.location.search).has("print");
  const q = useQuery<Mag>({
    queryKey: ["/api/magazine", slug ?? ""],
    queryFn: async () => {
      const r = await fetch(slug ? `/api/magazine/${encodeURIComponent(slug)}` : "/api/magazine", { credentials: "include" });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).message || "The magazine isn't out yet.");
      return r.json();
    },
  });
  // Scaled to the screen; printed at full size.
  const box = useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = useState(1);
  useLayoutEffect(() => {
    const fit = () => setScale(Math.min(1, ((box.current?.clientWidth ?? W) - 0) / W));
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [q.data]);
  useEffect(() => {
    if (!printing || !q.data) return;
    document.title = `${q.data.event.name} — Keepsake Magazine`;
    // Wait for every picture, then print.
    const imgs = Array.from(document.images);
    void Promise.all(imgs.map((i) => (i.complete ? Promise.resolve() : new Promise((r) => { i.onload = i.onerror = () => r(null); })))).then(() => setTimeout(() => window.print(), 600));
  }, [printing, q.data]);

  if (q.isLoading) return <div className="flex min-h-screen items-center justify-center bg-slate-200"><Loader2 className="h-6 w-6 animate-spin text-slate-500" /></div>;
  if (q.isError || !q.data) return <div className="flex min-h-screen items-center justify-center bg-slate-200 p-6 text-center text-slate-600">{(q.error as Error)?.message ?? "The magazine isn't out yet."}</div>;
  const m = q.data;
  // Every show on the cover: their photo, or their show's art when we haven't got one.
  const faces = m.shows.map((s) => ({ id: s.signupId, src: s.headshot || s.art })).filter((f) => f.src);
  const cols = faces.length > 24 ? 8 : 6;
  const half = Math.ceil(m.shows.length / 2);
  const ads = m.ads ?? [];
  // The first ad faces the welcome; the rest are spread evenly through the show pages.
  const after = new Map<number, Ad[]>();
  ads.slice(1).forEach((ad, k) => {
    const at = Math.max(0, Math.round(((k + 1) * m.shows.length) / ads.length) - 1);
    after.set(at, [...(after.get(at) ?? []), ad]);
  });
  let n = 1;

  const pages: ReactNode[] = [
    // Cover
    <Page key="cover" bg={NAVY} color="#fff">
      {m.cover?.photo ? (
        <>
          <img src={m.cover.photo} alt="" className="absolute inset-0 h-full w-full object-cover" />
          <div className="absolute inset-x-0 bottom-0" style={{ height: 620, background: `linear-gradient(to bottom, transparent, ${NAVY} 62%)` }} />
        </>
      ) : (
        <>
          <div className="absolute inset-x-0 top-0 grid gap-1 p-1" style={{ height: 620, gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
            {faces.map((f) => <img key={f.id} src={f.src} alt="" className="h-full w-full object-cover" style={{ objectPosition: "50% 25%" }} />)}
          </div>
          <div className="absolute inset-x-0" style={{ top: 440, height: 200, background: `linear-gradient(to bottom, transparent, ${NAVY})` }} />
        </>
      )}
      <div className="absolute inset-x-12" style={{ top: 640 }}>
        <p className="text-[13px] font-bold uppercase tracking-[0.3em]" style={{ color: GOLD }}>Keepsake edition · {m.event.occasion}</p>
        <h1 className="mt-3 text-[76px] font-bold leading-[0.95] tracking-tight" style={HEAD}>{m.event.name}</h1>
        <p className="mt-5 text-[20px] font-medium text-white/80">{m.event.day}</p>
        <p className="mt-2 text-[16px] text-white/60">{m.shows.length} military and veteran shows, back to back, one day.</p>
      </div>
      <p className="absolute bottom-10 left-12 text-[14px] font-bold tracking-wide" style={{ color: GOLD }}>MILITARYVOICES.AI</p>
    </Page>,
    // Welcome
    <Page key="welcome" n={++n}>
      <div className="absolute inset-x-14 top-16">
        <p className="text-[12px] font-bold uppercase tracking-[0.3em]" style={{ color: GOLD }}>Welcome</p>
        <div className="mt-6 flex items-start gap-8">
          {m.host.photo && <img src={m.host.photo} alt="" className="h-44 w-44 shrink-0 rounded-2xl object-cover" style={{ objectPosition: "50% 20%" }} />}
          <h2 className="text-[40px] font-bold leading-[1.05] tracking-tight" style={{ ...HEAD, color: NAVY }}>Thank you for being part of the day.</h2>
        </div>
        <div className="mt-8 space-y-4 text-[16px] leading-[1.65] text-slate-800">
          {(m.welcome || "Welcome letter to come.").split(/\n{2,}/).map((p, i) => <p key={i}>{p}</p>)}
        </div>
        <p className="mt-8 text-[18px] font-bold" style={{ ...HEAD, color: NAVY }}>{m.host.name}</p>
        <p className="text-[14px] text-slate-500">{m.host.title}</p>
      </div>
    </Page>,
    ...(ads[0] ? [<AdPage key={`ad-${ads[0].id}`} ad={ads[0]} n={++n} />] : []),
    // The lineup
    <Page key="lineup" n={++n}>
      <div className="absolute inset-x-14 top-16">
        <p className="text-[12px] font-bold uppercase tracking-[0.3em]" style={{ color: GOLD }}>The lineup · {m.event.day}</p>
        <h2 className="mt-3 text-[40px] font-bold tracking-tight" style={{ ...HEAD, color: NAVY }}>Who's on, and when</h2>
        <div className="mt-8 grid grid-cols-2 gap-x-10">
          {[m.shows.slice(0, half), m.shows.slice(half)].map((col, c) => (
            <ol key={c} className="space-y-2.5">
              {col.map((s) => (
                <li key={s.signupId} className="flex gap-3 text-[13px] leading-tight">
                  <span className="w-[74px] shrink-0 font-bold tabular-nums" style={{ color: GOLD }}>{s.time.replace(" ET", "")}</span>
                  <span className="min-w-0"><span className="block font-semibold text-slate-900">{s.podcastName}</span><span className="block text-slate-500">{s.hostName}</span></span>
                </li>
              ))}
            </ol>
          ))}
        </div>
        <p className="mt-6 text-[12px] text-slate-400">All times Eastern.</p>
      </div>
    </Page>,
    ...m.shows.flatMap((s, i) => [
      <ShowPage key={s.signupId} s={s} n={++n} event={m.event} />,
      ...(after.get(i) ?? []).map((ad) => <AdPage key={`ad-${ad.id}`} ad={ad} n={++n} />),
    ]),
    // Friends of the Marathon
    <Page key="sponsors" n={++n}>
      <div className="absolute inset-x-14 top-16">
        <p className="text-[12px] font-bold uppercase tracking-[0.3em]" style={{ color: GOLD }}>With thanks</p>
        <h2 className="mt-3 text-[40px] font-bold tracking-tight" style={{ ...HEAD, color: NAVY }}>Friends of the Marathon</h2>
        <p className="mt-3 text-[16px] text-slate-600">The day is free for every podcaster and every listener because of them.</p>
        <div className="mt-12 grid grid-cols-2 gap-8">
          {m.sponsors.map((sp) => (
            <div key={sp.name} className="flex h-40 items-center justify-center rounded-2xl p-6" style={{ background: NAVY }}>
              {sp.logo ? <img src={sp.logo} alt={sp.name} className="max-h-full max-w-full object-contain" /> : <span className="text-[22px] font-bold text-white">{sp.name}</span>}
            </div>
          ))}
        </div>
      </div>
    </Page>,
    // Back cover
    <Page key="back" bg={NAVY} color="#fff">
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-6 px-16 text-center">
        <p className="text-[13px] font-bold uppercase tracking-[0.3em]" style={{ color: GOLD }}>Keep listening</p>
        <h2 className="text-[46px] font-bold leading-tight tracking-tight" style={HEAD}>Every show in this magazine,<br />all year, on MilitaryVoices.ai</h2>
        <div className="rounded-2xl bg-white p-4"><Qr url="https://www.militaryvoices.ai" size={150} /></div>
        <p className="text-[18px] font-semibold" style={{ color: GOLD }}>militaryvoices.ai</p>
      </div>
    </Page>,
  ];

  return (
    <div className="min-h-screen bg-slate-200 print:bg-white">
      <style>{`@page { size: 8.5in 11in; margin: 0; } @media print { .mag-bar { display: none !important; } .mag-sheet { transform: none !important; } .mag-frame { width: auto !important; height: auto !important; margin: 0 !important; } .mag-page { break-after: page; } body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }`}</style>
      <div className="mag-bar sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-slate-300 bg-white/95 px-4 py-2.5 backdrop-blur">
        <p className="truncate text-sm font-semibold text-slate-800">{m.event.name} · Keepsake magazine{!m.published ? " · draft (admins only)" : ""}</p>
        <button type="button" onClick={() => window.print()} className="inline-flex items-center gap-1.5 rounded-full bg-[#053877] px-4 py-1.5 text-sm font-semibold text-white hover:bg-[#0a4a99]" data-testid="magazine-print">
          <Printer className="h-4 w-4" /> Print / save as PDF
        </button>
      </div>
      <div ref={box} className="mx-auto max-w-[816px] px-0 py-6 sm:py-10 print:max-w-none print:p-0">
        {pages.map((p, i) => (
          <div key={i} className="mag-frame mx-auto mb-8 overflow-hidden shadow-xl print:mb-0 print:overflow-visible print:shadow-none" style={{ width: W * scale, height: H * scale }}>
            <div className="mag-sheet origin-top-left" style={{ width: W, height: H, transform: `scale(${scale})` }}>{p}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
