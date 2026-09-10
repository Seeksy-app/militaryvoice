// Admin routes authenticate via a `?password=` query param instead of a
// header, because the CSV export needs to work as a plain link too.
const API_BASE = "__PORT_5000__".startsWith("__") ? "" : "__PORT_5000__";

function withPassword(path: string, password: string) {
  const sep = path.includes("?") ? "&" : "?";
  return `${path}${sep}password=${encodeURIComponent(password)}`;
}

async function throwIfNotOk(res: Response) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    throw new Error(text);
  }
}

export async function adminGet<T>(path: string, password: string): Promise<T> {
  const res = await fetch(`${API_BASE}${withPassword(path, password)}`);
  await throwIfNotOk(res);
  return res.json();
}

export async function adminSend(method: string, path: string, password: string, body?: unknown): Promise<Response> {
  const res = await fetch(`${API_BASE}${withPassword(path, password)}`, {
    method,
    headers: body !== undefined ? { "Content-Type": "application/json" } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  await throwIfNotOk(res);
  return res;
}

export function adminExportUrl(password: string): string {
  return `${API_BASE}${withPassword("/api/admin/export.csv", password)}`;
}
