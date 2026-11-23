import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";

/**
 * The creator's last pick for two people on screen (Stacked / Side by side / Follow the speaker; "" is Automatic).
 * Pōstify is the one place it's chosen (Andrew, 23 Nov 2026: "Yes, Pōstify only"): every pick in Make clips is
 * remembered here, and the next recording starts on it, after the recording's own layout (a Radio stack) and
 * before what the detector saw. Only Pōstify clips use it: a Zoom recording stays as Zoom recorded it, and in
 * Studio the host picks live. The server field is clipLayoutDefault; until it answers, `value` is null.
 */
export type DefaultLayout = "" | "stacked" | "side" | "single";

const KEY = ["/api/host/clip-layout-default"];
const VALID: DefaultLayout[] = ["", "stacked", "side", "single"];

export function useClipLayoutDefault() {
  const qc = useQueryClient();
  const q = useQuery<DefaultLayout | null>({
    queryKey: KEY,
    queryFn: async () => {
      try {
        const r = (await (await apiRequest("GET", "/api/host/clip-layout-default")).json()) as { clipLayoutDefault?: string };
        return VALID.includes((r.clipLayoutDefault ?? "") as DefaultLayout) ? ((r.clipLayoutDefault ?? "") as DefaultLayout) : "";
      } catch {
        return null; // not there (yet): no setting, no default
      }
    },
    staleTime: 5 * 60_000,
  });
  const save = useMutation({
    mutationFn: async (v: DefaultLayout) => { await apiRequest("PUT", "/api/host/clip-layout-default", { clipLayoutDefault: v }); return v; },
    onMutate: async (v) => { qc.setQueryData(KEY, v); },
    onError: () => { void qc.invalidateQueries({ queryKey: KEY }); },
  });
  /** Keep a pick made on screen as the starting choice next time. Quiet: nothing to confirm, and a miss costs nothing. */
  const remember = (l: string | undefined | null) => {
    const v: DefaultLayout = l === "radio" ? "stacked" : VALID.includes((l ?? "") as DefaultLayout) ? ((l ?? "") as DefaultLayout) : "";
    if (q.data !== null && q.data !== undefined && q.data !== v) save.mutate(v);
  };
  return { value: q.data ?? null, loading: q.isLoading, save, remember };
}
