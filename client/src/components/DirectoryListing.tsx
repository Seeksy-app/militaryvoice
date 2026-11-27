import { useMutation } from "@tanstack/react-query";
import { Switch } from "@/components/ui/switch";
import { apiRequest, queryClient } from "@/lib/queryClient";

/**
 * "Show me in the Member Directory": the member's own on/off for their public card (Andrew, 27 Nov 2026).
 * On the Profile screen, above the form the card is built from. Off hides the card only: their SmartLink,
 * show pages and events are untouched, and they can turn it back on any time.
 */
export function DirectoryListing({ hidden, hasPhoto }: { hidden: boolean; hasPhoto: boolean }) {
  const set = useMutation({
    mutationFn: async (listed: boolean) => (await apiRequest("PUT", "/api/host/directory-listing", { listed })).json(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/host/profile"] }),
  });
  const on = set.isPending && set.variables !== undefined ? set.variables : !hidden;
  return (
    <div className="mb-5 flex max-w-2xl items-start gap-3 rounded-xl border border-border bg-card px-4 py-3" data-testid="directory-listing">
      <div className="min-w-0 flex-1">
        <label htmlFor="directory-listed" className="block text-sm font-semibold">Show me in the Member&nbsp;Directory</label>
        <p className="mt-0.5 text-[13px] leading-snug text-muted-foreground">
          {on
            ? hasPhoto ? "Your card is on the public directory, where event organizers find you. " : "Your card shows once you add a photo below. "
            : "Your card is hidden. Your SmartLink, show pages and events aren't affected. "}
          <a href="/directory" target="_blank" rel="noreferrer" className="whitespace-nowrap font-semibold text-[#053877] underline-offset-2 hover:underline dark:text-[#8ab4f8]">See the directory</a>
        </p>
        {set.error && <p className="mt-1 text-[13px] text-destructive">{(set.error as Error).message}</p>}
      </div>
      <Switch id="directory-listed" checked={on} disabled={set.isPending} onCheckedChange={(v) => set.mutate(v)}
        className="mt-0.5 data-[state=checked]:bg-[#053877] dark:data-[state=checked]:bg-[#4f8fe0]" data-testid="directory-listed" />
    </div>
  );
}
