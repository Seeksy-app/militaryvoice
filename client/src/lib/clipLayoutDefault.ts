import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";

/**
 * The account-wide default for two people on screen ("My shows are: Stacked / Side by side /
 * Follow the speaker"). "" is Automatic. Set in Podcast > Settings > Publishing (Clip layout); Make clips lights
 * it when the recording has no layout of its own and nothing has been picked on screen.
 * The server field is clipLayoutDefault; until it answers, `value` is null and the setting stays hidden.
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
  return { value: q.data ?? null, loading: q.isLoading, save };
}
