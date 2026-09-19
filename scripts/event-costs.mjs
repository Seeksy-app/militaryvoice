// What the marathon costs, and what one podcaster costs per month.
// Rates taken from each vendor's published pricing, 17 Sep 2026.

const RATE = {
  livekit: {
    ship: 50,
    connMinInc: 150_000, connMinOver: 0.0005,
    dataGbInc: 250, dataGbOver: 0.12,
    transcodeMinInc: 600, transcodeMinOver: 0.02,
  },
  deepgramStreamMin: 0.0048,        // Nova-3 monolingual, pay-as-you-go
  claude: { inPerTok: 5 / 1e6, outPerTok: 25 / 1e6 },  // Opus 5
  supabase: { pro: 25, storageGbInc: 8, storageGbOver: 0.125, egressGbInc: 250, egressGbOver: 0.09, cachedGbOver: 0.03 },
  // LiveKit writes recordings to R2, where egress is free. Only clips and
  // stage media sit in Supabase and are served to viewers from there.
  r2GbMonth: 0.015,
  vercelPro: 20,
  resend: 20,
  // Posting and social analytics for every podcaster, 25 profiles on this tier.
  uploadPost: 50,
};

const MB_PER_MIN = (mbps) => (mbps * 60) / 8;   // megabits/s -> MB/min
const VIEWER_MBPS = 1.3;      // 720p WebRTC
const RTMP_MBPS = 3.5;        // one outbound destination
const DESTINATIONS = 3;

function event({ viewers, hours = 24, slotMin = 30, prerecordedSlots = 13 }) {
  const minutes = hours * 60;
  const slots = (hours * 60) / slotMin;

  // --- LiveKit connection minutes
  const speakers = 2 * minutes;          // ~2 on stage at a time
  const crew = 2 * minutes;              // producer + the captioning agent
  const viewerMin = viewers * minutes;
  const connMin = speakers + crew + viewerMin;
  const connOver = Math.max(0, connMin - RATE.livekit.connMinInc) * RATE.livekit.connMinOver;

  // --- LiveKit data transfer
  const viewerGb = (viewers * minutes * MB_PER_MIN(VIEWER_MBPS)) / 1024;
  const rtmpGb = (DESTINATIONS * minutes * MB_PER_MIN(RTMP_MBPS)) / 1024;
  const dataGb = viewerGb + rtmpGb;
  const dataOver = Math.max(0, dataGb - RATE.livekit.dataGbInc) * RATE.livekit.dataGbOver;

  // --- LiveKit transcode: the 24h broadcast egress + one recording per slot
  const transcodeMin = minutes + slots * slotMin;
  const transcodeOver = Math.max(0, transcodeMin - RATE.livekit.transcodeMinInc) * RATE.livekit.transcodeMinOver;

  // --- Deepgram: two live streams for the whole event
  const deepgram = 2 * minutes * RATE.deepgramStreamMin;

  // --- Claude: one clip-picking call per finished segment
  const claude = slots * (7000 * RATE.claude.inPerTok + 2500 * RATE.claude.outPerTok);

  // --- Supabase: the recordings and the clips they become
  const recordingGb = (slots * slotMin * MB_PER_MIN(VIEWER_MBPS)) / 1024;
  const clipGb = (slots * 4 * 3 * 8) / 1024;              // 4 moments, 3 shapes, ~8MB
  const storedGb = recordingGb + clipGb;
  const r2 = recordingGb * RATE.r2GbMonth;
  const storage = Math.max(0, clipGb - RATE.supabase.storageGbInc) * RATE.supabase.storageGbOver;

  // Pre-recorded segments play from storage to every viewer's own browser.
  const prerecGb = (prerecordedSlots * slotMin * viewers * MB_PER_MIN(VIEWER_MBPS)) / 1024;
  const egressGb = prerecGb + clipGb;
  const egress = Math.max(0, egressGb - RATE.supabase.egressGbInc) * RATE.supabase.cachedGbOver;

  // Rendering the clips: a 2 vCPU box running ffmpeg, held for the day plus a
  // day of catch-up. Flat, like everything else about making a clip.
  const clipWorker = 0.09 * 48;

  const lines = [
    ["LiveKit Ship (monthly plan)", RATE.livekit.ship],
    [`LiveKit connection minutes (${Math.round(connMin).toLocaleString()}, ${RATE.livekit.connMinInc.toLocaleString()} included)`, connOver],
    [`LiveKit data transfer (${Math.round(dataGb)} GB, 250 GB included)`, dataOver],
    [`LiveKit transcode (${transcodeMin.toLocaleString()} min, 600 included)`, transcodeOver],
    [`Deepgram live captions (${(2 * minutes).toLocaleString()} min)`, deepgram],
    [`Claude clip selection (${slots} segments)`, claude],
    ["Clip rendering (48 h of worker time, three aspect ratios)", clipWorker],
    ["Supabase Pro (monthly plan)", RATE.supabase.pro],
    [`Cloudflare R2 — recordings (${Math.round(recordingGb)} GB, egress free)`, r2],
    [`Supabase storage — clips (${Math.round(clipGb)} GB, 8 GB included)`, storage],
    [`Supabase egress (${Math.round(egressGb)} GB served)`, egress],
    ["Upload-Post (monthly plan)", RATE.uploadPost],
    ["Vercel Pro (monthly plan)", RATE.vercelPro],
    ["Resend (monthly plan)", RATE.resend],
  ];
  const total = lines.reduce((n, [, v]) => n + v, 0);
  const fixed = RATE.livekit.ship + RATE.supabase.pro + RATE.vercelPro + RATE.resend + RATE.uploadPost;
  return { viewers, lines, total, fixed, variable: total - fixed, connMin, dataGb, prerecGb, storedGb };
}

for (const viewers of [25, 100, 400]) {
  const r = event({ viewers });
  console.log(`\n=== ${viewers} average concurrent on the watch page ===`);
  for (const [label, v] of r.lines) console.log(`  ${label.padEnd(62)} $${v.toFixed(2)}`);
  console.log(`  ${"TOTAL".padEnd(62)} $${r.total.toFixed(2)}`);
  console.log(`  (fixed $${r.fixed.toFixed(2)} · variable $${r.variable.toFixed(2)} · $${(r.variable / 48).toFixed(2)} per slot)`);
  console.log(`  pre-recorded segments served from storage: ${Math.round(r.prerecGb)} GB`);
}

// --- one podcaster, ongoing --------------------------------------------------
const SINGLE_EGRESS = process.env.SINGLE_EGRESS === "1";

function monthly({ shows, minutesEach, viewers, clipsPerShow = 4 }) {
  const minutes = shows * minutesEach;
  const connMin = (2 + viewers) * minutes + minutes; // guests + viewers + agent
  const dataGb = (viewers * minutes * MB_PER_MIN(VIEWER_MBPS)) / 1024 + (minutes * MB_PER_MIN(RTMP_MBPS) * 2) / 1024;
  // Two egresses per minute of show today: the broadcast composite and the
  // recording. One egress can carry both a file output and a stream output,
  // which is the single biggest saving available here.
  const transcodeMin = minutes * (SINGLE_EGRESS ? 1 : 2);
  const storedGb = (minutes * MB_PER_MIN(VIEWER_MBPS)) / 1024 + (shows * clipsPerShow * 3 * 8) / 1024;

  const cost =
    connMin * RATE.livekit.connMinOver +
    dataGb * RATE.livekit.dataGbOver +
    transcodeMin * RATE.livekit.transcodeMinOver +
    2 * minutes * RATE.deepgramStreamMin +
    shows * (7000 * RATE.claude.inPerTok + 2500 * RATE.claude.outPerTok) +
    (minutes * MB_PER_MIN(VIEWER_MBPS)) / 1024 * RATE.r2GbMonth +
    ((shows * clipsPerShow * 3 * 8) / 1024) * RATE.supabase.storageGbOver;

  return { minutes, cost, connMin, dataGb, transcodeMin, storedGb };
}

console.log("\n\n=== marginal cost of one podcaster per month (at list rates, no plan allowance) ===");
for (const p of [
  { name: "2h/mo, 5 live viewers", shows: 2, minutesEach: 60, viewers: 5 },
  { name: "6h/mo, 15 live viewers", shows: 6, minutesEach: 60, viewers: 15 },
  { name: "6h/mo, 40 live viewers", shows: 6, minutesEach: 60, viewers: 40 },
  { name: "25h/mo, 40 live viewers", shows: 25, minutesEach: 60, viewers: 40 },
]) {
  const r = monthly(p);
  console.log(`  ${p.name.padEnd(48)} $${r.cost.toFixed(2)}  (${r.minutes} min live, ${r.storedGb.toFixed(1)} GB kept)`);
}
