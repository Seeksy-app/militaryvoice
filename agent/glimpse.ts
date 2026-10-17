// The clip worker's side of the Glimpse pilot (see server/glimpse.ts).
//
// Once a minute it asks the server for a clip to review. The server says no
// unless an admin switched Glimpse on, asked for that recording, and the day's
// budget allows it. Then: cut the clip's excerpt from the episode (720p), put
// it in our storage behind a 6-hour signed link, and ask Elorian about it in
// one plain request. The answer goes back to the server as it came; the server
// checks it. Nothing is retried: a request that timed out may have been run
// and charged, so it's reported as "unknown" and left there.
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const ELORIAN = "https://api.elorian.ai/v1/chat/completions";
const POLL_MS = 60_000;
/** One request can run long (it watches the video, then thinks); past this we stop waiting. */
const TIMEOUT_MS = 20 * 60_000;

type Api = <T>(method: string, path: string, body?: unknown) => Promise<T>;
type Run = (cmd: string, args: string[]) => Promise<string>;
export type Job = { clipId: number; recordingId: number; sourceUrl: string; startSec: number; durationSec: number; model: string; maxTokens: number; prompt: string };

const key = () => (process.env.ELORIAN_API_KEY ?? "").trim();

export async function reviewOne(api: Api, run: Run, job: Job): Promise<void> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "glimpse-"));
  const post = (b: Record<string, unknown>) => api("POST", `/api/agent/glimpse/${job.clipId}/result`, b);
  try {
    const cut = path.join(dir, `glimpse-${job.clipId}.mp4`);
    await run("ffmpeg", ["-y", "-v", "error", "-ss", String(job.startSec), "-i", job.sourceUrl, "-t", String(job.durationSec), "-vf", "scale=-2:'min(720,ih)'", "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-c:a", "aac", "-b:a", "96k", "-movflags", "+faststart", cut]);
    const signed = await api<{ uploadUrl: string; readUrl: string }>("POST", "/api/agent/clean-files/upload-url", { name: `glimpse-${job.recordingId}-${job.clipId}.mp4` });
    await run("curl", ["-s", "-f", "--retry", "5", "--retry-all-errors", "--retry-delay", "3", "-X", "PUT", "-T", cut, signed.uploadUrl, "-H", "content-type: video/mp4"]);

    let res: Response;
    try {
      res = await fetch(ELORIAN, {
        method: "POST",
        headers: { Authorization: `Bearer ${key()}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: job.model,
          messages: [{ role: "user", content: [{ type: "text", text: job.prompt }, { type: "video_url", video_url: { url: signed.readUrl } }] }],
          max_completion_tokens: job.maxTokens,
          reasoning_effort: "medium",
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      // Sent, but no answer: it may have run. Not retried.
      await post({ ok: false, ambiguous: true, error: `No answer from Elorian (${(err as Error).message}). It may still have run and been charged.` });
      return;
    }
    const requestId = res.headers.get("x-request-id") ?? "";
    // A long request is kept open with blank lines, so trim before reading it.
    const raw = (await res.text()).trim();
    let j: any = null;
    try { j = JSON.parse(raw); } catch { /* reported below */ }
    // An error can come back with a 200, after the keep-alive.
    if (!res.ok || !j || j.error) {
      const code = String(j?.error?.code ?? j?.error?.type ?? "");
      await post({ ok: false, status: res.status, code, requestId, usage: j?.usage ?? null, error: `Elorian ${res.status}${code ? ` ${code}` : ""}: ${String(j?.error?.message ?? raw).slice(0, 300)}` });
      return;
    }
    await post({ ok: true, requestId, model: j.model, usage: j.usage ?? null, text: String(j.choices?.[0]?.message?.content ?? "") });
    console.log(`[glimpse] clip ${job.clipId}: reviewed (${j.usage?.prompt_tokens ?? "?"} in, ${j.usage?.completion_tokens ?? "?"} out)`);
  } catch (err) {
    // Our side failed (the cut, the upload) before anything went to Elorian.
    await post({ ok: false, error: `Couldn't prepare the excerpt: ${(err as Error).message.slice(0, 300)}` }).catch(() => {});
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/** Runs beside the clip lanes. Without a key it only tells the server so, every few minutes. */
export async function glimpseLane(api: Api, run: Run): Promise<void> {
  for (;;) {
    try {
      const { job } = await api<{ job: Job | null }>("POST", "/api/agent/glimpse/claim", { hasKey: key().startsWith("elor_sk_") });
      if (job) { await reviewOne(api, run, job); continue; }
    } catch (err) {
      console.error("[glimpse] poll failed:", (err as Error).message);
    }
    await new Promise((r) => setTimeout(r, key() ? POLL_MS : 5 * POLL_MS));
  }
}
