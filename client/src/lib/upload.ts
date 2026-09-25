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

/** PUT with progress — fetch can't report upload progress, and an episode is hundreds of MB. */
export function putWithProgress(url: string, file: File, onProgress: (pct: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("content-type", file.type || "video/mp4");
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(Math.round((e.loaded / e.total) * 100));
    xhr.onload = () => (xhr.status < 300 ? resolve() : reject(new Error(`Upload refused (${xhr.status})`)));
    xhr.onerror = () => reject(new Error("The upload was interrupted. Check your connection and try again."));
    xhr.send(file);
  });
}
