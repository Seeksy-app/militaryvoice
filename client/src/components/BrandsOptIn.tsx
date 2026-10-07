import { useQueryClient } from "@tanstack/react-query";
import { BadgeDollarSign, ExternalLink } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

// Let brands find me (7 Oct): a member's own say-so to show up when brands
// search Discovery. Off until they turn it on. Brands see their card (name,
// photo, show, reach) and their SmartLink media kit, and ask us for an
// introduction; their email and phone stay private.

export function BrandsOptIn({ on, onGoPage, hasKit }: { on: boolean; onGoPage: () => void; hasKit: boolean }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const set = async (next: boolean) => {
    try {
      await apiRequest("PUT", "/api/host/open-to-brands", { on: next });
      await qc.invalidateQueries({ queryKey: ["/api/host/profile"] });
      toast({ title: next ? "Brands can find you now" : "You're hidden from brands", description: next ? "You'll show up when brands search Discovery. We make every introduction; your email and number stay private." : undefined });
    } catch (e) {
      toast({ title: "Didn't change", description: (e as Error).message, variant: "destructive" });
    }
  };
  return (
    <section id="brands-optin" className="mb-6 flex scroll-mt-24 flex-wrap items-start gap-4 rounded-2xl border border-border bg-card p-5" data-testid="brands-optin">
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#F0A71F]/15 text-[#8a5a00] dark:text-[#F0A71F]"><BadgeDollarSign className="h-5 w-5" /></span>
      <div className="min-w-0 flex-1">
        <label htmlFor="brands-optin-switch" className="text-base font-semibold">Let brands find me</label>
        <p className="mt-0.5 text-sm text-muted-foreground [text-wrap:pretty]">Show up when brands search for military and veteran creators to sponsor, hire or book. They see your card and your media kit, and ask us to introduce you. Your email and number stay private.</p>
        {on && (
          <button type="button" onClick={onGoPage} className="mt-2 inline-flex items-center gap-1 text-sm font-semibold text-[#053877] hover:underline dark:text-[#9cc2ff]">
            {hasKit ? "Your media kit is what they see" : "Add a media kit to your SmartLink"} <ExternalLink className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      <Switch id="brands-optin-switch" checked={on} onCheckedChange={(v) => void set(v)} className="mt-1 data-[state=checked]:bg-[#1a9e5f]" data-testid="switch-brands-optin" />
    </section>
  );
}
