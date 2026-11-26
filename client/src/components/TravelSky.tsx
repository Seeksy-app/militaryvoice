/**
 * The sky behind Travel's title (Andrew's target v2, 26 Nov: "make a copy of it"): a photographic pale-blue sky with a
 * white jet climbing at the right. The photo is ours, made on fal for this page (plain white jet, no airline livery),
 * 18 KB at /travel/hero-sky.webp. Its left and bottom edges fade into a gradient of the same blues, so the title sits
 * on calm sky and the jet stays clear of the search card.
 */
export function TravelSky() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      <div className="absolute inset-0 bg-[linear-gradient(180deg,#b4d6ec_0%,#c9e0f0_45%,#e6f0f9_80%,#f4f8fd_100%)] dark:bg-none dark:bg-gradient-to-b dark:from-[#0c2347] dark:via-[#0d1f3d] dark:to-transparent" />
      <div className="absolute inset-0 bg-[radial-gradient(60%_80%_at_18%_30%,rgba(255,255,255,0.55),transparent_70%)] dark:hidden" />
      <img
        src="/travel/hero-sky.webp"
        alt=""
        width={1100}
        height={449}
        decoding="async"
        className="absolute right-0 top-1 hidden h-[128px] w-auto max-w-none [mask-image:linear-gradient(to_right,transparent_0%,#000_30%),linear-gradient(to_bottom,#000_72%,transparent_100%)] [mask-composite:intersect] [-webkit-mask-composite:source-in] sm:block lg:h-[142px] dark:opacity-30"
      />
    </div>
  );
}
