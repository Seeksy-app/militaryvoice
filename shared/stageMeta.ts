import type { StudioRow } from "./schema";

/**
 * What the stage should be showing, derived from the studio row.
 *
 * This exists because it was written twice. The server builds room metadata
 * for the broadcast and the watch page; the console builds its own object for
 * the producer's monitor. Adding the background, the lower third and the
 * ticker to the first and not the second meant every one of them saved
 * correctly, went out on air correctly, and appeared nowhere in the console —
 * so the producer setting them up had no evidence anything had happened.
 *
 * One function, both callers. Add a graphic here and both surfaces get it.
 */
/** The desk hand-off slide: thanks to who just finished, who's at the desk, what's next. */
export interface StageThanks {
  name: string;
  show: string;
  photoUrl: string;
  /** A co-host's face beside theirs (Jane beside Riccoh). */
  photo2Url?: string;
  /** Their page, for the QR code. */
  qrUrl: string;
  deskName: string;
  deskPhoto: string;
  /** "4:00 PM · VET S.O.S. with Shawn Welsh" */
  next: string;
}

export function readThanks(raw: string | null | undefined): StageThanks | null {
  if (!raw) return null;
  try {
    const t = JSON.parse(raw) as StageThanks;
    return t && t.name ? t : null;
  } catch {
    return null;
  }
}

export function stageMetaFromStudio(st: StudioRow) {
  return {
    studioName: st.name,
    status: st.status,
    fallbackPlaying: st.fallbackPlaying,
    fallbackVideoUrl: st.fallbackVideoUrl,
    fallbackLabel: st.fallbackLabel,
    preVideoUrl: st.preVideoUrl,
    preLabel: st.preLabel,
    stageMediaPlaying: st.stageMediaPlaying,
    stageMediaUrl: st.stageMediaUrl,
    stageMediaKind: st.stageMediaKind,
    stageMediaLabel: st.stageMediaLabel,
    stageCardName: st.stageCardName,
    stageCardShow: st.stageCardShow,
    stageCardPhoto: (st.stageCardPhoto ?? "").split(" ")[0] ?? "",
    stageCardPhoto2: (st.stageCardPhoto ?? "").split(" ")[1] ?? "",
    stageCardSponsor: st.stageCardSponsor,
    stageCardSponsorLogo: st.stageCardSponsorLogo,
    stageThanks: readThanks(st.stageThanks),
    brbOn: st.brbOn,
    countdownEndsAtUtc: st.countdownEndsAtUtc,
    countdownLabel: st.countdownLabel,
    currentSceneId: st.currentSceneId,
    // Graphics only travel when they are switched on, so nothing downstream
    // has to decide whether to draw them.
    logoUrl: st.logoVisible ? st.logoUrl : "",
    logoCorner: st.logoCorner,
    logoSize: st.logoSize,
    backgroundUrl: st.backgroundVisible ? st.backgroundUrl : "",
    tileFit: st.tileFit,
    stageLayout: st.stageLayout,
    stageOrder: st.stageOrder,
    stageMediaPeople: st.stageMediaPeople,
    bannerTitle: st.bannerVisible ? st.bannerTitle : "",
    bannerSubtitle: st.bannerVisible ? st.bannerSubtitle : "",
    tickerText: st.tickerVisible ? st.tickerText : "",
  };
}
