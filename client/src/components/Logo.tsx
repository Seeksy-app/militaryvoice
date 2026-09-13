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

/** Stacked lockup: waveform above the wordmark, as in the source logo. */
export function LogoLockup({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex flex-col items-center ${className}`}>
      <LogoMark className="h-6 sm:h-7" />
      <Wordmark className="-mt-1 text-xl sm:text-2xl" />
    </span>
  );
}
