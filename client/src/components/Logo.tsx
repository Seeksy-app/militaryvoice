export function LogoMark({ className = "h-6 w-6" }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" fill="none" className={className} aria-hidden="true">
      <circle cx="24" cy="24" r="17.5" stroke="currentColor" strokeWidth="2.5" />
      <line x1="24" y1="6" x2="24" y2="10.5" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      <line x1="42" y1="24" x2="37.5" y2="24" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      <line x1="24" y1="42" x2="24" y2="37.5" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      <line x1="6" y1="24" x2="10.5" y2="24" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      <line x1="24" y1="24" x2="31.5" y2="15" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      <circle cx="24" cy="24" r="2.25" fill="currentColor" />
      <rect x="28.7" y="9.8" width="6" height="9.4" rx="3" transform="rotate(37 31.7 14.5)" fill="currentColor" />
      <path d="M38 9 Q42.5 11 41 16.5" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" />
      <path d="M41.5 4.5 Q48 8 45.5 16" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" />
    </svg>
  );
}

export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <span className={`font-bold tracking-tight ${className}`} style={{ fontFamily: "'General Sans', 'Inter', sans-serif" }}>
      MilitaryVoice<span style={{ opacity: 0.6 }}>.ai</span>
    </span>
  );
}
