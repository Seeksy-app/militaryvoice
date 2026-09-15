// Brand mark: the amber waveform lifted from the official MilitaryVoice.ai
// logo file. It's a wide mark (roughly 2.2:1), so callers size it by height.
export function LogoMark({ className = "h-8" }: { className?: string }) {
  return <img src="/logo-wave.png?v=2" alt="" aria-hidden="true" className={`w-auto ${className}`} />;
}

export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <span className={`font-bold tracking-tight ${className}`} style={{ fontFamily: "'General Sans', 'Inter', sans-serif" }}>
      <span className="text-[#000741] dark:text-white">MilitaryVoice</span>
      <span className="text-[#0064B1] dark:text-[#3D8FDB]">.ai</span>
    </span>
  );
}

/**
 * The actual logo file — waveform over the stacked MILITARY VOICE.AI — not a
 * rebuild of it in web type. Sized by height (it's about 1.5:1). The dark
 * variant swaps the near-black letters for white; the amber stays.
 */
export function LogoLockup({ className = "h-14 sm:h-16" }: { className?: string }) {
  return (
    <>
      <img src="/logo-lockup.png?v=3" alt="MilitaryVoice.ai" className={`w-auto dark:hidden ${className}`} />
      <img src="/logo-lockup-dark.png?v=3" alt="MilitaryVoice.ai" className={`hidden w-auto dark:block ${className}`} />
    </>
  );
}
