import { QueryClient, QueryFunction } from "@tanstack/react-query";

export const API_BASE = "__PORT_5000__".startsWith("__") ? "" : "__PORT_5000__";

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    throw new Error(`${res.status}: ${text}`);
  }
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<Response> {
  const res = await fetch(`${API_BASE}${url}`, {
    method,
    headers: data ? { "Content-Type": "application/json" } : {},
    body: data ? JSON.stringify(data) : undefined,
  });

  await throwIfResNotOk(res);
  return res;
}

// For multipart/form-data uploads (e.g. a signup photo). Do not set a
// Content-Type header manually here — the browser needs to add its own
// multipart boundary, which it only does when Content-Type is left unset.
export async function apiUpload(method: string, url: string, formData: FormData): Promise<Response> {
  const res = await fetch(`${API_BASE}${url}`, {
    method,
    body: formData,
  });

  await throwIfResNotOk(res);
  return res;
}

export function resolveUploadUrl(photoUrl: string): string {
  if (!photoUrl) return "";
  return `${API_BASE}${photoUrl}`;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const res = await fetch(`${API_BASE}${queryKey.join("/")}`);

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    await throwIfResNotOk(res);
    return await res.json();
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: Infinity,
      // A cold serverless start can throw one 500; retry those briefly. Never
      // retry 4xx (401 drives the sign-in screen, 404s are real).
      retry: (count, err) => count < 2 && !/^4\d\d:/.test(String((err as Error)?.message ?? "")),
      retryDelay: (attempt) => 600 * (attempt + 1),
    },
    mutations: {
      retry: false,
    },
  },
});
