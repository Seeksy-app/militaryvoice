/** How long a video runs, read in the browser before it's sent. */
export function durationOf(file: File): Promise<number> {
  return new Promise((resolve) => {
    const v = document.createElement("video");
    v.preload = "metadata";
    v.onloadedmetadata = () => { URL.revokeObjectURL(v.src); resolve(Number.isFinite(v.duration) ? v.duration : 0); };
    v.onerror = () => resolve(0);
    v.src = URL.createObjectURL(file);
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
