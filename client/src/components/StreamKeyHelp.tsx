import { useState } from "react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { PlatformIcon } from "@/components/SocialIcons";
import type { SocialPlatform } from "@shared/schema";
import { HelpCircle, Radio, AlertTriangle } from "lucide-react";

// "Add destination" assumes you already know what an RTMP server URL is and
// where your stream key lives. Almost nobody does, and every platform hides it
// somewhere different. This is that knowledge, next to the button.

interface Guide {
  key: string;
  name: string;
  platform?: SocialPlatform;
  server: string;
  steps: string[];
  caution?: string;
}

const GUIDES: Guide[] = [
  {
    key: "youtube",
    name: "YouTube",
    platform: "youtube",
    server: "rtmp://a.rtmp.youtube.com/live2",
    steps: [
      "YouTube Studio → Create → Go Live.",
      "Choose the Stream tab (not Webcam) on the left.",
      "Copy the Stream key. The Stream URL is the server above.",
      "Set the broadcast to Public or Unlisted before you start.",
    ],
    caution:
      "A channel that has never streamed needs live streaming enabled first, and there's a 24-hour wait before it activates. Don't discover that on the day.",
  },
  {
    key: "x",
    name: "X",
    platform: "x",
    server: "rtmp://va.pscp.tv:80/x",
    steps: [
      "X Media Studio → Producer → Sources → Create source.",
      "Pick RTMP and the region closest to you.",
      "Copy the stream key it shows.",
      "Create a broadcast and bind it to that source.",
    ],
    caution: "The account needs X Premium. Without it Media Studio won't issue a key at all.",
  },
  {
    key: "twitch",
    name: "Twitch",
    server: "rtmp://live.twitch.tv/app",
    steps: [
      "Creator Dashboard → Settings → Stream.",
      "Copy the Primary Stream key.",
      "Paste it with the server above.",
    ],
  },
  {
    key: "restream",
    name: "Restream, StreamYard or Castr",
    server: "given by the tool",
    steps: [
      "In the tool, add a custom RTMP input — not an output.",
      "It gives you an ingest URL and key; paste both here.",
      "We push to it, and it fans out to wherever you've connected it.",
    ],
    caution:
      "Worth it only for somewhere we can't reach directly — LinkedIn, mainly, which is partner-gated. For YouTube, X and Twitch, going straight there is one less thing to break.",
  },
  {
    key: "linkedin",
    name: "LinkedIn",
    platform: "linkedin",
    server: "no direct option",
    steps: [
      "LinkedIn has no self-serve RTMP. You have to be an approved broadcast partner.",
      "The way through is a partner tool — Restream, StreamYard, Socialive or Switcher.",
      "Add that tool as a custom destination here, and connect LinkedIn inside it.",
    ],
    caution: "The Page or profile also needs 150+ followers, and every live must now be scheduled in advance.",
  },
];

export function StreamKeyHelp() {
  const [open, setOpen] = useState(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
          data-testid="button-streamkey-help"
        >
          <HelpCircle className="h-3.5 w-3.5" /> Where do I find a stream key?
        </button>
      </SheetTrigger>

      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Where the stream key lives</SheetTitle>
          <SheetDescription>
            Every platform hides it somewhere different. A destination is two things: the server URL, which
            barely changes, and your key, which is a password — treat it like one.
          </SheetDescription>
        </SheetHeader>

        <div className="mt-6 flex flex-col gap-5">
          {GUIDES.map((g) => (
            <div key={g.key} className="rounded-xl border border-border bg-card p-4">
              <div className="flex items-center gap-2.5">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#053877] text-white">
                  {g.platform ? <PlatformIcon platform={g.platform} className="h-4 w-4" /> : <Radio className="h-4 w-4" />}
                </div>
                <h3 className="text-sm font-semibold">{g.name}</h3>
              </div>

              <ol className="mt-3 flex list-decimal flex-col gap-1.5 pl-5 text-sm text-muted-foreground">
                {g.steps.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>

              <div className="mt-3 rounded-lg bg-muted/60 px-3 py-2">
                <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                  Server URL
                </div>
                <code className="font-mono text-xs">{g.server}</code>
              </div>

              {g.caution && (
                <p className="mt-2.5 flex items-start gap-1.5 text-xs text-[#9A6206] dark:text-[#F0A71F]">
                  <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                  {g.caution}
                </p>
              )}
            </div>
          ))}

          <p className="pb-6 text-xs text-muted-foreground">
            You can add as many as you like and switch each on or off. Our own watch page carries the show
            regardless — everything here is in addition to it.
          </p>
        </div>
      </SheetContent>
    </Sheet>
  );
}
