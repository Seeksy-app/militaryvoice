import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Link } from "wouter";
import { Mic2, ArrowRight, Radio, Rss, Youtube } from "lucide-react";
import type { PublicSignup } from "@shared/schema";
import { Clock } from "lucide-react";
import { resolveUploadUrl } from "@/lib/queryClient";
import { SocialIconRow, parseSocialAccounts } from "@/components/SocialIcons";
import { formatDateInZone, formatTimeInZone } from "@/lib/schedule";

/** A card-worthy podcaster: either a claimed slot (with on-air start) or a
 *  finished profile that hasn't picked a slot yet. */
export interface SpotlightItem {
  key: string;
  podcastName: string;
  hostName: string;
  photoUrl: string;
  numPeople: number;
  socialAccounts: string;
  rssUrl: string;
  youtubeUrl: string;
  start?: Date; // on-air start when a slot is claimed
}

export function spotlightFromSignup(signup: PublicSignup, start: Date): SpotlightItem {
  return {
    key: `signup-${signup.id}`,
    podcastName: signup.podcastName,
    hostName: signup.hostName,
    photoUrl: signup.photoUrl,
    numPeople: signup.numPeople,
    socialAccounts: signup.socialAccounts,
    rssUrl: signup.rssUrl,
    youtubeUrl: signup.youtubeUrl,
    start,
  };
}

interface Props {
  items: SpotlightItem[];
  zone: string;
  agendaHref: string;
  intervalMs?: number;
}

/**
 * Hero spotlight: one confirmed podcaster at a time, crossfading through the
 * lineup. Pauses while hovered so a name can be read or a link clicked.
 */
export function SpotlightCard({ items, zone, agendaHref, intervalMs = 6000 }: Props) {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);

  // Keep index valid if the list shrinks (e.g. a cancellation).
  useEffect(() => {
    if (index >= items.length) setIndex(0);
  }, [items.length, index]);

  useEffect(() => {
    if (items.length < 2 || paused) return;
    const id = setInterval(() => setIndex((i) => (i + 1) % items.length), intervalMs);
    return () => clearInterval(id);
  }, [items.length, paused, intervalMs]);

  const current = items[index] ?? items[0];
  if (!current) return null;
  const signup = current;
  const start = current.start;
  const socials = parseSocialAccounts(signup.socialAccounts);

  return (
    <div
      className="relative"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      data-testid="card-spotlight"
    >
      <motion.div
        aria-hidden="true"
        className="absolute inset-0 rounded-[1.75rem] bg-[#F0A71F]/90"
        animate={{ rotate: [2, 3, 2] }}
        transition={{ duration: 8, repeat: Infinity, ease: "easeInOut" }}
      />
      <div className="relative overflow-hidden rounded-[1.75rem] bg-card text-card-foreground shadow-2xl">
        <div className="flex items-center justify-between px-6 pt-5 sm:px-8">
          <span className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <Radio className="h-3.5 w-3.5 text-primary" /> {start ? "On the lineup" : "Joining the marathon"}
          </span>
          {items.length > 1 && (
            <span className="tabular-nums text-xs text-muted-foreground">
              {index + 1}/{items.length}
            </span>
          )}
        </div>

        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={signup.key}
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -14 }}
            transition={{ duration: 0.45, ease: "easeOut" }}
            className="px-6 pb-6 pt-4 sm:px-8 sm:pb-8"
          >
            <div className="flex items-start gap-5">
              {signup.photoUrl ? (
                <img
                  src={resolveUploadUrl(signup.photoUrl)}
                  alt={signup.hostName}
                  className="h-24 w-24 shrink-0 rounded-full object-cover ring-4 ring-[#F0A71F]/30 sm:h-28 sm:w-28"
                />
              ) : (
                <div className="flex h-24 w-24 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground sm:h-28 sm:w-28">
                  <Mic2 className="h-9 w-9" />
                </div>
              )}
              <div className="min-w-0 flex-1">
                <h3
                  className="text-xl font-bold leading-tight tracking-tight sm:text-2xl"
                  style={{ fontFamily: "'General Sans', 'Inter', sans-serif" }}
                  data-testid="text-spotlight-podcast"
                >
                  {signup.podcastName}
                </h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  with <span className="font-medium text-card-foreground">{signup.hostName}</span>
                  {signup.numPeople > 1 && " and co-host"}
                </p>
                {start ? (
                  <p className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-muted px-3 py-1 tabular-nums text-xs font-semibold text-foreground">
                    <span className="inline-block h-1.5 w-1.5 rounded-full bg-[#F0A71F]" />
                    {formatDateInZone(start, zone)} · {formatTimeInZone(start, zone)}
                  </p>
                ) : (
                  <p className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-muted px-3 py-1 text-xs font-medium text-muted-foreground">
                    <Clock className="h-3 w-3" /> Slot time coming soon
                  </p>
                )}
              </div>
            </div>

            {(socials.length > 0 || signup.youtubeUrl || signup.rssUrl) && (
              <div className="mt-5 flex flex-wrap items-center gap-2">
                <SocialIconRow accounts={socials} size="md" variant="filled" />
                {signup.youtubeUrl && (
                  <a
                    href={signup.youtubeUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs font-medium hover-elevate"
                  >
                    <Youtube className="h-3.5 w-3.5 text-primary" /> YouTube
                  </a>
                )}
                {signup.rssUrl && (
                  <a
                    href={signup.rssUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs font-medium hover-elevate"
                  >
                    <Rss className="h-3.5 w-3.5 text-primary" /> Subscribe
                  </a>
                )}
              </div>
            )}

            <div className="mt-5 flex items-center justify-between gap-3 border-t border-border pt-4">
              <Link
                href={agendaHref}
                className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
                data-testid="link-spotlight-agenda"
              >
                See the full lineup <ArrowRight className="h-3.5 w-3.5" />
              </Link>
              {items.length > 1 && (
                <div className="flex items-center gap-1.5" aria-label="Featured podcasters">
                  {items.map((it, i) => (
                    <button
                      key={it.key}
                      type="button"
                      aria-label={`Show ${it.podcastName}`}
                      onClick={() => setIndex(i)}
                      className={`h-1.5 rounded-full transition-all ${
                        i === index ? "w-5 bg-primary" : "w-1.5 bg-border hover:bg-muted-foreground/50"
                      }`}
                    />
                  ))}
                </div>
              )}
            </div>
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
