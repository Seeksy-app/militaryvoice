// Vercel Routing Middleware — runs before the static files.
//
// 1. militarycreatoreconomy.com's home page is rendered by the API
//    (server/mce.ts), but Vercel serves the built index.html for "/" before
//    any vercel.json rewrite is consulted, so on that domain the app's shell
//    won. This hands "/" on that host to the page instead.
// 2. A page shared on its own (a pitch link) needs its own preview. LinkedIn
//    and the rest read the HTML without running the app, so they only ever saw
//    the site-wide card. For the paths below, the same index.html goes out with
//    that page's title, description and image in the share tags.
import { rewrite, next } from "@vercel/functions";

export const config = { matcher: ["/", "/podcast-one-pitch"] };

const ORIGIN = "https://www.militaryvoices.ai";
const SHARE: Record<string, { title: string; description: string; image: string; alt: string }> = {
  "/podcast-one-pitch": {
    title: "26.2 miles of military podcasts — National Military Podcast Day, October 5",
    description: "Thirty-two military and veteran shows, back to back, in one broadcast day, hosted by Emmy winner Riccoh Player (USMC, Retired). Segments from $250.",
    image: `${ORIGIN}/og-podcast-one-pitch.jpg?v=2`,
    alt: "26.2 miles of military podcasts: 32 shows, 234,000+ combined following, hosted by Riccoh Player",
  },
};

const attr = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

function withShare(html: string, path: string, s: (typeof SHARE)[string]): string {
  const meta = (key: "property" | "name", k: string, v: string) =>
    (h: string) => h.replace(new RegExp(`(<meta\\s+${key}="${k.replace(/[:.]/g, "\\$&")}"\\s+content=")[^"]*(")`), `$1${attr(v)}$2`);
  let h = html.replace(/<title>[^<]*<\/title>/, `<title>${attr(s.title)}</title>`);
  for (const f of [
    meta("property", "og:title", s.title),
    meta("property", "og:url", `${ORIGIN}${path}`),
    meta("property", "og:image", s.image),
    meta("property", "og:image:secure_url", s.image),
    meta("property", "og:image:alt", s.alt),
    meta("name", "twitter:title", s.title),
    meta("name", "twitter:image", s.image),
    meta("name", "twitter:image:alt", s.alt),
  ]) h = f(h);
  // The two descriptions are written over several lines in index.html.
  h = h.replace(/(<meta\s+(?:name="description"|property="og:description"|name="twitter:description")\s+content=")[^"]*(")/g, `$1${attr(s.description)}$2`);
  return h;
}

export default async function middleware(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const host = (request.headers.get("host") ?? url.hostname).split(":")[0];
  if (/^(www\.)?militarycreatoreconomy\.com$/i.test(host)) {
    return url.pathname === "/" ? rewrite(new URL("/api/mce", request.url)) : next();
  }
  const share = SHARE[url.pathname];
  if (!share) return next();
  const res = await fetch(new URL("/index.html", request.url));
  if (!res.ok) return next();
  return new Response(withShare(await res.text(), url.pathname, share), {
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=0, must-revalidate" },
  });
}
