// Thin, SSR-safe wrapper around the global gtag() function that
// GoogleAnalyticsScripts (components/analytics/google-analytics-scripts.tsx)
// loads via next/script. Every function here is a no-op on the server, and
// a no-op on the client until that script has actually finished loading --
// nothing here ever throws, and nothing here ever fabricates data.

export const GA_MEASUREMENT_ID = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID || null;

declare global {
  interface Window {
    dataLayer: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
}

function isReady(): boolean {
  return Boolean(GA_MEASUREMENT_ID) && typeof window !== "undefined" && typeof window.gtag === "function";
}

/**
 * Records a page view. Called exactly once per route change by
 * <AnalyticsListener>. gtag's own config() call is initialized with
 * send_page_view: false specifically so this is the *only* source of
 * page_view events -- never both, which would double-count every session.
 */
export function pageview(path: string): void {
  if (!isReady()) return;
  window.gtag!("event", "page_view", {
    page_path: path,
    page_location: window.location.href,
    page_title: document.title,
  });
}

/**
 * Records a custom event. Safe to call from anywhere -- before the script
 * has loaded, with no measurement ID configured, or (guarded) from a
 * server-rendered code path -- it silently no-ops rather than throwing.
 */
export function trackEvent(name: string, params: Record<string, unknown> = {}): void {
  if (!isReady()) return;
  window.gtag!("event", name, params);
}
