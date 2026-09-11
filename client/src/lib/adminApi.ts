// Admin routes authenticate with the httpOnly `mv_admin_session` cookie set by
// the email-code sign-in, so nothing secret travels in the URL.
const API_BASE = "__PORT_5000__".startsWith("__") ? "" : "__PORT_5000__";

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
  const res = await fetch(`${API_BASE}${path}`);
  await throwIfNotOk(res);
  return res.json();
}

export async function adminSend(method: string, path: string, body?: unknown): Promise<Response> {
  const res = await fetch(`${API_BASE}${path}`, {
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
