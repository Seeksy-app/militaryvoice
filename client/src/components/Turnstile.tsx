import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";

// Cloudflare's Turnstile widget. Invisible for nearly everyone; the token it
// hands back goes up with the form and the server checks it. The server also
// decides whether it's on at all — ask it, and render nothing when it says no.

declare global {
  interface Window {
    turnstile?: {
      render: (el: HTMLElement, opts: Record<string, unknown>) => string;
      reset: (id: string) => void;
      remove: (id: string) => void;
    };
    __mvTurnstileReady?: () => void;
  }
}

const SCRIPT = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=__mvTurnstileReady";
let loading: Promise<void> | null = null;

function loadScript(): Promise<void> {
  if (window.turnstile) return Promise.resolve();
  if (loading) return loading;
  loading = new Promise<void>((resolve) => {
    window.__mvTurnstileReady = () => resolve();
    const s = document.createElement("script");
    s.src = SCRIPT;
    s.async = true;
    document.head.appendChild(s);
  });
  return loading;
}

/** null while unknown, "" when off, otherwise the site key. */
export function useTurnstileSiteKey(): string | null {
  const { data } = useQuery<{ siteKey: string | null }>({ queryKey: ["/api/turnstile"], staleTime: Infinity, retry: false });
  if (data === undefined) return null;
  return data.siteKey ?? "";
}

export function Turnstile({
  siteKey,
  onToken,
  resetSignal = 0,
}: {
  siteKey: string;
  onToken: (token: string | null) => void;
  /** Bump after every submit: a token is single-use. */
  resetSignal?: number;
}) {
  const host = useRef<HTMLDivElement>(null);
  const widget = useRef<string | null>(null);
  const latest = useRef(onToken);
  latest.current = onToken;

  useEffect(() => {
    let cancelled = false;
    loadScript().then(() => {
      if (cancelled || !host.current || !window.turnstile) return;
      widget.current = window.turnstile.render(host.current, {
        sitekey: siteKey,
        theme: "auto",
        size: "flexible",
        callback: (token: string) => latest.current(token),
        "expired-callback": () => latest.current(null),
        "error-callback": () => latest.current(null),
      });
    });
    return () => {
      cancelled = true;
      if (widget.current && window.turnstile) window.turnstile.remove(widget.current);
      widget.current = null;
    };
  }, [siteKey]);

  useEffect(() => {
    if (resetSignal > 0 && widget.current && window.turnstile) {
      window.turnstile.reset(widget.current);
      latest.current(null);
    }
  }, [resetSignal]);

  return <div ref={host} className="min-h-[65px]" data-testid="turnstile" />;
}
