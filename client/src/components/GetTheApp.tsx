import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { Download, Share, Smartphone, SquarePlus, X, MoreVertical } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useInstall } from "@/lib/pwa";

const APP_URL = "https://www.militaryvoices.ai/host/dashboard?source=app";

/**
 * "Get the app": one tap where the browser can install it (Chrome, Edge,
 * Android), the steps where it can't (Safari on iPhone and iPad), and on a
 * computer a code to scan so it lands on the phone, where it's most use.
 * Hidden once they're in the app.
 */
export function GetTheApp({ variant }: { variant: "nav" | "banner" | "sheet" }) {
  const app = useInstall();
  const [open, setOpen] = useState(false);
  const [dismissed, setDismissed] = useState(() => {
    try { return localStorage.getItem("mv_app_banner_dismissed") === "1"; } catch { return false; }
  });
  if (app.installed) return null;

  const go = async () => {
    if (app.canPrompt && (await app.prompt())) return;
    setOpen(true);
  };

  const trigger = variant === "sheet" ? (
    <button type="button" onClick={() => void go()} className="flex w-full items-center gap-3 rounded-xl py-3 text-left hover:bg-muted" data-testid="sheet-get-app">
      <Smartphone className="h-5 w-5 shrink-0 text-[#053877] dark:text-[#8fb5e8]" />
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-medium">Get the app</span>
        <span className="block truncate text-xs text-muted-foreground">On your Home Screen, with notifications</span>
      </span>
    </button>
  ) : variant === "nav" ? (
    <button type="button" onClick={() => void go()} className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-white/75 transition-colors hover:bg-white/10 hover:text-white" data-testid="nav-get-app">
      <Smartphone className="h-4 w-4 shrink-0 text-white/60" />
      <span className="min-w-0 flex-1 text-[14.5px] font-medium">Get the app</span>
    </button>
  ) : dismissed || app.platform === "desktop" ? null : (
    // On a phone, once: the app is where uploading from the camera roll and posting clips belong.
    <div className="mb-4 flex items-center gap-3 rounded-2xl bg-[#000741] p-3 text-white lg:hidden" data-testid="get-app-banner">
      <img src="/icons/icon-192.png" alt="" className="h-11 w-11 shrink-0 rounded-xl" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">Put MilitaryVoices on your home screen</p>
        <p className="text-xs text-white/70">Upload from your camera roll and post clips in a tap.</p>
      </div>
      <Button size="sm" onClick={() => void go()} className="shrink-0 rounded-full bg-[#F0A71F] font-semibold text-[#1a1200] hover:bg-[#f5b94a]" data-testid="get-app-banner-go">Get it</Button>
      <button type="button" onClick={() => { setDismissed(true); try { localStorage.setItem("mv_app_banner_dismissed", "1"); } catch { /* fine */ } }} className="shrink-0 rounded-full p-1 text-white/60 hover:text-white" aria-label="Not now"><X className="h-4 w-4" /></button>
    </div>
  );

  return (
    <>
      {trigger}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><img src="/icons/icon-192.png" alt="" className="h-8 w-8 rounded-lg" /> Get the app</DialogTitle>
            <DialogDescription>MilitaryVoices on your home screen: opens in one tap, full screen, no app store.</DialogDescription>
          </DialogHeader>
          {app.platform === "ios" ? (
            <ol className="space-y-3 text-sm">
              <Step n={1}>Open this page in <b>Safari</b> (the app installs from Safari on iPhone and iPad).</Step>
              <Step n={2}>Tap <b>Share</b> <Share className="inline h-4 w-4 align-[-3px]" /> at the bottom of the screen.</Step>
              <Step n={3}>Scroll down and tap <b>Add to Home Screen</b> <SquarePlus className="inline h-4 w-4 align-[-3px]" />, then <b>Add</b>.</Step>
            </ol>
          ) : app.platform === "android" ? (
            <ol className="space-y-3 text-sm">
              <Step n={1}>In Chrome, tap the menu <MoreVertical className="inline h-4 w-4 align-[-3px]" /> at the top right.</Step>
              <Step n={2}>Tap <b>Install app</b> (or <b>Add to Home screen</b>), then <b>Install</b>.</Step>
            </ol>
          ) : (
            <div className="space-y-4 text-sm">
              <PhoneCode />
              <p className="text-muted-foreground">
                On this computer: in Chrome or Edge, click the install icon <Download className="inline h-4 w-4 align-[-3px]" /> at the right of the address bar.
              </p>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#053877] text-xs font-bold text-white">{n}</span>
      <span className="pt-0.5 leading-relaxed">{children}</span>
    </li>
  );
}

/** A code to scan from a computer, so the app lands on the phone. */
function PhoneCode({ compact = false }: { compact?: boolean }) {
  const [src, setSrc] = useState("");
  useEffect(() => {
    QRCode.toDataURL(APP_URL, { margin: 1, width: 360, color: { dark: "#000741", light: "#ffffff" } }).then(setSrc).catch(() => setSrc(""));
  }, []);
  if (compact) {
    return (
      <>
        {src ? <img src={src} alt="Scan to open MilitaryVoices on your phone" className="h-28 w-28 shrink-0 rounded-lg border border-border" /> : <div className="h-28 w-28 shrink-0 animate-pulse rounded-lg bg-muted" />}
        <p className="max-w-[9rem] text-xs text-muted-foreground">Scan with your phone's camera to open it there.</p>
      </>
    );
  }
  return (
    <div className="flex items-center gap-4 rounded-xl border border-border p-3">
      {src ? <img src={src} alt="Scan to open MilitaryVoices on your phone" className="h-28 w-28 shrink-0 rounded-lg" /> : <div className="h-28 w-28 shrink-0 animate-pulse rounded-lg bg-muted" />}
      <p className="text-sm"><b>On your phone:</b> point the camera at this code, open the page, and add it to your home screen.</p>
    </div>
  );
}

/**
 * On the Dashboard: how to put the app on a phone, iPhone and Android side by
 * side (just theirs on a phone, with one-tap install where the browser can),
 * and a code to scan from a computer. Gone once they're in the app, or hidden.
 */
export function AppInstallCard() {
  const app = useInstall();
  const [hidden, setHidden] = useState(() => { try { return localStorage.getItem("mv_app_card_hidden") === "1"; } catch { return false; } });
  if (app.installed || hidden) return null;
  const hide = () => { setHidden(true); try { localStorage.setItem("mv_app_card_hidden", "1"); } catch { /* fine */ } };
  const phone = app.platform !== "desktop";
  const iphone = (
    <div className="min-w-0">
      <p className="mb-2 text-sm font-semibold">iPhone and iPad</p>
      <ol className="space-y-2 text-sm">
        <Step n={1}>Open <b>militaryvoices.ai</b> in <b>Safari</b>.</Step>
        <Step n={2}>Tap <b>Share</b> <Share className="inline h-4 w-4 align-[-3px]" />.</Step>
        <Step n={3}>Tap <b>Add to Home Screen</b> <SquarePlus className="inline h-4 w-4 align-[-3px]" />, then <b>Add</b>.</Step>
      </ol>
    </div>
  );
  const android = (
    <div className="min-w-0">
      <p className="mb-2 text-sm font-semibold">Android</p>
      <ol className="space-y-2 text-sm">
        <Step n={1}>Open <b>militaryvoices.ai</b> in <b>Chrome</b>.</Step>
        <Step n={2}>Tap the menu <MoreVertical className="inline h-4 w-4 align-[-3px]" />.</Step>
        <Step n={3}>Tap <b>Install app</b>, then <b>Install</b>.</Step>
      </ol>
    </div>
  );
  return (
    <section className="rounded-2xl border border-border bg-card p-4 shadow-sm sm:p-5" data-testid="app-install-card">
      <div className="mb-4 flex items-start gap-3">
        <img src="/icons/icon-192.png" alt="" className="h-11 w-11 shrink-0 rounded-xl" />
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-bold">Get the MilitaryVoices app</h2>
          <p className="text-sm text-muted-foreground">On your Home Screen: opens in one tap, and tells you when your clips are ready. No app store.</p>
        </div>
        <button type="button" onClick={hide} className="shrink-0 rounded-full p-1 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="Hide this"><X className="h-4 w-4" /></button>
      </div>
      {phone ? (
        <div className="space-y-3">
          {app.canPrompt && <Button onClick={() => void app.prompt()} className="w-full gap-2 rounded-full bg-[#053877] text-white hover:bg-[#0a4a99]" data-testid="app-card-install"><Download className="h-4 w-4" /> Install the app</Button>}
          {app.platform === "ios" ? iphone : android}
        </div>
      ) : (
        <div className="grid gap-5 md:grid-cols-[auto_1fr_1fr]">
          <div className="flex items-center gap-3 md:flex-col md:items-start"><PhoneCode compact /></div>
          {iphone}
          {android}
        </div>
      )}
    </section>
  );
}
