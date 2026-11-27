// Admin routes authenticate with the httpOnly `mv_admin_session` cookie set by
// the email-code sign-in, so nothing secret travels in the URL.
const API_BASE = "__PORT_5000__".startsWith("__") ? "" : "__PORT_5000__";

/**
 * Track R (R-B, PM 26 Nov): inside an event's admin pages (/admin/e/:id), calls to the event-scoped areas carry
 * ?eventId= so the server stops falling back to the featured event. Never on platform pages, and never on routes
 * where ?eventId is a filter with no default (CRM people, broadcasts, segments, recordings, sms log, signups list).
 */
let scopedEventId: number | null = null;
export function setAdminEventScope(id: number | null) { scopedEventId = id; }
const EVENT_SCOPED = [
  "/api/admin/run-of-show", "/api/admin/sponsors", "/api/admin/sponsor-packages", "/api/admin/sponsor-leads", "/api/admin/show-sponsors",
  "/api/admin/sponsor-finder", "/api/admin/emails/recipients", "/api/admin/signups/follow-up", "/api/admin/destinations", "/api/admin/studios",
  "/api/admin/studio-hosts", "/api/admin/event-admins", "/api/admin/cohost-slots", "/api/admin/social-posts", "/api/admin/finance-actuals",
  "/api/admin/production-costs", "/api/admin/greenroom/", "/api/admin/media", "/api/admin/clips", "/api/admin/scene-takes",
  "/api/admin/sms/people", "/api/admin/connections", "/api/admin/ingress", "/api/admin/standby-build",
];
/** A path in the event-scoped areas (its answer depends on which event the page is on). */
export function isEventScoped(path: string): boolean {
  const bare = path.split("?")[0];
  return EVENT_SCOPED.some((p) => bare === p || bare.startsWith(p.endsWith("/") ? p : `${p}/`));
}
export function withEvent(path: string): string {
  if (!scopedEventId || /[?&]eventId=/.test(path) || !isEventScoped(path)) return path;
  // finance-actuals ?scope=platform means the whole platform: leave it alone.
  if (/[?&]scope=platform/.test(path)) return path;
  return `${path}${path.includes("?") ? "&" : "?"}eventId=${scopedEventId}`;
}

async function throwIfNotOk(res: Response) {
  if (!res.ok) {
    let message = res.statusText;
    const text = await res.text();
    if (text) {
      try {
        message = (JSON.parse(text) as { message?: string }).message ?? text;
      } catch {
        message = text;
      }
    }
    throw new Error(message);
  }
}

export async function adminGet<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${withEvent(path)}`);
  await throwIfNotOk(res);
  return res.json();
}

export async function adminSend(method: string, path: string, body?: unknown): Promise<Response> {
  const res = await fetch(`${API_BASE}${withEvent(path)}`, {
    method,
    headers: body !== undefined ? { "Content-Type": "application/json" } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  await throwIfNotOk(res);
  return res;
}

/** Multipart upload (e.g. a sponsor logo). The browser sets the boundary header. */
export async function adminUpload(path: string, formData: FormData): Promise<Response> {
  const res = await fetch(`${API_BASE}${path}`, { method: "POST", body: formData });
  await throwIfNotOk(res);
  return res;
}

export function adminExportUrl(): string {
  return `${API_BASE}/api/admin/export.csv`;
}
