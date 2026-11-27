import { useCallback, useEffect, useRef, useState } from "react";
import Cropper, { type Area, type MediaSize, type Point } from "react-easy-crop";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { getCroppedImageBlob } from "@/lib/cropImage";
import { ZoomIn, ZoomOut } from "lucide-react";

interface Props {
  open: boolean;
  imageSrc: string | null;
  onCancel: () => void;
  onConfirm: (blob: Blob) => void;
  /** "cover": a podcast's square cover art (square frame, 1400 to 3000 pixels out, as Apple asks). Default: a round photo. */
  kind?: "photo" | "cover";
  /** A line under the frame, e.g. when reframing a photo that was saved cropped. */
  note?: string;
}

/** The photo as it will sit in a circle of `size` pixels, drawn from the crop (no canvas needed). */
function Preview({ src, area, media, size, fill, label }: { src: string; area: Area; media: MediaSize; size: number; fill: string; label: string }) {
  const k = size / area.width;
  return (
    <div className="flex flex-col items-center gap-1 text-[11px] text-muted-foreground">
      <div
        className="shrink-0 rounded-full ring-1 ring-border"
        style={{
          width: size, height: size, backgroundColor: fill, backgroundImage: `url("${src}")`, backgroundRepeat: "no-repeat",
          backgroundSize: `${media.naturalWidth * k}px ${media.naturalHeight * k}px`, backgroundPosition: `${-area.x * k}px ${-area.y * k}px`,
        }}
      />
      {label}
    </div>
  );
}

export function PhotoCropDialog({ open, imageSrc, onCancel, onConfirm, kind = "photo", note }: Props) {
  const cover = kind === "cover";
  const [crop, setCrop] = useState<Point>({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedArea, setCroppedArea] = useState<Area | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState("");
  // A logo zoomed out to fit leaves space around it: fill it with the image's own corner colour (or white).
  const [corner, setCorner] = useState("#ffffff");
  const [bg, setBg] = useState<"auto" | "white">("auto");
  // Where it opens: the whole short side in the frame (Andrew, 27 Nov: the old start filled the circle with the face,
  // because "cover" makes the photo fill the whole box and the circle took its middle ~72%). Head and shoulders.
  const [media, setMedia] = useState<MediaSize | null>(null);
  const [fit, setFit] = useState(1);
  const placed = useRef(false);
  useEffect(() => {
    if (!imageSrc) return;
    setZoom(1); setCrop({ x: 0, y: 0 }); setBg("auto"); setFailed("");
    setMedia(null); setFit(1); placed.current = false;
    const img = new Image();
    img.onload = () => {
      try {
        const c = document.createElement("canvas");
        c.width = 4; c.height = 4;
        const ctx = c.getContext("2d");
        if (!ctx) return;
        ctx.drawImage(img, 0, 0, Math.max(1, img.naturalWidth / 40), Math.max(1, img.naturalHeight / 40), 0, 0, 4, 4);
        const d = ctx.getImageData(1, 1, 1, 1).data;
        const r = d[0], g = d[1], b = d[2];
        setCorner(`rgb(${r}, ${g}, ${b})`);
      } catch { /* a picture we can't read pixels from: white */ }
    };
    img.src = imageSrc;
  }, [imageSrc]);
  // Worked out from the frame's own layout size and the photo's natural size: react-easy-crop measures while the
  // dialog is still animating in, and its first sizes can say the photo already fits (it opened at 1 on a laptop).
  const frame = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (placed.current || !media) return;
    let raf = 0;
    const place = () => {
      const W = frame.current?.offsetWidth ?? 0, H = frame.current?.offsetHeight ?? 0;
      if (!W || !H) { raf = requestAnimationFrame(place); return; }
      placed.current = true;
      const nw = media.naturalWidth, nh = media.naturalHeight;
      const s = Math.max(W / nw, H / nh); // "cover" at zoom 1
      const side = Math.min(W, H); // the square frame
      const f = Math.min(1, side / (Math.min(nw, nh) * s));
      setFit(f);
      setZoom(f);
      // A tall photo: the head is near the top, so start there (a little headroom kept).
      if (!cover && nh > nw * 1.15) setCrop({ x: 0, y: ((nh * s * f - side) / 2) * 0.85 });
    };
    place();
    return () => cancelAnimationFrame(raf);
  }, [media, cover]);
  const fill = bg === "white" ? "#ffffff" : corner;
  const under = zoom < fit - 0.005;

  const handleCropComplete = useCallback((_area: Area, areaPixels: Area) => {
    setCroppedArea(areaPixels);
  }, []);

  async function handleUse() {
    if (!imageSrc || !croppedArea) return;
    setBusy(true);
    setFailed("");
    try {
      const blob = await getCroppedImageBlob(imageSrc, croppedArea, cover ? Math.max(1400, Math.min(3000, Math.round(croppedArea.width))) : undefined, fill);
      onConfirm(blob);
    } catch {
      setFailed("We couldn't reframe this one here. Upload the photo again instead.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onCancel();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{cover ? "Crop your cover" : "Frame your photo"}</DialogTitle>
          <DialogDescription>
            {cover ? "Drag to place it in the square and use the slider to zoom. Slide left to fit all of it." : "Drag to move it. Slide left to see more of you."}
          </DialogDescription>
        </DialogHeader>

        <div ref={frame} className="relative h-72 w-full overflow-hidden rounded-lg" style={{ background: under ? fill : undefined }} data-testid="crop-area">
          {imageSrc && (
            <Cropper
              image={imageSrc}
              crop={crop}
              zoom={zoom}
              aspect={1}
              cropShape={cover ? "rect" : "round"}
              showGrid={false}
              // The photo covers the frame rather than fitting inside it. With
              // "contain" a portrait photo sat exactly in the circle at zoom 1
              // and could not be moved at all. Covering leaves the long side
              // free to pan; it opens at the fit zoom above, not at 1.
              objectFit="cover"
              // Below the fit the image can sit inside the frame (a logo, whole).
              minZoom={0.3}
              restrictPosition={!under}
              onCropChange={setCrop}
              onZoomChange={setZoom}
              onCropComplete={handleCropComplete}
              onMediaLoaded={setMedia}
            />
          )}
        </div>

        <div className="flex items-center gap-3 text-muted-foreground">
          <ZoomOut className="h-4 w-4 shrink-0" aria-hidden />
          <Slider value={[zoom]} min={0.3} max={3} step={0.01} onValueChange={(v) => setZoom(v[0])} aria-label="Zoom" data-testid="slider-zoom" />
          <ZoomIn className="h-4 w-4 shrink-0" aria-hidden />
        </div>

        {under && (
          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">Around it:</span>
            {([["auto", "Its own color"], ["white", "White"]] as const).map(([k, l]) => (
              <button key={k} type="button" onClick={() => setBg(k)} className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 ${bg === k ? "border-[#053877] font-semibold" : "border-border"}`}>
                <span className="h-3.5 w-3.5 rounded-full border border-border" style={{ background: k === "white" ? "#ffffff" : corner }} />{l}
              </button>
            ))}
          </div>
        )}

        {!cover && imageSrc && croppedArea && media && (
          <div className="flex items-end gap-4 border-t border-border pt-3" data-testid="crop-previews">
            <span className="mr-auto self-center text-xs font-semibold text-muted-foreground">How it looks</span>
            <Preview src={imageSrc} area={croppedArea} media={media} size={56} fill={fill} label="Profile" />
            <Preview src={imageSrc} area={croppedArea} media={media} size={40} fill={fill} label="Directory" />
            <Preview src={imageSrc} area={croppedArea} media={media} size={28} fill={fill} label="Lineup" />
          </div>
        )}

        {note && <p className="text-xs text-muted-foreground [text-wrap:pretty]">{note}</p>}
        {failed && <p className="text-xs font-medium text-destructive" role="alert">{failed}</p>}

        <DialogFooter className="gap-2">
          <Button type="button" variant="outline" onClick={onCancel} data-testid="button-crop-cancel">
            Cancel
          </Button>
          <Button type="button" onClick={handleUse} disabled={busy || !croppedArea} data-testid="button-crop-use">
            {busy ? "Applying…" : cover ? "Use this cover" : "Use this photo"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
