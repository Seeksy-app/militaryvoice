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

/** Off to Stripe Checkout for a monthly plan. */
export async function startPlanCheckout(plan: string, interval: "month" | "year" = "month"): Promise<void> {
  try {
    const { url } = await (await apiRequest("POST", "/api/host/plan/checkout", { plan, interval })).json();
    window.location.href = url;
  } catch (e) {
    if ((e as { status?: number }).status === 401) {
      window.location.href = "/host/dashboard/postify";
      return;
    }
    throw e;
  }
}

/** Stripe's billing page for their plan: card, change plan, invoices, cancel. */
export async function openBillingPortal(): Promise<void> {
  const { url } = await (await apiRequest("POST", "/api/host/plan/portal")).json();
  window.location.href = url;
}
