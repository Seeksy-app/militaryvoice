import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { BioBrandsView } from "@/components/BioBrandsView";
import NotFound from "@/pages/not-found";
import type { BioBrandsPublic } from "@shared/bio";

/** militaryvoices.ai/<handle>/brands: a podcaster's media kit, for sponsors. */
export default function BioBrandsPage({ handle }: { handle: string }) {
  const h = handle.toLowerCase();
  const q = useQuery<BioBrandsPublic | null>({
    queryKey: ["/api/public/bio", h, "brands"],
    queryFn: async () => { const r = await fetch(`/api/public/bio/${encodeURIComponent(h)}/brands`); return r.ok ? r.json() : null; },
    retry: false,
  });
  useEffect(() => { if (q.data) document.title = `Sponsor ${q.data.displayName || q.data.handle} · MilitaryVoices.ai`; }, [q.data?.handle]);
  if (q.isLoading) return <div className="min-h-screen bg-[#0b1020]" />;
  if (!q.data) return <NotFound />;
  return (
    <div data-bio-public className="min-h-screen" style={{ background: q.data.theme.shade === "dark" ? "#0b1020" : "#f5f6fa" }}>
      <BioBrandsView
        data={q.data}
        listenUrl={`/${q.data.handle}`}
        onSponsor={async (x) => {
          const r = await fetch(`/api/public/bio/${encodeURIComponent(h)}/sponsor`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(x) });
          if (!r.ok) throw new Error(((await r.json().catch(() => ({}))) as { message?: string }).message || "Couldn't send that. Try again.");
        }}
      />
    </div>
  );
}
