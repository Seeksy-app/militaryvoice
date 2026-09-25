import { apiRequest } from "@/lib/queryClient";

/**
 * Off to Stripe Checkout for a token pack. Not signed in: Pōstify first (it
 * signs them in, and the same buttons are there).
 */
export async function startTokenCheckout(pack: string): Promise<void> {
  try {
    const { url } = await (await apiRequest("POST", "/api/host/tokens/checkout", { pack })).json();
    window.location.href = url;
  } catch (e) {
    if ((e as { status?: number }).status === 401) {
      window.location.href = "/host/dashboard/postify";
      return;
    }
    throw e;
  }
}
