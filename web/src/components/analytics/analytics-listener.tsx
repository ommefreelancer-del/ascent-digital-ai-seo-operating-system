"use client";

import * as React from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { pageview } from "@/lib/analytics/gtag";
import { trackOutboundClick } from "@/lib/analytics/events";

/**
 * Mounted once in the root layout. Owns the two kinds of tracking that have
 * to run globally rather than from one specific feature component:
 *
 *  - SPA page views on every route change. App Router client-side
 *    navigations never trigger a real page load, so gtag's own automatic
 *    page_view (which only fires once, on initial script load) would
 *    otherwise miss every navigation after the first -- this effect is the
 *    single source of truth for page_view instead, covering both the first
 *    render and every subsequent route change exactly once.
 *  - Outbound link clicks, via one delegated document listener rather than
 *    instrumenting every individual <a>, so any current or future link to
 *    an external domain is covered automatically.
 *
 * Renders nothing; this is a behavior-only component.
 */
export function AnalyticsListener() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  React.useEffect(() => {
    const query = searchParams.toString();
    pageview(query ? `${pathname}?${query}` : pathname);
  }, [pathname, searchParams]);

  React.useEffect(() => {
    function handleClick(event: MouseEvent) {
      const anchor = (event.target as HTMLElement | null)?.closest("a");
      const href = anchor?.getAttribute("href");
      if (!href) return;

      let url: URL;
      try {
        url = new URL(href, window.location.href);
      } catch {
        return;
      }

      if (url.hostname === window.location.hostname) return;
      trackOutboundClick({ url: url.href, domain: url.hostname });
    }

    document.addEventListener("click", handleClick);
    return () => document.removeEventListener("click", handleClick);
  }, []);

  return null;
}
