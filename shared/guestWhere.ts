// Where a guest joins, for the invite email and the guest's invite page (Andrew, 25 Nov 2026: the new
// "Where will you record or go live?" choices; StreamYard, Restream and OBS links must not say "Zoom").
export type GuestWhere = "studio" | "radio" | "zoom" | "streamyard" | "restream" | "obs";

/** Our own links decide themselves; else the host's pick (invite.where); else a StreamYard or Restream address; else Zoom, as before. */
export function guestWhere(link: string, where?: string | null): GuestWhere {
  const l = String(link ?? "");
  if (/\/(my-studio|room)\/join\//.test(l)) return "studio";
  if (/\/booth\//.test(l)) return "radio";
  if (where === "streamyard" || where === "restream" || where === "obs" || where === "zoom") return where;
  if (/(^|\/\/|\.)streamyard\.com/i.test(l)) return "streamyard";
  if (/(^|\/\/|\.)restream\.io/i.test(l)) return "restream";
  return "zoom";
}

/** The label and help line for the three that aren't ours or Zoom (Andrew's approved words, 25 Nov). */
export function otherLinkCopy(where: GuestWhere, who: string): { label: string; help: string; later: string } | null {
  if (where !== "streamyard" && where !== "restream" && where !== "obs") return null;
  const label = where === "streamyard" ? "Your StreamYard link" : where === "restream" ? "Your Restream link" : "Your link";
  const help = where === "obs" ? "" : `Open it at the time, allow your camera and microphone, and you're on with ${who}. No account needed.`;
  return { label, help, later: `${who} will send it in a separate email.` };
}
