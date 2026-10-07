export interface CropArea {
  x: number;
  y: number;
  width: number;
  height: number;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.addEventListener("load", () => resolve(img));
    img.addEventListener("error", (e) => reject(e));
    img.src = src;
  });
}

/**
 * Crops an image to the given pixel area (from react-easy-crop's onCropComplete)
 * and returns a square JPEG Blob, capped at `outputSize` px per side so we don't
 * ship enormous uploads for high-res source photos.
 */
export async function getCroppedImageBlob(
  imageSrc: string,
  crop: CropArea,
  outputSize?: number,
  /** Fills the square where the image doesn't reach (a logo zoomed out to fit whole). */
  background = "#ffffff",
): Promise<Blob> {
  const image = await loadImage(imageSrc);
  // Keep the source's own resolution, up to 2000px a side: the photo goes on
  // the stage and in print, and a 1000px cap made a hi-res upload soft.
  outputSize = outputSize ?? Math.max(1000, Math.min(2000, Math.round(crop.width)));
  const canvas = document.createElement("canvas");
  canvas.width = outputSize;
  canvas.height = outputSize;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Couldn't prepare that photo — try a different browser.");

  // The crop can run past the image's edges when a logo is zoomed out to fit:
  // paint the background, then place the whole image where the crop puts it
  // (a source rectangle outside the image fails silently in some browsers).
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, outputSize, outputSize);
  const scale = outputSize / crop.width;
  ctx.drawImage(image, -crop.x * scale, -crop.y * scale, image.naturalWidth * scale, image.naturalHeight * scale);

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error("Couldn't process that photo — try a different file."));
      },
      "image/jpeg",
      0.92
    );
  });
}

/** Vercel refuses a request body over 4.5MB before our code sees it; stay under with room for the form. */
const UPLOAD_CAP = 4 * 1024 * 1024;

/**
 * A photo small enough to upload, still big enough to print: under the cap it
 * goes as it is; over it, it's redrawn at up to `maxSide` px on the long edge
 * as a JPEG, stepping the quality down until it fits. A file the browser can't
 * read (HEIC in Chrome, say) comes back unchanged for the server to judge.
 */
export async function fitForUpload(file: File, maxSide = 3600): Promise<Blob> {
  if (file.size <= UPLOAD_CAP) return file;
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    return file;
  }
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) return file;
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  for (const q of [0.92, 0.85, 0.78, 0.7]) {
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", q));
    if (blob && blob.size <= UPLOAD_CAP) return blob;
  }
  return file;
}
