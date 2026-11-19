/**
 * Pictures from Canva and phones are often 5 MB+ as PNGs, which the server won't take in one request (4.5 MB limit).
 * Anything over ~3 MB is redrawn as a JPEG (never smaller than 1400 on its short side, never bigger than 3000) before it goes up.
 */
export async function shrinkImage(file: File, maxBytes = 3_000_000): Promise<File> {
  if (file.size <= maxBytes) return file;
  try {
    const bmp = await createImageBitmap(file);
    const short = Math.min(bmp.width, bmp.height);
    // Keep at least 1400 on the short side (Apple's rule), at most 3000 on the long side.
    let scale = Math.min(1, 3000 / Math.max(bmp.width, bmp.height));
    for (let attempt = 0; attempt < 5; attempt++) {
      const w = Math.round(bmp.width * scale), h = Math.round(bmp.height * scale);
      const c = document.createElement("canvas");
      c.width = w; c.height = h;
      c.getContext("2d")!.drawImage(bmp, 0, 0, w, h);
      for (const q of [0.92, 0.85, 0.78]) {
        const blob: Blob | null = await new Promise((res) => c.toBlob(res, "image/jpeg", q));
        if (blob && blob.size <= maxBytes) return new File([blob], file.name.replace(/\.\w+$/, "") + ".jpg", { type: "image/jpeg" });
      }
      if (Math.min(w, h) * 0.85 < Math.min(1400, short)) break; // another step down would break the 1400 minimum
      scale *= 0.85;
    }
  } catch { /* fall through: send it as it is */ }
  return file;
}
