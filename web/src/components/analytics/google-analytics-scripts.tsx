import Script from "next/script";
import { GA_MEASUREMENT_ID } from "@/lib/analytics/gtag";

/**
 * Loads gtag.js and initializes it with send_page_view disabled -- every
 * page view is instead tracked once, explicitly, by <AnalyticsListener>, so
 * a route never gets counted twice (once from gtag's own automatic
 * pageview on initial script load, once from our own SPA navigation
 * tracking). Renders nothing -- no script tag, no network request, no
 * tracking -- when NEXT_PUBLIC_GA_MEASUREMENT_ID isn't configured. This
 * check runs server-side (this is a Server Component), so an unconfigured
 * environment never ships analytics script references at all.
 */
export function GoogleAnalyticsScripts() {
  if (!GA_MEASUREMENT_ID) return null;

  return (
    <>
      <Script src={`https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`} strategy="afterInteractive" />
      <Script id="ga4-init" strategy="afterInteractive">
        {`
          window.dataLayer = window.dataLayer || [];
          function gtag(){dataLayer.push(arguments);}
          gtag('js', new Date());
          gtag('config', '${GA_MEASUREMENT_ID}', { send_page_view: false });
        `}
      </Script>
    </>
  );
}
