/**
 * The texting disclosure under every mobile-number field. The carriers and
 * SimpleTexting check for each part of it (automated, not a condition of
 * purchase, frequency, rates, STOP/HELP, terms and privacy links), so keep
 * them all if you reword it.
 */
export function SmsConsent({ what = "show-day texts about events you're taking part in, like when you're on and the green room link", className = "" }: { what?: string; className?: string }) {
  return (
    <p className={`text-[11px] leading-snug text-muted-foreground ${className}`} data-testid="sms-consent">
      By adding your mobile number, you agree to receive automated text messages from MilitaryVoices.ai: {what}. Consent
      is not a condition of any purchase. Message frequency varies. Message and data rates may apply. Reply STOP to
      opt out, HELP for help. See our{" "}
      <a href="/terms" target="_blank" rel="noreferrer" className="underline underline-offset-2">Terms</a> and{" "}
      <a href="/privacy" target="_blank" rel="noreferrer" className="underline underline-offset-2">Privacy Policy</a>.
    </p>
  );
}
