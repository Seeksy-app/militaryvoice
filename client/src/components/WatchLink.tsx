import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, Copy } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";

/**
 * Their watch page's link, to copy and send (Andrew, 25 Nov 2026: "Yes, build it", the watch page for everyone).
 * Every account has one: their SmartLink's handle, else a watch address made the first time it's asked for.
 */
export type LivePageInfo = { on: boolean; url: string; handle: string; photo: string; streamInOut: boolean; live: boolean };

export function useWatchPage() {
  return useQuery<LivePageInfo>({ queryKey: ["/api/host/live-page"], queryFn: async () => (await apiRequest("GET", "/api/host/live-page")).json() });
}

export const shortUrl = (url: string) => url.replace(/^https?:\/\/(www\.)?/, "");

/** "Copy link", then "Copied" for two seconds. */
export function CopyLinkButton({ url, solid = false, testId }: { url: string; solid?: boolean; testId?: string }) {
  const [done, setDone] = useState(false);
  const copy = () => void navigator.clipboard.writeText(url).then(() => { setDone(true); setTimeout(() => setDone(false), 2000); }).catch(() => {});
  return (
    <button
      type="button"
      onClick={copy}
      className={`flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-xl px-3 text-[13px] font-bold ${solid ? "bg-[#053877] text-white hover:bg-[#0a4a99]" : "border border-[#d0d5dd] bg-white text-[#344054] hover:bg-[#f9fafb]"}`}
      data-testid={testId}
    >
      {done ? <Check className="h-4 w-4" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />}
      {done ? "Copied" : "Copy link"}
    </button>
  );
}

/** The card: where people watch them, with the link to copy. */
export function WatchLinkCard({ note, testId = "watch-link-card" }: { note: string; testId?: string }) {
  const { data } = useWatchPage();
  if (!data?.url) return null;
  return (
    // Phone: title and Copy link share the top row, the full link and note run below at full width (never cut off).
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 rounded-2xl border border-[#d5e1f2] bg-[#f5f8fd] p-3.5 dark:border-white/10 dark:bg-white/5" data-testid={testId}>
      <p className="text-sm font-semibold">Where people can watch</p>
      <div className="sm:row-span-2"><CopyLinkButton url={data.url} testId={`${testId}-copy`} /></div>
      <p className="col-span-2 text-[13px] text-[#475467] sm:col-span-1 dark:text-white/70">
        <a href={data.url} target="_blank" rel="noreferrer" className="break-all font-medium text-[#053877] hover:underline dark:text-white">{shortUrl(data.url)}</a>
        {note ? ` · ${note}` : ""}
      </p>
    </div>
  );
}

/**
 * The Stream in page's card: where people watch what they send in. `plays` is false while their stream key's engine
 * can't reach the watch page yet (our own box before its watch relay is on): then it only promises the studio.
 */
export function StreamInWatchCard({ plays }: { plays: boolean }) {
  const { data } = useWatchPage();
  if (!data?.url) return null;
  return (
    <div className="mt-8 rounded-2xl border border-border bg-card p-5 sm:p-6" data-testid="stream-in-watch">
      <div className="flex items-center gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#053877] text-[12px] font-extrabold text-white" aria-hidden>MV</span>
        <div className="min-w-0 flex-1">
          <p className="font-bold text-card-foreground">Where people watch you</p>
          <a href={data.url} target="_blank" rel="noreferrer" className="block truncate text-[13px] font-medium text-[#053877] hover:underline dark:text-white">{shortUrl(data.url)}</a>
        </div>
        <CopyLinkButton url={data.url} solid testId="stream-in-watch-copy" />
      </div>
      <p className="mt-3 text-sm text-muted-foreground">
        {plays
          ? "Whatever you send us from StreamYard, OBS or Restream plays here, and so does your studio's Go live. It also goes on to your YouTube and the other places you've switched on."
          : "Your studio's Go live plays here. What you send from StreamYard, OBS or Restream is saved to your Library."}
        {!data.on && " Your watch page is switched off in Integrations, Live."}
      </p>
    </div>
  );
}
