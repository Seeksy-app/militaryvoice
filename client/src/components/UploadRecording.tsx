import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { durationOf, holdPage, uploadToStorage } from "@/lib/upload";
import { Loader2, Upload } from "lucide-react";
import { IconTile } from "@/components/ui/icon-tile";

/** Add a video you already have: it's filed as a recording, nothing more (clipping is Pōstify's). */
export function UploadRecording({ onDone, tall = false, button = false, autoOpen = false, initialFile, title = "Drop a video here, or click to browse", note = "MP4, MOV or WebM, up to 2GB. Then make clips from it in Pōstify." }: {
  /** One "Upload a video" button (the Library, 26 Nov); the page around it takes drops and passes them as initialFile. */
  button?: boolean;
  /** A file already dropped somewhere else (Social's box): upload it straight away. */
  initialFile?: File | null;
  /** Open the file picker on arrival: the dashboard's + Create › Upload video. */
  autoOpen?: boolean;
  /** Called with the new recording's id once it's filed. */
  onDone?: (id: number) => void;
  /** Fill the space it's given (the Pōstify Viewer), centred, rather than a row. */
  tall?: boolean;
  title?: string;
  note?: string;
} = {}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [pct, setPct] = useState<number | null>(null);
  const [name, setName] = useState("");
  const [over, setOver] = useState(false);
  useEffect(() => {
    if (!autoOpen) return;
    try {
      if (sessionStorage.getItem("mv_open_upload") !== "1") return;
      sessionStorage.removeItem("mv_open_upload");
    } catch {
      return;
    }
    // Still inside the click that asked for it, so the browser lets the picker open.
    input.current?.click();
  }, [autoOpen]);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const started = useRef<File | null>(null);
  useEffect(() => {
    if (initialFile && started.current !== initialFile) { started.current = initialFile; void go(initialFile); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialFile]);
  async function go(file: File) {
    if (!file.type.startsWith("video/") && !/\.(mp4|mov|m4v|webm)$/i.test(file.name)) {
      toast({ title: "That isn't a video", description: "Upload an MP4, MOV or WebM.", variant: "destructive" });
      return;
    }
    if (file.size > 2 * 1024 ** 3) {
      toast({ title: "That file is over 2GB", description: "Export a smaller copy (1080p is plenty) and try again.", variant: "destructive" });
      return;
    }
    // Held until it's filed, not just uploaded: a tab closed in between left
    // the file in storage with nothing in the Library to show for it.
    const release = holdPage();
    try {
      setPct(0);
      setName(file.name);
      const durationSec = await durationOf(file);
      const storageKey = await uploadToStorage(file, setPct);
      const { id } = (await (await apiRequest("POST", "/api/host/uploads/recording", { storageKey, fileName: file.name, durationSec, sizeBytes: file.size })).json()) as { id: number };
      release();
      await qc.invalidateQueries({ queryKey: ["/api/host/recordings"] });
      // Moved to another page while it uploaded: it carried on, so say where it went.
      if (onDone && mounted.current) onDone(id);
      else toast({ title: "Added to your Library", description: "Open it in Pōstify to make clips and a clean episode." });
    } catch (e) {
      toast({ title: "Couldn't upload that", description: (e as Error).message, variant: "destructive" });
    } finally {
      release();
      if (mounted.current) setPct(null);
      if (input.current) input.current.value = "";
    }
  }
  const busy = pct !== null;
  const picker = <input ref={input} type="file" accept="video/*" className="hidden" onChange={(e) => e.target.files?.[0] && void go(e.target.files[0])} data-testid="recording-upload-input" />;
  if (button) {
    return busy ? (
      <span className="inline-flex h-10 min-w-0 max-w-[260px] items-center gap-2 rounded-full border border-[#053877]/25 bg-card px-4 text-[13px] font-semibold text-foreground" title={name} data-testid="recording-upload">
        {picker}<Loader2 className="h-4 w-4 shrink-0 animate-spin text-[#053877] dark:text-[#8fb5e8]" />
        <span className="truncate">{pct! < 100 ? `Uploading ${pct}%` : "Saving…"}</span>
      </span>
    ) : (
      <button type="button" onClick={() => input.current?.click()} className="inline-flex h-10 shrink-0 items-center gap-2 rounded-full bg-[#053877] px-4 text-[14px] font-semibold text-white hover:bg-[#0a4aa0]" title="MP4, MOV or WebM, up to 2GB. You can also drop it anywhere on this page." data-testid="recording-upload">
        {picker}<Upload className="h-4 w-4" /> Upload a video
      </button>
    );
  }
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => !busy && input.current?.click()}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && !busy && input.current?.click()}
      onDragOver={(e) => { e.preventDefault(); if (!busy) setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const f = e.dataTransfer.files?.[0];
        if (f && !busy) void go(f);
      }}
      className={`flex h-full ${tall ? "flex-col items-center justify-center gap-3 text-center" : "items-center gap-4"} rounded-2xl border-2 border-dashed px-5 py-4 transition-colors ${
        busy ? "cursor-default border-[#053877]/30 bg-[#053877]/[0.03]" : over ? "cursor-copy border-[#053877] bg-[#053877]/[0.06]" : "cursor-pointer border-[#053877]/25 bg-card hover:border-[#053877]/50 hover:bg-[#053877]/[0.03]"
      }`}
      data-testid="recording-upload"
    >
      {picker}
      <IconTile icon={busy ? Loader2 : Upload} spin={busy} />
      {busy ? (
        <div className={`min-w-0 ${tall ? "w-full max-w-md" : "flex-1"}`}>
          <p className="truncate text-sm font-semibold text-foreground">{pct! < 100 ? `Uploading ${name}` : `Saving ${name}`}</p>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-[#053877]/10">
            <div className="h-full rounded-full bg-[#053877] transition-[width] duration-300" style={{ width: `${pct}%` }} />
          </div>
          <p className="mt-1 text-xs tabular-nums text-muted-foreground">{pct}% · stay on this page until it's done; after that you can close it</p>
        </div>
      ) : (
        <div className={`min-w-0 ${tall ? "" : "flex-1"}`}>
          <p className={`${tall ? "text-lg" : "text-sm"} font-semibold text-foreground`}>{title}</p>
          <p className="text-xs text-muted-foreground">{note}</p>
        </div>
      )}
    </div>
  );
}
