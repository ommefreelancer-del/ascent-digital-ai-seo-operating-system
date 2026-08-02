// Real, network-fetching HTML retrieval. This is deliberately kept outside
// WebsiteAuditAgent (see src/agents/website-audit-agent/website-audit-agent.ts),
// which is frozen to never fetch anything itself -- callers (the crawler,
// the CLI, the web layer) fetch real HTML here and hand it to the agent.
//
// Redirects are followed manually (not via fetch's `redirect: "follow"`) so
// every hop can be re-validated against private/internal address ranges --
// otherwise a public URL could redirect the fetch into internal
// infrastructure (SSRF). This is the canonical implementation; web/src/
// server/backend/website-audit.ts re-exports it so there is exactly one copy.

import { assertPublicHttpUrl } from "./url-safety.js";

const FETCH_TIMEOUT_MS = 10_000;
const MAX_HTML_BYTES = 2_000_000;
const MAX_REDIRECTS = 5;
const USER_AGENT = "ADASOS-Crawler/1.0 (+https://ascentdigital.example)";

export interface FetchHtmlResult {
  /** The URL actually fetched, after following any redirects. */
  readonly finalUrl: string;
  readonly status: number;
  readonly html: string;
  /** Every URL visited in order, including the starting URL and the final one. */
  readonly redirectChain: readonly string[];
  /** Real response headers from the final hop, lower-cased keys, exactly as returned by the server. */
  readonly headers: Readonly<Record<string, string>>;
}

export class FetchHtmlError extends Error {
  constructor(
    message: string,
    public readonly url: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "FetchHtmlError";
  }
}

/**
 * Fetches a real page's HTML over the network, following redirects manually
 * and re-checking each hop against private/internal address ranges.
 */
export async function fetchHtmlWithDetails(url: string): Promise<FetchHtmlResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  const redirectChain: string[] = [];
  try {
    let currentUrl = url;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      redirectChain.push(currentUrl);
      await assertPublicHttpUrl(currentUrl);
      const response = await fetch(currentUrl, {
        signal: controller.signal,
        redirect: "manual",
        headers: { "user-agent": USER_AGENT },
      });

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location) {
          throw new FetchHtmlError(`Fetching ${currentUrl} failed with an invalid redirect.`, currentUrl, response.status);
        }
        currentUrl = new URL(location, currentUrl).toString();
        continue;
      }

      if (!response.ok) {
        throw new FetchHtmlError(`Fetching ${currentUrl} failed with HTTP ${response.status}.`, currentUrl, response.status);
      }

      const headers: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        headers[key.toLowerCase()] = value;
      });

      const reader = response.body?.getReader();
      if (!reader) {
        return { finalUrl: currentUrl, status: response.status, html: await response.text(), redirectChain, headers };
      }
      const chunks: Uint8Array[] = [];
      let received = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          received += value.byteLength;
          if (received > MAX_HTML_BYTES) {
            await reader.cancel();
            break;
          }
          chunks.push(value);
        }
      }
      const html = Buffer.concat(chunks.map((c) => Buffer.from(c))).toString("utf8");
      return { finalUrl: currentUrl, status: response.status, html, redirectChain, headers };
    }
    throw new FetchHtmlError("Too many redirects while fetching that URL.", url);
  } finally {
    clearTimeout(timeout);
  }
}

/** Convenience wrapper matching the original web-layer signature: HTML only. */
export async function fetchHtml(url: string): Promise<string> {
  const result = await fetchHtmlWithDetails(url);
  return result.html;
}
