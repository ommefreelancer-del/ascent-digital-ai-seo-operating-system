// Provider-selection wiring for the Off-Page SEO Agent's real backlink data
// source, following the exact same convention as every other real-provider
// connection in this adapter layer (see getLighthouseProvider() in
// ./website-audit.ts and ./reporting.ts): a lazy-singleton factory that
// dynamically imports the compiled, frozen backend class from ../../../../dist
// and instantiates it with no constructor args, so it reads its own real
// credentials (DATAFORSEO_LOGIN/DATAFORSEO_PASSWORD/DATAFORSEO_SANDBOX) from
// process.env exactly as documented in src/agents/off-page-seo-agent/providers/
// dataforseo-backlink-data-provider.ts.
//
// This intentionally does NOT construct or call the full OffPageSeoAgent
// class itself -- that agent's real developOffPageStrategy() requires a
// complete CompetitorIntelligenceResult and WebsiteAuditResult as input,
// neither of which chat currently gathers for a bare off-page-seo-agent
// request, and building that multi-agent pipeline is a separate feature
// this fix wasn't asked to add. Instead, getBacklinkProfile() makes the
// already-implemented, already-tested DataForSeoBacklinkDataProvider
// reachable through this app's established dependency-injection convention
// (explicit opt-in: if DATAFORSEO_LOGIN/PASSWORD aren't configured, the
// provider itself returns null, never fabricated data), and
// buildOffPageSeoContext() (STEP 3 WIRING FIX, 2026-08-21) bridges that real
// data into the chat path -- the same real-data-grounding convention
// performance-analytics.ts's buildSearchConsoleContext() already
// established for Performance & Analytics Agent, reused here rather than
// duplicated.

import path from "node:path";
import { fileURLToPath } from "node:url";
import type { BacklinkProfile } from "./types";

const here = path.dirname(fileURLToPath(import.meta.url));
const backendDist = path.resolve(here, "../../../../dist/src");

async function importBackend(relativeToSrc: string) {
  return import(/* webpackIgnore: true */ `file://${path.join(backendDist, relativeToSrc)}`);
}

let providerPromise: Promise<{ provider: { fetchBacklinkProfile(request: { url: string }): Promise<BacklinkProfile | null> } }> | null = null;

async function getDataForSeoBacklinkDataProvider() {
  if (!providerPromise) {
    providerPromise = (async () => {
      const { DataForSeoBacklinkDataProvider } = await importBackend(
        "agents/off-page-seo-agent/providers/dataforseo-backlink-data-provider.js",
      );
      return { provider: new DataForSeoBacklinkDataProvider() };
    })();
  }
  return providerPromise;
}

/**
 * Real backlink profile for `url` via the DataForSEO Backlinks API, using
 * whatever DATAFORSEO_LOGIN/DATAFORSEO_PASSWORD/DATAFORSEO_SANDBOX are
 * currently configured. Returns `null` -- never a fabricated profile -- when
 * credentials aren't configured, the target has no data, or the real API
 * call fails for any reason.
 */
export async function getBacklinkProfile(url: string): Promise<BacklinkProfile | null> {
  const { provider } = await getDataForSeoBacklinkDataProvider();
  return provider.fetchBacklinkProfile({ url });
}

/**
 * STEP 3 WIRING FIX (2026-08-21): bridges the Off-Page SEO Agent to the real
 * backlink data above -- the same grounding-context convention
 * performance-analytics.ts's buildSearchConsoleContext() already established
 * (real data appended to the message before it reaches generateSpecialistReply,
 * never a replacement for the specialist's own reasoning). Before this,
 * nothing in the chat path ever called getBacklinkProfile() at all, so an
 * "off-page-seo-agent" assignment fell straight through to a bare LLM
 * role-play with no real backlink data to ground it. Never throws -- a
 * failure at any stage becomes a plainly-stated status, not a crashed
 * request. Never fabricates a domain authority score, referring-domain
 * count, or toxicity verdict when real data isn't available.
 */
export async function buildOffPageSeoContext(url: string | null): Promise<string> {
  if (!url) {
    return "[Off-page SEO / backlink data status: NO URL IDENTIFIED IN THIS REQUEST. Ask the user which site's backlink profile to analyze before making any off-page recommendations -- never invent a domain authority score, referring-domain count, or toxicity flag without one.]";
  }

  let profile: BacklinkProfile | null;
  try {
    profile = await getBacklinkProfile(url);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "an unknown error";
    return `[Off-page SEO / backlink data status: a real call to the configured backlink data provider for ${url} failed: ${reason}. State this plainly to the user -- do not guess at backlink metrics.]`;
  }

  if (!profile) {
    return (
      `[Off-page SEO / backlink data status: NOT AVAILABLE for ${url}. Either no backlink data provider is ` +
      "configured (DATAFORSEO_LOGIN/DATAFORSEO_PASSWORD not set), or the real API call returned no data for " +
      "this target. Tell the user real domain authority, referring-domain counts, and toxicity flags are " +
      "unavailable right now -- never invent them. You may still offer general off-page SEO best-practice guidance.]"
    );
  }

  const topDomains = profile.referringDomains
    .slice()
    .sort((a, b) => b.domainAuthority - a.domainAuthority)
    .slice(0, 10)
    .map((d) => `  - ${d.domain} (authority ${d.domainAuthority}, ${d.linkType}${d.spamScore !== null ? `, spam score ${d.spamScore}` : ""})`)
    .join("\n");

  return [
    `[Off-page SEO / backlink data status: REAL DATA retrieved for ${url} via the "${profile.source}" provider (retrieved ${profile.retrievedAt}).`,
    `Domain authority: ${profile.domainAuthority}. Total referring domains: ${profile.totalReferringDomains}` +
      (profile.previousTotalReferringDomains !== null ? ` (previous measurement: ${profile.previousTotalReferringDomains}).` : " (no prior measurement available)."),
    profile.referringDomains.length > 0 ? `Top referring domains by authority:\n${topDomains}` : "No individual referring-domain detail was returned.",
    "This provider reports a raw spam-risk score per referring domain but does not return a certified toxic/not-toxic verdict -- treat spamScore as a manual-review signal, never a confirmed toxicity verdict.",
    "Use these real numbers directly in your answer. Never invent additional backlinks, domain authority figures, or toxicity verdicts beyond what's listed here.]",
  ].join("\n");
}
