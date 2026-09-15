// PRODUCTION ROUTING FIX (2026-08-16): a real, live production failure --
// see task-router.ts's own header comment for exactly where this is wired
// in -- a clearly-stated guest-posting/prospect-discovery request ("Find 5
// real Health/Wellness guest-posting opportunities using live evidence, ...
// Use real DataForSEO search/page evidence only.") scored only 0.31 against
// the closest ordinary specialist (Website Audit Agent) under
// TagWeightedRoutingStrategy's keyword/tag overlap scoring -- well below
// the 0.50 auto-assign threshold -- and was then silently auto-resolved to
// that low-confidence match anyway by the web app's non-interactive
// approval channel (a SEPARATE defect, fixed in web/src/server/backend/
// approval.ts's own NEVER_AUTO_RESOLVE_REASONS). Even with that fix
// applied, a genuinely clear prospecting request deserves a confident,
// deterministic assignment -- not an escalation -- the same way an
// orchestration-authority or multi-SEO-workflow-stage request already
// bypasses ordinary scoring in task-router.ts (see classifyTaskIntent()'s
// own short-circuit there). This module is that deterministic gate for the
// Prospecting Agent specifically, now that it has a real, live,
// DataForSEO-backed discovery capability (see
// src/agents/prospecting-agent/providers/dataforseo-guest-post-discovery-provider.ts)
// worth routing to with confidence.
//
// Same discipline as task-intent-classifier.ts and capability-classifier.ts:
// deterministic, phrase-based substring matching against the task's real
// text -- no ML, no embeddings, every classification traceable to real
// matched text. Never a single bare keyword: "guest post" / "publisher" /
// "prospect" are all real vocabulary shared by OTHER agents later in the
// SAME guest-posting pipeline (Publisher Qualification, Contact
// Intelligence, Outreach, Reply & Negotiation, Guest Posting & Digital PR --
// see each of their own Agents/*.md files) -- a bare noun match would
// misroute THEIR genuine tasks to Prospecting instead. Two tiers:
//
// TIER 1 -- compound phrases specific enough to stand alone (drawn directly
// from this task's own required intent-family list: "guest posting
// opportunities", "prospect discovery", "outreach publisher discovery",
// etc.) -- verified against every other guest-posting-pipeline agent's own
// real Mission/Responsibilities/Tags/Capabilities text; none of these exact
// compounds appear there.
//
// TIER 2 -- a discovery-stage VERB (find/discover/identify/source/research/
// locate/qualify/...) paired with a NARROW domain noun restricted to the
// "guest post(ing)" and "link-building" families only -- deliberately
// EXCLUDES bare "publisher"/"prospect" as a standalone tier-2 noun, since
// pairing either with a common verb like "find" would false-positive on
// Contact Intelligence Agent's own real task shape ("Find public contact
// details for these approved publishers") or Publisher Qualification
// Agent's own ("Review and qualify these prospect websites"). Mirrors
// tag-weighted-routing-strategy.ts's hasContentAuthoringIntent VERB+NOUN
// discipline exactly.
//
// KNOWN, DELIBERATE OVERLAP: "Qualify guest-post prospects" is one of this
// task's own required routing examples and DOES route to Prospecting
// (matches the tier-1 "guest-post prospects" compound), even though a bare
// "qualify these prospects" (no guest-post/link-building noun present)
// does not match here at all, and continues to route via ordinary scoring
// -- which is Publisher Qualification Agent's own real domain. This is an
// explicit, disclosed precedence choice from this task's own routing
// requirements, not an oversight.

import { extractRequiredCapabilities } from "./capability-classifier.js";

/** See file header TIER 2. */
const DISCOVERY_STAGE_VERBS: readonly string[] = [
  "find",
  "discover",
  "identify",
  "source",
  "research",
  "locate",
  "search for",
  "look for",
  "build a list",
  "compile a list",
  "generate a list",
  "qualify",
];

/** See file header TIER 2 -- deliberately narrow: only the guest-post and link-building families, never bare "publisher"/"prospect". */
const NARROW_DOMAIN_NOUNS: readonly string[] = [
  "guest post",
  "guest posts",
  "guest posting",
  "guest-post",
  "guest-posts",
  "guest-posting",
  "guest blogging",
  "guest blog",
  "link-building",
  "link building",
  "linkbuilding",
];

/** See file header TIER 1 -- compound phrases specific enough to stand alone, taken directly from this task's own listed intent families. */
const PROSPECTING_PHRASES: readonly string[] = [
  "guest posting opportunities",
  "guest post opportunities",
  "guest-posting opportunities",
  "guest-post opportunities",
  "guest posting opportunity",
  "guest post opportunity",
  "guest blogging opportunities",
  "guest blog opportunities",
  "accepting guest posts",
  "accept guest posts",
  "accepts guest posts",
  "sites accepting guest posts",
  "guest post prospects",
  "guest-post prospects",
  "guest posting prospects",
  "guest-posting prospects",
  "prospect discovery",
  "prospecting discovery",
  "publisher prospects",
  "publisher discovery",
  "discover publishers",
  "outreach publisher discovery",
  "link-building prospects",
  "link building prospects",
  "guest-post publisher research",
  "guest post publisher research",
];

function includesAny(lower: string, phrases: readonly string[]): boolean {
  return phrases.some((phrase) => lower.includes(phrase));
}

// SUPPLIED-URL INVESTIGATION FEATURE (2026-09-08): a genuinely different real trigger from TIER 1/2 above
// -- a request to investigate ONE SPECIFIC, already-supplied URL (Prospecting Agent's new
// investigateUrl() capability -- see src/agents/prospecting-agent/processing/url-investigator.ts) rather
// than DISCOVER new candidates via search. A real, live-confirmed gap: "Prospect this website:
// https://example.com/write-for-us. Find their latest article and a contact email." matches neither
// TIER 1 (no guest-post/link-building compound phrase) nor TIER 2 (a discovery verb IS present ("find"),
// but no narrow guest-post/link-building noun is) -- so it fell through to ordinary specialist scoring
// and was hijacked by seo-content-agent (the supplied URL's OWN path segment "write-for-us" tokenizes to
// a bare "write", which coincidentally matches content-authoring vocabulary under plain keyword overlap).
// Requires a real URL/domain (mirrors tag-weighted-routing-strategy.ts's own hasUrlOrDomain() exactly)
// PLUS an explicit "investigate/prospect/research/qualify THIS site" phrase, or a "find the latest
// article" phrase specific to this new capability -- never a bare URL alone, which could belong to any
// number of other real specialists (e.g. website-audit-agent).
const URL_PATTERN = /https?:\/\/[^\s)>\]"']+/i;
// Same conservative shape as tag-weighted-routing-strategy.ts's own BARE_DOMAIN_PATTERN.
const BARE_DOMAIN_PATTERN = /\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.){1,}[a-z]{2,}\b/i;

function hasUrlOrDomain(taskDescription: string): boolean {
  return URL_PATTERN.test(taskDescription) || BARE_DOMAIN_PATTERN.test(taskDescription);
}

const URL_INVESTIGATION_PHRASES: readonly string[] = [
  "prospect this website",
  "prospect this site",
  "prospect this url",
  "investigate this website",
  "investigate this site",
  "investigate this url",
  "investigate the following url",
  "research this website for guest",
  "research this site for guest",
  "check this website for guest",
  "check this site for guest",
  "check if they accept guest posts",
  "check if this site accepts guest posts",
  "check if this website accepts guest posts",
  "qualify this website",
  "qualify this site",
  "find their latest article",
  "find the latest article",
  "find their most recent article",
  "find the most recent article",
];

/** See this file's own SUPPLIED-URL INVESTIGATION header above -- a real URL/domain paired with an explicit investigate-THIS-site phrase, never a bare URL alone. */
function hasUrlInvestigationIntent(taskDescription: string): boolean {
  if (!hasUrlOrDomain(taskDescription)) return false;
  const lower = ` ${taskDescription.toLowerCase()} `;
  return includesAny(lower, URL_INVESTIGATION_PHRASES);
}

// TIER 2 FALSE-POSITIVE GUARD (found during this task's own real regression
// run, tests/boss-agent/routing/capability-gating.integration.test.ts's
// existing "Find commercial and informational keywords for a health
// guest-post campaign." case): a bare verb+noun co-occurrence check alone
// cannot tell "find [X] for a ... guest-post campaign" (a genuine keyword-
// research request that merely NAMES a guest-post campaign as its PURPOSE)
// from "discover new websites that match our guest posting campaign
// requirements" (an actual discovery request) -- word-distance between the
// verb and the noun turned out NOT to reliably distinguish the two either
// (both land at a similar word-gap in real phrasing). The real,
// unambiguous signal in both observed false-positive cases is the literal
// word "keyword(s)" -- checked directly (broader and more reliable here
// than capability-classifier.ts's own narrower, exact-phrase "keyword-
// research" trigger list, which a real variant, "commercial-intent
// keywords", does not happen to match at all) -- combined with reusing
// extractRequiredCapabilities()'s own "keyword-research" signal for the
// cases it DOES cover, rather than replacing it outright. TIER 1's compound
// phrases are unaffected -- they are specific enough on their own that
// this ambiguity does not arise for them.
function hasCompetingKeywordResearchSignal(taskDescription: string): boolean {
  const lower = taskDescription.toLowerCase();
  if (lower.includes("keyword")) {
    return true;
  }
  return extractRequiredCapabilities(taskDescription).has("keyword-research");
}

/**
 * True when `taskDescription` clearly asks for guest-posting/publisher
 * prospect DISCOVERY -- Prospecting Agent's own real capability -- via
 * either a specific-enough standalone compound phrase, or a discovery-stage
 * verb paired with a narrow guest-post/link-building noun (and no competing
 * keyword-research signal in the same message -- see the guard above). See
 * file header for why a bare single keyword is never enough.
 */
export function isProspectingIntent(taskDescription: string): boolean {
  const lower = ` ${taskDescription.toLowerCase()} `;

  if (includesAny(lower, PROSPECTING_PHRASES)) {
    return true;
  }

  if (hasUrlInvestigationIntent(taskDescription)) {
    return true;
  }

  const hasDiscoveryVerb = includesAny(lower, DISCOVERY_STAGE_VERBS);
  const hasNarrowDomainNoun = includesAny(lower, NARROW_DOMAIN_NOUNS);
  if (!hasDiscoveryVerb || !hasNarrowDomainNoun) {
    return false;
  }
  return !hasCompetingKeywordResearchSignal(taskDescription);
}
