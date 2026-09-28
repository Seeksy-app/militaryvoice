import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { BioPageView } from "@/components/BioPageView";
import NotFound from "@/pages/not-found";
import type { BioPublic } from "@shared/bio";

/** militaryvoices.ai/<handle>: a podcaster's page, as the builder previews it. */
export default function BioPublicPage({ handle }: { handle: string }) {
  const h = handle.toLowerCase();
  const q = useQuery<BioPublic | null>({
    queryKey: ["/api/public/bio", h],
    queryFn: async () => { const r = await fetch(`/api/public/bio/${encodeURIComponent(h)}`); return r.ok ? r.json() : null; },
    retry: false,
  });
  const event = (kind: string, label = "") => { void fetch(`/api/public/bio/${encodeURIComponent(h)}/event`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind, label }), keepalive: true }).catch(() => {}); };
  useEffect(() => {
    if (!q.data) return;
    document.title = `${q.data.displayName || q.data.handle} · MilitaryVoices.ai`;
    event("view");
    // An episode shared from here opens at it.
    const id = window.location.hash.slice(1);
    if (id) setTimeout(() => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "center" }), 300);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q.data?.handle]);
  if (q.isLoading) return <div className="min-h-screen bg-[#0b1020]" />;
  if (!q.data) return <NotFound />;
  return (
    <div data-bio-public className="min-h-screen" style={{ background: q.data.theme.shade === "dark" ? "#0b1020" : "#f5f6fa" }}>
      <BioPageView
        data={q.data}
        shareBase={`${window.location.origin}/${q.data.handle}`}
        onEvent={event}
        onAskAi={async (question, history) => {
          const r = await fetch(`/api/public/bio/${encodeURIComponent(h)}/ask-ai`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ question, history }) });
          const j = await r.json().catch(() => ({}));
          if (!r.ok) throw new Error((j as { message?: string }).message || "Couldn't ask that. Try again.");
          return j;
        }}
        onAsk={async (x) => {
          const r = await fetch(`/api/public/bio/${encodeURIComponent(h)}/ask`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(x) });
          if (!r.ok) throw new Error(((await r.json().catch(() => ({}))) as { message?: string }).message || "Couldn't send that. Try again.");
        }}
      />
    </div>
  );
}
