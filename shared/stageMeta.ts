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
    stageCardPhoto: st.stageCardPhoto,
    stageCardSponsor: st.stageCardSponsor,
    stageCardSponsorLogo: st.stageCardSponsorLogo,
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
    bannerTitle: st.bannerVisible ? st.bannerTitle : "",
    bannerSubtitle: st.bannerVisible ? st.bannerSubtitle : "",
    tickerText: st.tickerVisible ? st.tickerText : "",
  };
}
