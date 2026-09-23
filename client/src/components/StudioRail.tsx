import { useEffect, useRef, useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { MediaLibrary, type MediaItem } from "@/components/MediaLibrary";
import { LOGO_CORNERS, type StudioRow } from "@shared/schema";
import { Captions, Image as ImageIcon, Layers, ScrollText, Upload, X, Check, Plus, Pencil, Trash2 } from "lucide-react";

// The graphics rail, down the right-hand side of the stage.
//
// Restream's version of this is four icons that open four drawers, and it is
// the right shape: mid-show you are reaching for one known thing, and a fixed
// icon in a fixed place beats a row of tabs that reflow. What is *not* right
// is where they put the lower third. Theirs lives in a panel of its own, so
// taking a new scene and changing the name bar are two separate acts a
// producer has to remember to do together — and the one everybody forgets is
// the second one, which is why half of live video has the wrong name on
// screen. Here the banner belongs to the scene: taking the scene puts its
// lower third up, and a scene with no banner takes the last one down. This
// panel is for the thing that was not planned — you type it, you hit air.
//
// The ticker stays studio-level on purpose. It runs across the handoffs,
// which is the only reason to have one.

/**
 * A hover tip that actually appears.
 *
 * `title=` leaves it to the browser: about a second of delay, rendered in the
 * OS's own light chrome, and on a dark fullscreen console it either never
 * shows or shows somewhere unhelpful. This is the app's tooltip, at 250ms,
 * which is the difference between a hint and a thing nobody knew was there.
 */
export function Hint({
  label,
  children,
  side = "left",
}: {
  label: string;
  children: React.ReactNode;
  side?: "top" | "right" | "bottom" | "left";
}) {
  return (
    <Tooltip delayDuration={250}>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side={side} className="max-w-[16rem] text-xs leading-snug">
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

interface SavedThird {
  id: number;
  title: string;
  subtitle: string;
}

export type RailPanel = "banner" | "ticker" | "background" | "logo" | "media";

interface Props {
  studio: StudioRow | null;
  media: MediaItem[];
  /** Whether the current scene carries its own lower third. */
  sceneBanner: { name: string; title: string } | null;
  patch: (p: Partial<StudioRow>) => void;
  uploadLogo: (f: File) => void;
  logoBusy: boolean;
  adminGet: <T>(path: string) => Promise<T>;
  adminSend: (method: string, path: string, body?: unknown) => Promise<Response>;
  studioId: number | null;
  onMediaChanged: () => void;
}

/** A tooltip that repeats the label teaches nobody anything. */
const HELP: Record<RailPanel, string> = {
  banner: "The name bar across the bottom of the frame. Scenes carry their own; this is for anything unplanned.",
  ticker: "A line of text crawling along the bottom, running through every scene change.",
  background: "An image behind the cameras, visible in the gaps around the tiles.",
  logo: "Your mark in a corner of the frame, burned into the recording and every destination.",
  media: "Clips, slides and sponsor cards you can put on the stage — and where you upload new ones.",
};

const TABS: { key: RailPanel; icon: typeof Captions; label: string }[] = [
  { key: "banner", icon: Captions, label: "Lower third" },
  { key: "ticker", icon: ScrollText, label: "Ticker" },
  { key: "background", icon: Layers, label: "Background" },
  { key: "logo", icon: ImageIcon, label: "Logo" },
  { key: "media", icon: Upload, label: "Media" },
];

export function StudioRail({
  studio,
  media,
  sceneBanner,
  patch,
  uploadLogo,
  logoBusy,
  adminGet,
  adminSend,
  studioId,
  onMediaChanged,
}: Props) {
  const [open, setOpen] = useState<RailPanel | null>(null);
  const logoFileRef = useRef<HTMLInputElement | null>(null);

  return (
    <>
      {open && (
        <aside
          className="flex w-[330px] shrink-0 flex-col border-l border-white/20 bg-[#04102b]"
          data-testid={`rail-panel-${open}`}
        >
          <div className="flex h-9 shrink-0 items-center justify-between border-b border-white/20 pl-3 pr-1.5">
            <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-white/60">
              {TABS.find((t) => t.key === open)?.label}
            </span>
            <button
              type="button"
              onClick={() => setOpen(null)}
              className="rounded-md p-1.5 text-white/60 transition-colors hover:bg-white/10 hover:text-white"
              aria-label="Close the panel"
              data-testid="button-rail-close"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2.5">
            {open === "banner" && (
              <BannerPanel
                studio={studio}
                sceneBanner={sceneBanner}
                patch={patch}
                adminGet={adminGet}
                adminSend={adminSend}
              />
            )}
            {open === "ticker" && <TickerPanel studio={studio} patch={patch} />}
            {open === "background" && (
              <BackgroundPanel studio={studio} media={media} patch={patch} adminSend={adminSend} onMediaChanged={onMediaChanged} />
            )}
            {open === "logo" && (
              <LogoPanel studio={studio} patch={patch} uploadLogo={uploadLogo} logoBusy={logoBusy} fileRef={logoFileRef} />
            )}
            {open === "media" && (
              // The library is a light surface on purpose: it is a list of
              // files to read, not a control you hit in the dark mid-take.
              <div className="flex flex-col gap-2.5">
                <UploadTile
                  accept="video/*,image/*"
                  kind="Other"
                  hint="Clips, sponsor cards, slides. Full episodes are fine — it uploads straight to us."
                  adminSend={adminSend}
                  onDone={onMediaChanged}
                  testId="button-media-upload"
                />
                <div className="rounded-lg bg-background p-2.5 text-foreground">
                <MediaLibrary
                  adminGet={adminGet}
                  adminSend={adminSend}
                  studioId={studioId}
                  playingUrl={studio?.stageMediaUrl ?? ""}
                  isPlaying={Boolean(studio?.stageMediaPlaying)}
                  onChanged={onMediaChanged}
                  compact
                />
                </div>
              </div>
            )}
          </div>
        </aside>
      )}

      {/* The strip itself. Always visible, always in the same place — that is
          the whole value of it during a show. */}
      <nav
        className="flex w-[5.5rem] shrink-0 flex-col items-center gap-1 border-l border-white/20 bg-[#000741] py-3"
        aria-label="Graphics"
      >
        {TABS.map(({ key, icon: Icon, label }) => {
          const live =
            (key === "banner" && studio?.bannerVisible && studio?.bannerTitle) ||
            (key === "ticker" && studio?.tickerVisible && studio?.tickerText) ||
            (key === "background" && studio?.backgroundVisible && studio?.backgroundUrl) ||
            (key === "logo" && studio?.logoVisible && studio?.logoUrl) ||
            (key === "media" && studio?.stageMediaPlaying);
          return (
            <Hint key={key} label={HELP[key]} side="left">
            <button
              type="button"
              onClick={() => setOpen((v) => (v === key ? null : key))}
              className={`relative flex w-[4.75rem] flex-col items-center gap-1.5 rounded-xl px-1 py-2.5 text-[11px] font-medium leading-[1.15] transition-colors ${
                open === key ? "bg-white/15 text-white" : "text-white/60 hover:bg-white/10 hover:text-white"
              }`}
              data-testid={`button-rail-${key}`}
            >
              <Icon className="h-5 w-5" />
              <span className="w-full text-balance text-center">{label}</span>
              {/* A dot, not a colour change: the producer needs to know what is
                  on air without opening anything. */}
              {live && (
                <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-[#ED1C24]" aria-hidden="true" />
              )}
            </button>
            </Hint>
          );
        })}
      </nav>
    </>
  );
}

/**
 * Straight to storage, then tell the API where it landed.
 *
 * Same shape as the podcasters' upload and for the same reason: a sponsor reel
 * is hundreds of megabytes and a serverless request body is not.
 */
async function uploadToLibrary(
  file: File,
  kind: string,
  adminSend: (method: string, path: string, body?: unknown) => Promise<Response>,
  onProgress: (pct: number) => void,
): Promise<string> {
  onProgress(1);
  const signed = await (await adminSend("POST", "/api/admin/media/upload-url", { fileName: file.name })).json();
  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", signed.uploadUrl);
    xhr.setRequestHeader("content-type", file.type || "application/octet-stream");
    // fetch cannot report upload progress, which on a big file is the
    // difference between a bar and a page that looks hung.
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.max(1, Math.round((e.loaded / e.total) * 100)));
    };
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Upload failed (${xhr.status}).`));
    xhr.onerror = () => reject(new Error("The upload was interrupted."));
    xhr.send(file);
  });
  await adminSend("POST", "/api/admin/media", {
    uploadedUrl: signed.publicUrl,
    fileName: file.name,
    label: file.name.replace(/\.[^.]+$/, ""),
    kind,
    sizeBytes: file.size,
  });
  return signed.publicUrl as string;
}

/** A file picker that looks like the rest of the rail. */
function UploadTile({
  accept,
  kind,
  hint,
  adminSend,
  onDone,
  testId,
}: {
  accept: string;
  kind: string;
  hint: string;
  adminSend: (method: string, path: string, body?: unknown) => Promise<Response>;
  onDone: (url: string) => void;
  testId: string;
}) {
  const { toast } = useToast();
  const ref = useRef<HTMLInputElement | null>(null);
  const [pct, setPct] = useState(0);

  return (
    <div className="flex flex-col gap-1.5">
      <input
        ref={ref}
        type="file"
        accept={accept}
        className="hidden"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (!f) return;
          try {
            onDone(await uploadToLibrary(f, kind, adminSend, setPct));
            toast({ title: "Added to the library", description: f.name });
          } catch (err) {
            toast({ title: "Couldn't upload that", description: (err as Error).message, variant: "destructive" });
          } finally {
            setPct(0);
          }
        }}
        data-testid={`${testId}-input`}
      />
      <Button
        size="sm"
        variant="outline"
        className="h-8 gap-1.5 rounded-full border-white/30 bg-transparent text-xs text-white hover:bg-white/10 hover:text-white"
        disabled={pct > 0}
        onClick={() => ref.current?.click()}
        data-testid={testId}
      >
        <Upload className="h-3.5 w-3.5" /> {pct > 0 ? `Uploading — ${pct}%` : "Upload"}
      </Button>
      {pct > 0 && (
        <div className="h-1 overflow-hidden rounded-full bg-white/10">
          <div className="h-full rounded-full bg-[#F0A71F] transition-[width]" style={{ width: `${pct}%` }} />
        </div>
      )}
      <p className="text-[11px] leading-snug text-white/55">{hint}</p>
    </div>
  );
}

const FIELD =
  "h-8 border-white/25 bg-white/5 text-[13px] text-white placeholder:text-white/55 focus-visible:ring-[#F0A71F]";
const CAP = "text-[10px] font-semibold uppercase tracking-[0.1em] text-white/65";

function BannerPanel({
  studio,
  sceneBanner,
  patch,
  adminGet,
  adminSend,
}: {
  studio: StudioRow | null;
  sceneBanner: { name: string; title: string } | null;
  patch: (p: Partial<StudioRow>) => void;
  adminGet: <T>(path: string) => Promise<T>;
  adminSend: (method: string, path: string, body?: unknown) => Promise<Response>;
}) {
  const queryClient = useQueryClient();
  // The cards worth keeping. Scenes cover the run of show; these are the
  // sponsor read and the "back in five" that come up nine times a day and
  // should never be retyped.
  const { data: saved = [] } = useQuery<SavedThird[]>({
    queryKey: ["/api/admin/lower-thirds"],
    queryFn: () => adminGet<SavedThird[]>("/api/admin/lower-thirds"),
  });
  const refreshSaved = () => queryClient.invalidateQueries({ queryKey: ["/api/admin/lower-thirds"] });
  const saveOne = useMutation({
    mutationFn: async () => adminSend("POST", "/api/admin/lower-thirds", { title: title.trim(), subtitle: sub.trim() }),
    onSuccess: refreshSaved,
  });
  const dropOne = useMutation({
    mutationFn: async (id: number) => adminSend("DELETE", `/api/admin/lower-thirds/${id}`),
    onSuccess: refreshSaved,
  });
  // Local, because the producer is typing this while something else is on air
  // and a keystroke-by-keystroke write would put half-typed words on the
  // broadcast. It goes up when they say it goes up.
  const [title, setTitle] = useState(studio?.bannerTitle ?? "");
  const [sub, setSub] = useState(studio?.bannerSubtitle ?? "");
  const onAir = Boolean(studio?.bannerVisible && studio?.bannerTitle);
  const dirty = title !== (studio?.bannerTitle ?? "") || sub !== (studio?.bannerSubtitle ?? "");

  // Taking a scene rewrites the banner underneath us; follow it rather than
  // leaving a stale draft in the box.
  useEffect(() => {
    setTitle(studio?.bannerTitle ?? "");
    setSub(studio?.bannerSubtitle ?? "");
  }, [studio?.bannerTitle, studio?.bannerSubtitle]);

  return (
    <div className="flex flex-col gap-2">
      <Input
        className={FIELD}
        value={title}
        maxLength={80}
        placeholder="Name on air"
        onChange={(e) => setTitle(e.target.value)}
        data-testid="input-banner-title"
      />
      <Input
        className={FIELD}
        value={sub}
        maxLength={120}
        placeholder="Underneath — Host · Semper Fi Radio"
        onChange={(e) => setSub(e.target.value)}
        data-testid="input-banner-subtitle"
      />

      {/* The preview is the label. A caption saying "preview" above a thing
          that obviously is one was just a line of height. */}
      <div className="flex items-stretch overflow-hidden rounded-md">
        <div className="w-1 shrink-0 bg-[#F0A71F]" />
        <div className="min-w-0 flex-1 bg-black/45 px-2.5 py-1.5">
          <p className="truncate text-[13px] font-bold leading-tight text-white">{title || "Nothing typed yet"}</p>
          {sub && <p className="truncate text-[11px] leading-tight text-[#F0A71F]">{sub}</p>}
        </div>
      </div>

      <div className="flex gap-1.5">
        <Button
          size="sm"
          className="h-8 flex-1 gap-1.5 rounded-full bg-[#ED1C24] text-xs font-semibold text-white hover:bg-[#c81820]"
          disabled={!title.trim()}
          onClick={() => patch({ bannerTitle: title.trim(), bannerSubtitle: sub.trim(), bannerVisible: true })}
          data-testid="button-banner-air"
        >
          <Check className="h-3.5 w-3.5" /> {onAir && !dirty ? "On air" : "Put it up"}
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-8 shrink-0 rounded-full border-white/30 bg-transparent px-3 text-xs text-white hover:bg-white/10 hover:text-white"
          disabled={!onAir}
          onClick={() => patch({ bannerVisible: false })}
          data-testid="button-banner-down"
        >
          Down
        </Button>
      </div>

      {/* Saved cards. "Add another" takes whatever is in the boxes above, so
          the thing you just typed and liked becomes reusable in one press —
          rather than making you retype it into a separate "new card" form. */}
      <div className="mt-1 flex items-center justify-between">
        <span className={CAP}>Saved</span>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 gap-1 px-2 text-[11px] text-white/70 hover:bg-white/10 hover:text-white"
          disabled={!title.trim() || saveOne.isPending}
          onClick={() => saveOne.mutate()}
          data-testid="button-banner-save"
        >
          <Plus className="h-3 w-3" /> Add another
        </Button>
      </div>

      {saved.length === 0 ? (
        <p className="rounded-lg border border-dashed border-white/25 p-3 text-center text-[11px] text-white/55">
          Nothing saved yet. Type one above and press <span className="text-white/60">Add another</span>.
        </p>
      ) : (
        <div className="flex flex-col gap-1">
          {saved.map((t) => {
            const live = onAir && studio?.bannerTitle === t.title && (studio?.bannerSubtitle ?? "") === t.subtitle;
            return (
              <div
                key={t.id}
                className={`group flex items-center gap-1 rounded-lg border px-2 py-1.5 ${
                  live ? "border-[#ED1C24]/60 bg-[#ED1C24]/10" : "border-white/20 bg-white/[0.04]"
                }`}
                data-testid={`saved-third-${t.id}`}
              >
                <button
                  type="button"
                  onClick={() => patch({ bannerTitle: t.title, bannerSubtitle: t.subtitle, bannerVisible: true })}
                  className="min-w-0 flex-1 text-left"
                  data-testid={`button-saved-third-show-${t.id}`}
                >
                  <div className="truncate text-[13px] font-semibold text-white">{t.title}</div>
                  {t.subtitle && <div className="truncate text-[11px] text-[#F0A71F]">{t.subtitle}</div>}
                </button>
                {live ? (
                  <span className="shrink-0 rounded px-1.5 text-[9px] font-black uppercase tracking-wide text-[#ED1C24]">
                    On air
                  </span>
                ) : (
                  <span className="shrink-0 text-[10px] font-semibold text-white/60 group-hover:text-white/70">Show</span>
                )}
                <Hint label="Load it into the boxes above" side="left">
                  <button
                    type="button"
                    onClick={() => { setTitle(t.title); setSub(t.subtitle); }}
                    className="shrink-0 rounded p-1 text-white/55 hover:bg-white/10 hover:text-white"
                    aria-label={`Edit ${t.title}`}
                    data-testid={`button-saved-third-edit-${t.id}`}
                  >
                    <Pencil className="h-3 w-3" />
                  </button>
                </Hint>
                <Hint label="Delete this saved card" side="left">
                  <button
                    type="button"
                    onClick={() => dropOne.mutate(t.id)}
                    className="shrink-0 rounded p-1 text-white/55 hover:bg-white/10 hover:text-[#ED1C24]"
                    aria-label={`Delete ${t.title}`}
                    data-testid={`button-saved-third-delete-${t.id}`}
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </Hint>
              </div>
            );
          })}
        </div>
      )}

      {sceneBanner && (
        <p className="text-[11px] leading-snug text-white/60">
          On air from <span className="font-semibold text-white/65">{sceneBanner.name}</span>. Taking another scene
          replaces it.
        </p>
      )}
      <p className="text-[11px] leading-snug text-white/55">
        Scenes carry their own — the box above is for what nobody planned.
      </p>
    </div>
  );
}

function TickerPanel({ studio, patch }: { studio: StudioRow | null; patch: (p: Partial<StudioRow>) => void }) {
  const [text, setText] = useState(studio?.tickerText ?? "");
  const on = Boolean(studio?.tickerVisible && studio?.tickerText);
  useEffect(() => setText(studio?.tickerText ?? ""), [studio?.tickerText]);

  return (
    <div className="flex flex-col gap-2">
      <textarea
        className="min-h-[4.5rem] w-full rounded-md border border-white/25 bg-white/5 px-2.5 py-2 text-[13px] text-white placeholder:text-white/55 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F0A71F]"
        value={text}
        maxLength={600}
        placeholder="Donate at militaryvoices.ai/give · Next up at 8:00 — Former Action Guys"
        onChange={(e) => setText(e.target.value)}
        data-testid="input-ticker-text"
      />
      <div className="flex gap-1.5">
        <Button
          size="sm"
          className="h-8 flex-1 rounded-full bg-[#ED1C24] text-xs font-semibold text-white hover:bg-[#c81820]"
          disabled={!text.trim()}
          onClick={() => patch({ tickerText: text.trim(), tickerVisible: true })}
          data-testid="button-ticker-air"
        >
          {on ? "Update it" : "Start it"}
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-8 shrink-0 rounded-full border-white/30 bg-transparent px-3 text-xs text-white hover:bg-white/10 hover:text-white"
          disabled={!on}
          onClick={() => patch({ tickerVisible: false })}
          data-testid="button-ticker-stop"
        >
          Stop
        </Button>
      </div>
      <p className="text-[11px] leading-snug text-white/55">
        Crawls along the bottom and keeps running through every scene change. {600 - text.length} characters left.
      </p>
    </div>
  );
}

/** Plain colours to start from: the brand navy and blue, the service colours, and the neutrals. */
const BG_COLORS: { hex: string; name: string }[] = [
  { hex: "#000741", name: "Navy" },
  { hex: "#053877", name: "MilitaryVoices blue" },
  { hex: "#04102B", name: "Midnight" },
  { hex: "#000000", name: "Black" },
  { hex: "#1F2937", name: "Charcoal" },
  { hex: "#4B5320", name: "Army green" },
  { hex: "#7A0019", name: "Marine red" },
  { hex: "#0B3D91", name: "Air Force blue" },
  { hex: "#F0A71F", name: "Gold" },
  { hex: "#FFFFFF", name: "White" },
];
const HEX = /^#[0-9a-f]{6}$/i;

function BackgroundPanel({
  studio,
  media,
  patch,
  adminSend,
  onMediaChanged,
}: {
  studio: StudioRow | null;
  media: MediaItem[];
  patch: (p: Partial<StudioRow>) => void;
  adminSend: (method: string, path: string, body?: unknown) => Promise<Response>;
  onMediaChanged: () => void;
}) {
  const images = media.filter((m) => m.kind === "image");
  // One field holds either: a picture's address, or a colour as #RRGGBB.
  const current = studio?.backgroundUrl ?? "";
  const currentColor = HEX.test(current) ? current.toUpperCase() : "";
  const [hex, setHex] = useState(currentColor || "#000741");
  useEffect(() => {
    if (currentColor) setHex(currentColor);
  }, [currentColor]);
  const pick = (value: string) => patch({ backgroundUrl: value, backgroundVisible: true });
  // The wheel fires on every drag, so the stage follows once it settles.
  const wheelTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  return (
    <div className="flex flex-col gap-3">
      <label className="flex items-center justify-between rounded-lg bg-white/5 px-2.5 py-1.5">
        <span className="text-xs font-medium text-white/75">{studio?.backgroundVisible && current ? "On air" : "Off"}</span>
        {/* Turning it on with nothing chosen used to do nothing at all; now
            it puts up the navy, and you change it from there. */}
        <Switch
          checked={Boolean(studio?.backgroundVisible && current)}
          onCheckedChange={(v) => (v ? pick(current || "#000741") : patch({ backgroundVisible: false }))}
          data-testid="switch-background"
        />
      </label>

      <div>
        <Label className={CAP}>Colour</Label>
        <div className="mt-1.5 grid grid-cols-5 gap-1.5">
          {BG_COLORS.map((c) => (
            <button
              key={c.hex}
              type="button"
              title={`${c.name} · ${c.hex}`}
              onClick={() => pick(c.hex)}
              className={`h-9 rounded-md border-2 transition-transform hover:scale-105 ${
                currentColor === c.hex ? "border-[#F0A71F]" : "border-white/20"
              }`}
              style={{ backgroundColor: c.hex }}
              data-testid={`button-background-color-${c.hex.slice(1)}`}
            />
          ))}
        </div>
        <div className="mt-2 flex items-center gap-2">
          <input
            type="color"
            value={HEX.test(hex) ? hex : "#000741"}
            onChange={(e) => {
              const v = e.target.value.toUpperCase();
              setHex(v);
              if (wheelTimer.current) clearTimeout(wheelTimer.current);
              wheelTimer.current = setTimeout(() => pick(v), 350);
            }}
            className="h-8 w-10 shrink-0 cursor-pointer rounded border border-white/25 bg-transparent p-0.5"
            title="Pick any colour"
            data-testid="input-background-wheel"
          />
          <Input
            value={hex}
            onChange={(e) => {
              const v = e.target.value.trim();
              setHex(v.startsWith("#") ? v.toUpperCase() : `#${v.toUpperCase()}`);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && HEX.test(hex)) pick(hex);
            }}
            maxLength={7}
            placeholder="#000741"
            className={`${FIELD} font-mono`}
            data-testid="input-background-hex"
          />
          <Button
            size="sm"
            className="h-8 shrink-0 rounded-full px-3 text-xs"
            disabled={!HEX.test(hex)}
            onClick={() => pick(hex)}
            data-testid="button-background-hex"
          >
            Use
          </Button>
        </div>
      </div>

      <div>
        <Label className={CAP}>Picture</Label>
        <div className="mt-1.5 grid grid-cols-2 gap-1.5">
          <button
            type="button"
            onClick={() => patch({ backgroundUrl: "", backgroundVisible: false })}
            className={`flex h-14 items-center justify-center rounded-md border text-[11px] font-medium transition-colors ${
              current ? "border-white/25 text-white/50 hover:bg-white/10" : "border-[#F0A71F] bg-[#F0A71F]/15 text-white"
            }`}
            data-testid="button-background-none"
          >
            None
          </button>
          {images.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => pick(m.url)}
              title={m.label}
              className={`relative h-14 overflow-hidden rounded-md border transition-colors ${
                current === m.url ? "border-[#F0A71F]" : "border-white/25 hover:border-white/40"
              }`}
              data-testid={`button-background-${m.id}`}
            >
              <img src={m.url} alt="" className="h-full w-full object-cover" />
            </button>
          ))}
        </div>
      </div>

      <UploadTile
        accept="image/png,image/jpeg,image/webp"
        kind="Image"
        // The one number nobody can guess and everybody needs. A 600px photo
        // stretched across a 1080p frame is the commonest way a background
        // looks cheap, and the fix is telling people before they pick.
        hint="1920 × 1080 (16:9) works best — anything smaller gets stretched. PNG or JPG."
        adminSend={adminSend}
        onDone={(url) => {
          onMediaChanged();
          // You uploaded it to use it: it goes up straight away.
          if (url) pick(url);
        }}
        testId="button-background-upload"
      />

      <p className="text-[11px] leading-snug text-white/55">Sits behind the cameras. A clip or the break clock covers it.</p>
    </div>
  );
}

function LogoPanel({
  studio,
  patch,
  uploadLogo,
  logoBusy,
  fileRef,
}: {
  studio: StudioRow | null;
  patch: (p: Partial<StudioRow>) => void;
  uploadLogo: (f: File) => void;
  logoBusy: boolean;
  fileRef: React.MutableRefObject<HTMLInputElement | null>;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div
        className="relative flex h-20 w-full items-center justify-center overflow-hidden rounded-lg border border-white/20"
        style={{ background: "linear-gradient(135deg,#0a1628 0%,#1a2a4a 100%)" }}
      >
        {studio?.logoUrl ? (
          <img
            src={studio.logoUrl}
            alt=""
            className={`absolute max-h-[38%] max-w-[38%] object-contain transition-opacity ${
              studio.logoVisible ? "opacity-100" : "opacity-25"
            } ${
              studio.logoCorner === "top-left"
                ? "left-2 top-2"
                : studio.logoCorner === "bottom-left"
                  ? "bottom-2 left-2"
                  : studio.logoCorner === "bottom-right"
                    ? "bottom-2 right-2"
                    : "right-2 top-2"
            }`}
          />
        ) : (
          <span className="text-[11px] text-white/60">No logo yet</span>
        )}
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/svg+xml,image/webp,image/jpeg"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) uploadLogo(f);
          e.target.value = "";
        }}
        data-testid="input-rail-logo"
      />
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          className="h-8 flex-1 gap-1.5 rounded-full border-white/30 bg-transparent text-xs text-white hover:bg-white/10 hover:text-white"
          disabled={logoBusy}
          onClick={() => fileRef.current?.click()}
          data-testid="button-rail-upload-logo"
        >
          <Upload className="h-3.5 w-3.5" /> {logoBusy ? "Uploading…" : studio?.logoUrl ? "Replace" : "Upload"}
        </Button>
        {studio?.logoUrl && (
          <Switch
            checked={Boolean(studio.logoVisible)}
            onCheckedChange={(v) => patch({ logoVisible: v })}
            data-testid="switch-rail-logo"
          />
        )}
      </div>

      {studio?.logoUrl && (
        <>
          <div>
            <Label className={CAP}>Corner</Label>
            <div className="mt-1 grid grid-cols-2 gap-1">
              {LOGO_CORNERS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => patch({ logoCorner: c })}
                  className={`rounded-full border px-2 py-1 text-[11px] font-medium capitalize transition-colors ${
                    (studio.logoCorner || "top-right") === c
                      ? "border-[#F0A71F] bg-[#F0A71F]/15 text-white"
                      : "border-white/25 text-white/65 hover:bg-white/10"
                  }`}
                  data-testid={`button-rail-corner-${c}`}
                >
                  {c.replace("-", " ")}
                </button>
              ))}
            </div>
          </div>
          <div>
            <Label className={CAP}>Size · {studio.logoSize || 96}px at 1280 wide</Label>
            <input
              type="range"
              min={40}
              max={320}
              step={8}
              value={studio.logoSize || 96}
              onChange={(e) => patch({ logoSize: Number(e.target.value) })}
              className="mt-1.5 w-full accent-[#F0A71F]"
              data-testid="input-rail-logo-size"
            />
          </div>
        </>
      )}
    </div>
  );
}
