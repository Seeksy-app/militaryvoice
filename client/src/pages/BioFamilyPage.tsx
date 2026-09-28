import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { BioFamilyView } from "@/components/BioFamilyView";
import type { ChatMsg } from "@/components/BioPageView";
import type { BioFamilyPublic } from "@shared/bio";

/** militaryvoices.ai/<handle>/family/<key>: the private Family view. Not indexed. */
export default function BioFamilyPage({ handle, fkey }: { handle: string; fkey: string }) {
  const h = handle.toLowerCase();
  const q = useQuery<BioFamilyPublic | null>({
    queryKey: ["/api/public/bio", h, "family", fkey],
    queryFn: async () => { const r = await fetch(`/api/public/bio/${encodeURIComponent(h)}/family/${encodeURIComponent(fkey)}`); return r.ok ? r.json() : null; },
    retry: false,
  });
  useEffect(() => {
    const m = document.createElement("meta");
    m.name = "robots"; m.content = "noindex, nofollow";
    document.head.appendChild(m);
    return () => { m.remove(); };
  }, []);
  useEffect(() => { if (q.data) document.title = `${q.data.displayName || q.data.handle}, for family`; }, [q.data?.handle]);
  if (q.isLoading) return <div className="min-h-screen bg-[#0b1020]" />;
  if (!q.data) return (
    <div className="flex min-h-screen items-center justify-center bg-[#0b1020] p-6 text-center text-white">
      <div><p className="text-xl font-bold">This link isn't working</p><p className="mt-2 text-sm text-white/70">Ask for a new one. Family links can be changed to keep the page private.</p></div>
    </div>
  );
  return (
    <div data-bio-public className="min-h-screen" style={{ background: q.data.theme.shade === "dark" ? "#0b1020" : "#f5f6fa" }}>
      <BioFamilyView
        data={q.data}
        onAsk={async (x) => {
          const r = await fetch(`/api/public/bio/${encodeURIComponent(h)}/ask`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(x) });
          const j = (await r.json().catch(() => ({}))) as { message?: string; token?: string; createdAt?: string };
          if (!r.ok) throw new Error(j.message || "Couldn't send that. Try again.");
          return j;
        }}
        onLoadMessages={async (tokens) => {
          const r = await fetch(`/api/public/bio/${encodeURIComponent(h)}/messages`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tokens }) });
          if (!r.ok) throw new Error("Couldn't load your messages.");
          return ((await r.json()) as { messages: ChatMsg[] }).messages;
        }}
      />
    </div>
  );
}
