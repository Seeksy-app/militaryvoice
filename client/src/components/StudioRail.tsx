import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { MediaLibrary, type MediaItem } from "@/components/MediaLibrary";
import { LOGO_CORNERS, type StudioRow } from "@shared/schema";
import { Captions, Image as ImageIcon, Layers, ScrollText, Upload, X, Check } from "lucide-react";

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
          className="flex w-[272px] shrink-0 flex-col border-l border-white/10 bg-[#04102b]"
          data-testid={`rail-panel-${open}`}
        >
          <div className="flex h-9 shrink-0 items-center justify-between border-b border-white/10 pl-3 pr-1.5">
            <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-white/60">
              {TABS.find((t) => t.key === open)?.label}
            </span>
            <button
              type="button"
              onClick={() => setOpen(null)}
              className="rounded-md p-1.5 text-white/40 transition-colors hover:bg-white/10 hover:text-white"
              aria-label="Close the panel"
              data-testid="button-rail-close"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2.5">
            {open === "banner" && <BannerPanel studio={studio} sceneBanner={sceneBanner} patch={patch} />}
            {open === "ticker" && <TickerPanel studio={studio} patch={patch} />}
            {open === "background" && <BackgroundPanel studio={studio} media={media} patch={patch} />}
            {open === "logo" && (
              <LogoPanel studio={studio} patch={patch} uploadLogo={uploadLogo} logoBusy={logoBusy} fileRef={logoFileRef} />
            )}
            {open === "media" && (
              // The library is a light surface on purpose: it is a list of
              // files to read, not a control you hit in the dark mid-take.
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
            )}
          </div>
        </aside>
      )}

      {/* The strip itself. Always visible, always in the same place — that is
          the whole value of it during a show. */}
      <nav
        className="flex w-[4.25rem] shrink-0 flex-col items-center gap-0.5 border-l border-white/10 bg-[#000741] py-2"
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
            <button
              key={key}
              type="button"
              onClick={() => setOpen((v) => (v === key ? null : key))}
              title={label}
              className={`relative flex w-[3.75rem] flex-col items-center gap-1 rounded-lg px-0.5 py-2 text-[10px] font-medium leading-[1.15] transition-colors ${
                open === key ? "bg-white/15 text-white" : "text-white/60 hover:bg-white/10 hover:text-white"
              }`}
              data-testid={`button-rail-${key}`}
            >
              <Icon className="h-[19px] w-[19px]" />
              <span className="w-full text-balance text-center">{label}</span>
              {/* A dot, not a colour change: the producer needs to know what is
                  on air without opening anything. */}
              {live && (
                <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-[#ED1C24]" aria-hidden="true" />
              )}
            </button>
          );
        })}
      </nav>
    </>
  );
}

const FIELD =
  "h-8 border-white/15 bg-white/5 text-[13px] text-white placeholder:text-white/30 focus-visible:ring-[#F0A71F]";
const CAP = "text-[10px] font-semibold uppercase tracking-[0.1em] text-white/45";

function BannerPanel({
  studio,
  sceneBanner,
  patch,
}: {
  studio: StudioRow | null;
  sceneBanner: { name: string; title: string } | null;
  patch: (p: Partial<StudioRow>) => void;
}) {
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
          className="h-8 shrink-0 rounded-full border-white/20 bg-transparent px-3 text-xs text-white hover:bg-white/10 hover:text-white"
          disabled={!onAir}
          onClick={() => patch({ bannerVisible: false })}
          data-testid="button-banner-down"
        >
          Down
        </Button>
      </div>

      {sceneBanner && (
        <p className="text-[11px] leading-snug text-white/40">
          On air from <span className="font-semibold text-white/65">{sceneBanner.name}</span>. Taking another scene
          replaces it.
        </p>
      )}
      <p className="text-[11px] leading-snug text-white/35">
        Scenes carry their own — this box is for what nobody planned.
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
        className="min-h-[4.5rem] w-full rounded-md border border-white/15 bg-white/5 px-2.5 py-2 text-[13px] text-white placeholder:text-white/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F0A71F]"
        value={text}
        maxLength={600}
        placeholder="Donate at militaryvoice.ai/give · Next up at 8:00 — Former Action Guys"
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
          className="h-8 shrink-0 rounded-full border-white/20 bg-transparent px-3 text-xs text-white hover:bg-white/10 hover:text-white"
          disabled={!on}
          onClick={() => patch({ tickerVisible: false })}
          data-testid="button-ticker-stop"
        >
          Stop
        </Button>
      </div>
      <p className="text-[11px] leading-snug text-white/35">
        Crawls along the bottom and keeps running through every scene change. {600 - text.length} characters left.
      </p>
    </div>
  );
}

function BackgroundPanel({
  studio,
  media,
  patch,
}: {
  studio: StudioRow | null;
  media: MediaItem[];
  patch: (p: Partial<StudioRow>) => void;
}) {
  const images = media.filter((m) => m.kind === "image");
  const current = studio?.backgroundUrl ?? "";

  return (
    <div className="flex flex-col gap-2">
      <label className="flex items-center justify-between rounded-lg bg-white/5 px-2.5 py-1.5">
        <span className="text-xs font-medium text-white/75">{studio?.backgroundVisible ? "On air" : "Off"}</span>
        <Switch
          checked={Boolean(studio?.backgroundVisible)}
          disabled={!current}
          onCheckedChange={(v) => patch({ backgroundVisible: v })}
          data-testid="switch-background"
        />
      </label>

      <div className="grid grid-cols-2 gap-1.5">
        <button
          type="button"
          onClick={() => patch({ backgroundUrl: "", backgroundVisible: false })}
          className={`flex h-14 items-center justify-center rounded-md border text-[11px] font-medium transition-colors ${
            current ? "border-white/15 text-white/50 hover:bg-white/10" : "border-[#F0A71F] bg-[#F0A71F]/15 text-white"
          }`}
          data-testid="button-background-none"
        >
          None
        </button>
        {images.map((m) => (
          <button
            key={m.id}
            type="button"
            onClick={() => patch({ backgroundUrl: m.url, backgroundVisible: true })}
            title={m.label}
            className={`relative h-14 overflow-hidden rounded-md border transition-colors ${
              current === m.url ? "border-[#F0A71F]" : "border-white/15 hover:border-white/40"
            }`}
            data-testid={`button-background-${m.id}`}
          >
            <img src={m.url} alt="" className="h-full w-full object-cover" />
          </button>
        ))}
      </div>

      <p className="text-[11px] leading-snug text-white/35">
        {images.length === 0
          ? "No images in the media library yet — anything uploaded there shows up here."
          : "Sits behind the cameras. A clip or the break clock covers it."}
      </p>
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
        className="relative flex h-20 w-full items-center justify-center overflow-hidden rounded-lg border border-white/10"
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
          <span className="text-[11px] text-white/40">No logo yet</span>
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
          className="h-8 flex-1 gap-1.5 rounded-full border-white/20 bg-transparent text-xs text-white hover:bg-white/10 hover:text-white"
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
                      : "border-white/15 text-white/65 hover:bg-white/10"
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
