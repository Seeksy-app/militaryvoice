// Listen Notes (the podcast search engine), through its Podcast API. For now one
// job: list every podcast we host there, the way a hosting service should
// (POST /podcasts/submit). The key is LISTEN_API_KEY; without it nothing runs.
// Their terms: show "Powered by Listen Notes" wherever their data appears, and
// store nothing of theirs but ids and dates.
const BASE = "https://listen-api.listennotes.com/api/v2";

export function isListenNotesConfigured(): boolean {
  return Boolean(process.env.LISTEN_API_KEY);
}

export type ListenNotesSubmit = { status: "found" | "in review" | "rejected"; url: string; id: string };

/** Ask Listen Notes to add a feed. "found" comes back with the show's page; "in review" is checked within 12 hours. */
export async function submitToListenNotes(rss: string): Promise<ListenNotesSubmit> {
  const res = await fetch(`${BASE}/podcasts/submit`, {
    method: "POST",
    headers: { "X-ListenAPI-Key": process.env.LISTEN_API_KEY ?? "", "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ rss }).toString(),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`Listen Notes ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`);
  const j = (await res.json()) as { status?: string; podcast?: { listennotes_url?: string; id?: string } };
  const status = j.status === "found" || j.status === "rejected" ? j.status : "in review";
  return { status, url: j.podcast?.listennotes_url ?? "", id: j.podcast?.id ?? "" };
}
