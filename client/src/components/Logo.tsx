// Brand mark: a navy shield (Military) carrying an amber microphone (Voice)
// with two sound-wave arcs breaking out of the shield's right edge. Colors are
// pinned to the brand palette so the mark reads the same on any background;
// navy lightens slightly in dark mode for contrast.
export function LogoMark({ className = "h-8 w-8" }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" fill="none" className={className} aria-hidden="true">
      {/* shield */}
      <path
        d="M24 3.5 41 9.5v14.2c0 10.6-7.2 18.3-17 21.8C14.2 42 7 34.3 7 23.7V9.5L24 3.5Z"
        className="fill-[#053877] dark:fill-[#0d4c9c]"
      />
      <path
        d="M24 8 36.5 12.4v11.2c0 8.3-5.4 14.4-12.5 17.2-7.1-2.8-12.5-8.9-12.5-17.2V12.4L24 8Z"
        className="fill-white/10"
      />
      {/* microphone */}
      <rect x="20" y="13" width="8" height="14" rx="4" className="fill-[#F0A71F]" />
      <path d="M16.5 22.5a7.5 7.5 0 0 0 15 0" stroke="#F0A71F" strokeWidth="2.4" strokeLinecap="round" />
      <path d="M24 30v4.5M19.5 35h9" stroke="#F0A71F" strokeWidth="2.4" strokeLinecap="round" />
      {/* sound waves */}
      <path d="M36.5 17.5c1.9 1.6 3 3.9 3 6.5s-1.1 4.9-3 6.5" stroke="#F0A71F" strokeWidth="2.2" strokeLinecap="round" />
      <path d="M40.5 14c3 2.6 4.8 6.2 4.8 10s-1.8 7.4-4.8 10" stroke="#F0A71F" strokeWidth="2.2" strokeLinecap="round" opacity="0.7" />
    </svg>
  );
}

export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <span className={`font-bold tracking-tight ${className}`} style={{ fontFamily: "'General Sans', 'Inter', sans-serif" }}>
      <span className="text-[#053877] dark:text-[#5AA9EE]">Military</span>
      <span className="text-[#F0A71F]">Voice</span>
      <span className="opacity-50">.ai</span>
    </span>
  );
}
