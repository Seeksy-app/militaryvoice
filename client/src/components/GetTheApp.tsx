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
export function GetTheApp({ variant }: { variant: "nav" | "banner" }) {
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

  const trigger = variant === "nav" ? (
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
function PhoneCode() {
  const [src, setSrc] = useState("");
  useEffect(() => {
    QRCode.toDataURL(APP_URL, { margin: 1, width: 360, color: { dark: "#000741", light: "#ffffff" } }).then(setSrc).catch(() => setSrc(""));
  }, []);
  return (
    <div className="flex items-center gap-4 rounded-xl border border-border p-3">
      {src ? <img src={src} alt="Scan to open MilitaryVoices on your phone" className="h-28 w-28 shrink-0 rounded-lg" /> : <div className="h-28 w-28 shrink-0 animate-pulse rounded-lg bg-muted" />}
      <p className="text-sm"><b>On your phone:</b> point the camera at this code, open the page, and add it to your home screen.</p>
    </div>
  );
}
