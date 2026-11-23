import { InfoTip } from "@/components/InfoTip";

/**
 * The texting disclosure under every mobile-number field. The carriers and
 * SimpleTexting check for each part of it (automated, not a condition of
 * purchase, frequency, rates, STOP/HELP, terms and privacy links), so keep
 * them all if you reword it.
 *
 * One short line stays visible at the field (who texts, rates, STOP: what a carrier reviewer looks for at the point of
 * opt-in); the whole of it sits behind "Terms and Conditions", a hover-over that also opens on tap (Andrew, 23 Nov:
 * "make the terms a hover over 'Terms and Conditions'").
 */
export function SmsConsent({ what = "show-day texts about events you're taking part in, like when you're on and the green room link", className = "" }: { what?: string; className?: string }) {
  const full = (
    <div className="space-y-2" data-testid="sms-consent-full">
      <p>
        By adding your mobile number, you agree to receive automated text messages from MilitaryVoices.ai: {what}. Consent
        is not a condition of any purchase. Message frequency varies. Message and data rates may apply. Reply STOP to
        opt out, HELP for help.
      </p>
      <p>
        See our{" "}
        <a href="/terms" target="_blank" rel="noreferrer" className="font-semibold text-[#053877] underline underline-offset-2 dark:text-white">Terms</a> and{" "}
        <a href="/privacy" target="_blank" rel="noreferrer" className="font-semibold text-[#053877] underline underline-offset-2 dark:text-white">Privacy Policy</a>.
      </p>
    </div>
  );
  return (
    <p className={`text-[11px] leading-snug text-muted-foreground ${className}`} data-testid="sms-consent">
      By adding your mobile, you agree to automated texts from MilitaryVoices.ai. Rates may apply. Reply STOP to <span className="whitespace-nowrap">opt out.</span>{" "}
      <InfoTip label="Texting terms and conditions" tip={full} testId="sms-consent-terms" className="rounded align-baseline">
        <span className="underline underline-offset-2">Terms and Conditions</span>
      </InfoTip>
    </p>
  );
}
