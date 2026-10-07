import { useCallback, useEffect, useState } from "react";
import Cropper, { type Area, type Point } from "react-easy-crop";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { getCroppedImageBlob } from "@/lib/cropImage";
import { ZoomIn } from "lucide-react";

interface Props {
  open: boolean;
  imageSrc: string | null;
  onCancel: () => void;
  onConfirm: (blob: Blob) => void;
}

export function PhotoCropDialog({ open, imageSrc, onCancel, onConfirm }: Props) {
  const [crop, setCrop] = useState<Point>({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedArea, setCroppedArea] = useState<Area | null>(null);
  const [busy, setBusy] = useState(false);
  // A logo zoomed out to fit leaves space around it: fill it with the image's own corner colour (or white).
  const [corner, setCorner] = useState("#ffffff");
  const [bg, setBg] = useState<"auto" | "white">("auto");
  useEffect(() => {
    if (!imageSrc) return;
    setZoom(1); setCrop({ x: 0, y: 0 }); setBg("auto");
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
  const fill = bg === "white" ? "#ffffff" : corner;

  const handleCropComplete = useCallback((_area: Area, areaPixels: Area) => {
    setCroppedArea(areaPixels);
  }, []);

  async function handleUse() {
    if (!imageSrc || !croppedArea) return;
    setBusy(true);
    try {
      const blob = await getCroppedImageBlob(imageSrc, croppedArea, undefined, fill);
      onConfirm(blob);
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
          <DialogTitle>Adjust your photo</DialogTitle>
          <DialogDescription>
            Drag to frame your face and use the slider to zoom. A logo? Slide left until all of it fits.
          </DialogDescription>
        </DialogHeader>

        <div className="relative h-72 w-full overflow-hidden rounded-lg" style={{ background: zoom < 1 ? fill : undefined }} data-testid="crop-area">
          {imageSrc && (
            <Cropper
              image={imageSrc}
              crop={crop}
              zoom={zoom}
              aspect={1}
              cropShape="round"
              showGrid={false}
              // The photo covers the frame rather than fitting inside it. With
              // "contain" a portrait photo sat exactly in the circle at zoom 1
              // and could not be moved at all — the drag cursor showed and
              // nothing happened until you zoomed. Covering leaves the long
              // side free to pan from the start.
              objectFit="cover"
              // Below 1 the image can sit inside the circle (a logo, whole).
              minZoom={0.3}
              restrictPosition={zoom >= 1}
              onCropChange={setCrop}
              onZoomChange={setZoom}
              onCropComplete={handleCropComplete}
            />
          )}
        </div>

        <div className="flex items-center gap-3">
          <ZoomIn className="h-4 w-4 shrink-0 text-muted-foreground" />
          <Slider
            value={[zoom]}
            min={0.3}
            max={3}
            step={0.01}
            onValueChange={(v) => setZoom(v[0])}
            data-testid="slider-zoom"
          />
        </div>

        {zoom < 1 && (
          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">Around it:</span>
            {([["auto", "Its own color"], ["white", "White"]] as const).map(([k, l]) => (
              <button key={k} type="button" onClick={() => setBg(k)} className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 ${bg === k ? "border-[#053877] font-semibold" : "border-border"}`}>
                <span className="h-3.5 w-3.5 rounded-full border border-border" style={{ background: k === "white" ? "#ffffff" : corner }} />{l}
              </button>
            ))}
          </div>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onCancel} data-testid="button-crop-cancel">
            Cancel
          </Button>
          <Button type="button" onClick={handleUse} disabled={busy || !croppedArea} data-testid="button-crop-use">
            {busy ? "Applying…" : "Use this photo"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
