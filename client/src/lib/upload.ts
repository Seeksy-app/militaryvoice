import { API_BASE } from "@/lib/queryClient";

/**
 * How long a video runs, read in the browser before it's sent. Never holds
 * the upload up: a file the browser can't read (HEVC .mov, a background tab
 * that defers media) answers 0 after a few seconds and the server measures it.
 */
export function durationOf(file: File): Promise<number> {
  return new Promise((resolve) => {
    const v = document.createElement("video");
    const url = URL.createObjectURL(file);
    const done = (sec: number) => { clearTimeout(t); URL.revokeObjectURL(url); v.removeAttribute("src"); resolve(sec); };
    const t = setTimeout(() => done(0), 6000);
    v.preload = "metadata";
    v.muted = true;
    v.onloadedmetadata = () => done(Number.isFinite(v.duration) ? v.duration : 0);
    v.onerror = () => done(0);
    v.src = url;
  });
}

/** One PUT with progress — fetch can't report upload progress, and an episode is hundreds of MB. */
function putOnce(url: string, file: File, onProgress: (pct: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("content-type", file.type || "video/mp4");
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(Math.round((e.loaded / e.total) * 100));
    xhr.onload = () => (xhr.status < 300 ? resolve() : reject(Object.assign(new Error(`Upload refused (${xhr.status})`), { refused: true })));
    xhr.onerror = () => reject(new Error("The upload was interrupted. Check your connection and try again."));
    xhr.send(file);
  });
}

/**
 * PUT with progress, and three more tries when the connection drops: a big
 * file over home Wi-Fi drops now and then, and starting again by hand after
 * 20 minutes is the worst of it. A refusal (a 4xx/5xx answer) isn't retried.
 */
export async function putWithProgress(url: string, file: File, onProgress: (pct: number) => void): Promise<void> {
  const waits = [2000, 5000, 15000];
  for (let attempt = 0; ; attempt++) {
    try {
      return await putOnce(url, file, onProgress);
    } catch (err) {
      if ((err as { refused?: boolean }).refused || attempt >= waits.length) throw err;
      onProgress(0);
      // Offline: wait for the connection to come back rather than burn a try.
      if (typeof navigator !== "undefined" && navigator.onLine === false) {
        await new Promise<void>((r) => window.addEventListener("online", () => r(), { once: true }));
      }
      await new Promise((r) => setTimeout(r, waits[attempt]));
    }
  }
}

// ---- Resumable uploads -------------------------------------------------------

// ?uploadtest=1 sends anything over 1MB in 5MB parts (storage's smallest), so
// the multipart path can be tried with a small file.
const TESTING = typeof location !== "undefined" && /[?&]uploadtest=1\b/.test(location.search);
const PART = (TESTING ? 5 : 16) * 1024 * 1024;
/** Under this, one PUT is simpler and just as quick. */
const MULTIPART_OVER = (TESTING ? 1 : 24) * 1024 * 1024;
const LANES = 4;

type Saved = { storageKey: string; uploadId: string; etags: Record<number, string>; at: number };
const savedKey = (f: File) => `mv_upload:${f.name}:${f.size}:${f.lastModified}`;
function readSaved(f: File): Saved | null {
  try {
    const s = JSON.parse(localStorage.getItem(savedKey(f)) || "null") as Saved | null;
    // Parts are kept by storage for days; a week-old upload starts fresh.
    return s && Date.now() - s.at < 5 * 86_400_000 ? s : null;
  } catch {
    return null;
  }
}
function writeSaved(f: File, s: Saved | null) {
  try {
    if (s) localStorage.setItem(savedKey(f), JSON.stringify({ ...s, at: Date.now() }));
    else localStorage.removeItem(savedKey(f));
  } catch { /* private window: it still uploads, it just can't resume after a reload */ }
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(`${API_BASE}${path}`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok) throw Object.assign(new Error((await r.json().catch(() => null))?.message || `Upload error (${r.status})`), { status: r.status });
  return r.json() as Promise<T>;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const online = () =>
  typeof navigator === "undefined" || navigator.onLine !== false
    ? Promise.resolve()
    : new Promise<void>((r) => window.addEventListener("online", () => r(), { once: true }));

/** One part; resolves with its ETag. */
function putPart(url: string, blob: Blob, onBytes: (n: number) => void): Promise<string> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.upload.onprogress = (e) => onBytes(e.loaded);
    xhr.onload = () => {
      const etag = xhr.getResponseHeader("ETag");
      if (xhr.status < 300 && etag) resolve(etag);
      else reject(Object.assign(new Error(`Upload refused (${xhr.status})`), { status: xhr.status }));
    };
    xhr.onerror = () => reject(new Error("The upload was interrupted."));
    xhr.send(blob);
  });
}

/**
 * Put a file in storage and return its key. Big files go in 16MB parts, four
 * at a time, each retried on its own when the connection drops — and if the
 * tab closes, choosing the same file again carries on from the parts already
 * there. Small files are one PUT.
 */
export async function uploadToStorage(file: File, onProgress: (pct: number) => void): Promise<string> {
  // Unlike the processing after it, an upload lives in this tab: leaving
  // stops it, so the browser asks first.
  const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
  window.addEventListener("beforeunload", warn);
  try {
    return await upload(file, onProgress);
  } finally {
    window.removeEventListener("beforeunload", warn);
  }
}

async function upload(file: File, onProgress: (pct: number) => void): Promise<string> {
  if (file.size <= MULTIPART_OVER) {
    const { uploadUrl, storageKey } = await post<{ uploadUrl: string; storageKey: string }>("/api/host/assets/upload-url", { fileName: file.name });
    await putWithProgress(uploadUrl, file, onProgress);
    return storageKey;
  }
  const total = Math.ceil(file.size / PART);
  for (let fresh = 0; fresh < 2; fresh++) {
    let saved = readSaved(file);
    if (!saved) {
      const started = await post<{ storageKey: string; uploadId: string }>("/api/host/uploads/multipart/start", { fileName: file.name, contentType: file.type || "video/mp4" });
      saved = { ...started, etags: {}, at: Date.now() };
      writeSaved(file, saved);
    }
    const s = saved;
    const sent: Record<number, number> = {};
    for (const n of Object.keys(s.etags)) sent[Number(n)] = Math.min(PART, file.size - (Number(n) - 1) * PART);
    const report = () => onProgress(Math.min(99, Math.round((Object.values(sent).reduce((a, b) => a + b, 0) / file.size) * 100)));
    report();

    const todo = Array.from({ length: total }, (_, i) => i + 1).filter((n) => !s.etags[n]);
    const urls: Record<number, string> = {};
    let gone = false;
    // Sign ahead in batches so a 2GB file isn't 128 round trips.
    const urlFor = async (n: number) => {
      if (!urls[n]) {
        const batch = todo.filter((m) => m >= n && !urls[m]).slice(0, 20);
        Object.assign(urls, (await post<{ urls: Record<number, string> }>("/api/host/uploads/multipart/parts", { storageKey: s.storageKey, uploadId: s.uploadId, parts: batch })).urls);
      }
      return urls[n];
    };
    let next = 0;
    const lane = async () => {
      while (!gone && next < todo.length) {
        const n = todo[next++];
        const blob = file.slice((n - 1) * PART, Math.min(n * PART, file.size));
        for (let attempt = 0; ; attempt++) {
          try {
            await online();
            s.etags[n] = await putPart(await urlFor(n), blob, (b) => { sent[n] = b; report(); });
            sent[n] = blob.size;
            writeSaved(file, s);
            report();
            break;
          } catch (err) {
            const status = (err as { status?: number }).status ?? 0;
            // The upload itself is gone (expired or finished elsewhere): start over once.
            if (status === 404) { gone = true; return; }
            // A signature that aged out: sign again.
            if (status === 403) delete urls[n];
            if (attempt >= 7) throw new Error("The upload kept dropping. Check your connection and choose the file again: it carries on from where it stopped.");
            sent[n] = 0;
            report();
            await sleep([1000, 2000, 4000, 8000, 15000, 30000, 30000][attempt] ?? 30000);
          }
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(LANES, todo.length) }, lane));
    if (gone) { writeSaved(file, null); continue; }

    const parts = Object.entries(s.etags).map(([n, etag]) => ({ partNumber: Number(n), etag }));
    try {
      await post("/api/host/uploads/multipart/complete", { storageKey: s.storageKey, uploadId: s.uploadId, parts });
    } catch (err) {
      writeSaved(file, null);
      if (fresh === 0 && (err as { status?: number }).status === 502) continue;
      throw err;
    }
    writeSaved(file, null);
    onProgress(100);
    return s.storageKey;
  }
  throw new Error("Couldn't upload that. Try again.");
}
