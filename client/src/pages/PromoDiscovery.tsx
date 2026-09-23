import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Sparkles } from "lucide-react";
import { PreviewStack } from "@/pages/Discover";

// The studio's Discovery promo, as a 1920×1080 stage for recording. It plays
// the same demo as the Discovery hero — a real creator's card, the click, her
// profile rising and scrolling — then gives the frame to the QR code.
//   /promo/discovery              the whole thing, demo then QR
//   /promo/discovery?phase=demo   the demo only (for recording)
//   /promo/discovery?phase=qr     the QR frame only (for a sharp still)

const DEMO_MS = 11_500;

export default function PromoDiscovery() {
  const fixed = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("phase") : null;
  const [phase, setPhase] = useState<"demo" | "qr">(fixed === "qr" ? "qr" : "demo");
  useEffect(() => {
    if (fixed) return;
    const t = setTimeout(() => setPhase("qr"), DEMO_MS);
    return () => clearTimeout(t);
  }, [fixed]);
  const { data: verified = [] } = useQuery<any[]>({ queryKey: ["/api/discover/verified"], queryFn: async () => (await fetch("/api/discover/verified")).json() });

  return (
    <div className="flex min-h-screen items-center justify-center overflow-hidden bg-[#030b1f]">
      <div className="relative isolate h-[1080px] w-[1920px] shrink-0 overflow-hidden text-white" style={{ background: "radial-gradient(120% 90% at 80% 20%, #0b2150 0%, #030b1f 55%)" }} data-testid="promo-stage">
        <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 opacity-50" style={{ backgroundImage: "linear-gradient(rgba(255,255,255,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.05) 1px, transparent 1px)", backgroundSize: "48px 48px", maskImage: "radial-gradient(ellipse 70% 70% at 70% 40%, black, transparent 80%)", WebkitMaskImage: "radial-gradient(ellipse 70% 70% at 70% 40%, black, transparent 80%)" }} />
        <div aria-hidden className="pointer-events-none absolute -right-40 -top-40 -z-10 h-[46rem] w-[46rem] rounded-full bg-[#F0A71F] opacity-20 blur-[140px]" />

        {/* left: who we are and what it does */}
        <div className="absolute left-[110px] top-1/2 w-[860px] -translate-y-1/2">
          <img src="/logo-lockup-dark.png?v=4" alt="MilitaryVoices.ai" className="h-[118px] w-auto" />
          <div className="mt-12 inline-flex items-center gap-2 rounded-full border-2 border-[#F0A71F]/70 px-5 py-2 text-[22px] font-semibold uppercase tracking-[0.12em] text-[#F0A71F]">
            <Sparkles className="h-6 w-6" /> New · MilitaryVoices Discovery
          </div>
          <h1 className="mt-8 text-[84px] font-semibold leading-[1.02] tracking-[-0.02em]">
            Find the military and veteran voices <span className="text-[#F0A71F]">worth working with.</span>
          </h1>
          <ul className="mt-10 flex flex-col gap-4 text-[34px] text-white/85">
            {["Brands: creators to sponsor", "Podcasters: guests to book", "Events: speakers for the stage"].map((t) => (
              <li key={t} className="flex items-center gap-4"><span className="h-3.5 w-3.5 rounded-full bg-[#F0A71F]" />{t}</li>
            ))}
          </ul>
        </div>

        {/* right: the demo, then the QR */}
        <div className="absolute right-[110px] top-1/2 w-[760px] -translate-y-1/2">
          <div className={`transition-all duration-700 ${phase === "demo" ? "opacity-100" : "pointer-events-none scale-95 opacity-0"}`}>
            {phase === "demo" && (
              <div className="origin-center scale-[1.25]">
                <PreviewStack verified={verified} onOpen={() => {}} />
              </div>
            )}
          </div>
          <div className={`absolute inset-0 flex items-center justify-center transition-all duration-700 ${phase === "qr" ? "opacity-100" : "scale-95 opacity-0"}`}>
            <div className="w-[560px] rounded-[40px] bg-white p-10 text-center text-[#04102b] shadow-[0_50px_120px_-30px_rgba(0,0,0,0.8)]">
              <img src="/creative/discovery-qr.png" alt="QR code to militaryvoices.ai/discover" className="mx-auto h-[440px] w-[440px] [image-rendering:pixelated]" />
              <div className="mt-6 text-[44px] font-semibold tracking-tight">Scan to try it free</div>
              <div className="mt-1 text-[30px] text-[#04102b]/60">militaryvoices.ai/discover</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
