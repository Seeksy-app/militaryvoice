// The free podcast website at militaryvoices.ai/<handle>/show (12 Oct 2026).

export interface SiteEpisode {
  /** h<hosted episode id> or r<8 hex of the feed guid>. */
  key: string;
  /** What goes in the address: the title, then the key (…/show/<slug>). */
  slug: string;
  title: string;
  publishedAt: string;
  durationSec: number;
  audio: string;
  artworkUrl: string;
  /** The first lines of the notes, as plain text. */
  summary: string;
  episodeNumber: number | null;
  season: number | null;
  hasTranscript: boolean;
}

export interface SitePublic {
  handle: string;
  name: string;
  bio: string;
  avatarUrl: string;
  heroUrl: string;
  branch: string;
  /** Their SmartLink accent colour. */
  color: string;
  socials: { platform: string; url: string }[];
  youtubeUrl: string;
  show: null | { title: string; description: string; author: string; artworkUrl: string; appleUrl: string; spotifyUrl: string; feedUrl: string; pageUrl: string };
  episodes: SiteEpisode[];
  clips: { id: number; title: string; caption: string; url: string; verticalUrl: string; squareUrl: string }[];
  /** Their media kit is on (the Sponsors section links to it). */
  brandsOn: boolean;
  askEnabled: boolean;
}

export interface SiteEpisodeFull extends SiteEpisode {
  notes: string;
  /** Line by line, with where each starts (seconds), when it's been transcribed. */
  transcript: { at: number; who: string; text: string }[] | null;
  newer: { slug: string; title: string } | null;
  older: { slug: string; title: string } | null;
  show: { title: string; artworkUrl: string } | null;
  name: string;
  color: string;
}
