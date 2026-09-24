// Vercel Routing Middleware — runs before the static files.
//
// militarycreatoreconomy.com's home page is rendered by the API (server/mce.ts),
// but Vercel serves the built index.html for "/" before any vercel.json rewrite
// is consulted, so on that domain the app's shell won. This hands "/" on that
// host to the page instead. Every other host and path is untouched.
import { rewrite, next } from "@vercel/functions";

export const config = { matcher: ["/"] };

export default function middleware(request: Request): Response {
  const host = (request.headers.get("host") ?? new URL(request.url).hostname).split(":")[0];
  if (!/^(www\.)?militarycreatoreconomy\.com$/i.test(host)) return next();
  return rewrite(new URL("/api/mce", request.url));
}
