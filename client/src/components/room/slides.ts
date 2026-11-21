// Slides (StreamYard's "Slides", 21 Nov): a PDF becomes one picture per page, drawn here in the
// browser with pdf.js (loaded only when someone presents a PDF), then uploaded like any picture.
// PowerPoint, Keynote and Google Slides all save as PDF.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import type { Asset } from "@/components/room/look";

export const SLIDES_MAX = 60;
export type Deck = { name: string; pages: Asset[] };

/** Each page as a JPEG that fits 1920×1080, on white (a PDF page has no background of its own). */
export async function pdfToPictures(file: File, onPage: (i: number, n: number) => void): Promise<File[]> {
  // The legacy build runs on older Safari (iPad) too.
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const worker = (await import("pdfjs-dist/legacy/build/pdf.worker.min.mjs?url")).default;
  pdfjs.GlobalWorkerOptions.workerSrc = worker;
  let doc;
  try { doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise; }
  catch (e) { throw new Error((e as Error).name === "PasswordException" ? "That PDF has a password. Save a copy without one, then try again." : "We couldn't open that PDF. Save it again as a PDF and try once more."); }
  const n = doc.numPages;
  if (n > SLIDES_MAX) throw new Error(`That PDF has ${n} pages. Present up to ${SLIDES_MAX} at a time.`);
  const out: File[] = [];
  const base = file.name.replace(/\.pdf$/i, "").slice(0, 60) || "Slides";
  for (let i = 1; i <= n; i++) {
    onPage(i, n);
    const page = await doc.getPage(i);
    const one = page.getViewport({ scale: 1 });
    const scale = Math.min(1920 / one.width, 1080 / one.height);
    const vp = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(vp.width);
    canvas.height = Math.round(vp.height);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("This browser can't draw the slides. Try Chrome.");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.88));
    if (!blob) throw new Error("We couldn't draw one of the slides. Try again.");
    out.push(new File([blob], `${base} ${i}.jpg`, { type: "image/jpeg" }));
    page.cleanup();
  }
  await doc.destroy();
  return out;
}

const KEY = ["/api/host/my-studio/deck"];
/** The studio's deck (owner only), kept on the server so the arrows work from any computer. */
export function useDeck(owner: boolean) {
  const qc = useQueryClient();
  const q = useQuery<{ deck: Deck | null }>({ queryKey: KEY, enabled: owner, retry: false, staleTime: 30_000, queryFn: async () => (await apiRequest("GET", KEY[0])).json() });
  const save = async (name: string, pages: Asset[]) => {
    const r = await (await apiRequest("PUT", KEY[0], { name, ids: pages.map((p) => p.id) })).json() as { deck: Deck | null };
    qc.setQueryData(KEY, r);
    return r.deck;
  };
  return { deck: q.data?.deck ?? null, save };
}
