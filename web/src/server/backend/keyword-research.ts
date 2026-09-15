import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createWebApprovalChannel } from "./approval";
import type { KeywordResearchResult } from "./types";

const here = path.dirname(fileURLToPath(import.meta.url));
const backendDist = path.resolve(here, "../../../../dist/src");

async function importBackend(relativeToSrc: string) {
  return import(/* webpackIgnore: true */ `file://${path.join(backendDist, relativeToSrc)}`);
}

let agentPromise: Promise<any> | null = null;

async function getAgent() {
  if (!agentPromise) {
    agentPromise = (async () => {
      const [{ KeywordResearchAgent }, { loadKeywordResearchAgentConfig }, { DataForSeoKeywordDataProvider }] = await Promise.all([
        importBackend("agents/keyword-research-agent/keyword-research-agent.js"),
        importBackend("agents/keyword-research-agent/config/keyword-research-agent.config.js"),
        // KEYWORD RESEARCH EXECUTION WIRING FIX (2026-09-08): this already-implemented, already-tested
        // provider (src/agents/keyword-research-agent/providers/dataforseo-keyword-data-provider.ts)
        // had zero callers anywhere in the app -- passing `undefined` below silently fell back to
        // KeywordResearchAgent.create()'s own default, NullKeywordDataProvider, so every real caller of
        // researchKeywords() (this file's own export, the dedicated /api/keywords/research route, and
        // the automatic content-generation pipeline's keyword-research stage) always got "no live
        // access to keyword-research tools" regardless of DataForSEO being configured. Mirrors
        // off-page-seo.ts's getDataForSeoBacklinkDataProvider() exactly: instantiated with no
        // constructor args, so it reads its own real DATAFORSEO_LOGIN/PASSWORD/SANDBOX credentials from
        // process.env itself. On any failure (no credentials, production blocked, API error), the
        // provider already returns `null` per keyword -- KeywordResearchAgent's own existing
        // anti-hallucination handling (metricsAvailable: false, a disclosed limitation) is unchanged.
        importBackend("agents/keyword-research-agent/providers/dataforseo-keyword-data-provider.js"),
      ]);
      const backendRoot = path.resolve(here, "../../../..");
      const config = loadKeywordResearchAgentConfig({ auditLogPath: path.join(backendRoot, "var", "web", "keyword-research-agent", "audit-log.jsonl") }, backendRoot);
      // A non-interactive channel is required here: the default
      // CliApprovalChannel reads process.stdin, which would hang a web
      // request forever if this agent's own policy-risk signal ever fires.
      return KeywordResearchAgent.create(config, new DataForSeoKeywordDataProvider(), createWebApprovalChannel());
    })();
  }
  return agentPromise;
}

// KEYWORD RESEARCH EXECUTION WIRING FIX (2026-09-08): a deterministic, no-LLM extraction of the ONE
// real, structured input researchKeywords() actually needs beyond a business-objective string: a
// specific topic/product/service to research, taken from the user's own words following a genuine
// keyword-research trigger phrase (the same phrase family tag-weighted-routing-strategy.ts's own
// hasKeywordResearchIntent() already routes on) plus "for/about/around/on". Deliberately conservative:
// a captured subject made up ENTIRELY of generic filler words ("business", "website", "SEO", etc. -- no
// real product/topic named) is treated as NOT reliably derived, per this fix's own "fail honestly and
// ask for the missing input rather than inventing keywords" requirement, rather than sending a
// near-meaningless string to the real provider as if it were a deliberate query. Used by
// workspace/messages/route.ts's dedicated keyword-research-agent branch.
//
// VERB-FIRST PHRASING CONSISTENCY FIX (2026-09-09): a real, live-confirmed defect -- "Research keywords
// for freelance SEO services targeting businesses in the USA." now correctly ROUTES to
// keyword-research-agent (score 1.00, see tag-weighted-routing-strategy.ts's own KEYWORD_RESEARCH_TOPIC_PHRASES
// verb-first entries), but the live agent still fell back to asking for a topic -- this extractor's OWN
// trigger-phrase group only recognized the noun-first forms ("keyword research", "keyword
// opportunities", ...) and was never updated when routing gained the mirror-image verb-first phrases
// ("research keywords", "find keywords", ...). The two trigger lists had silently drifted out of sync.
// This adds the SAME verb-first phrases routing already accepts, keeping the two definitions
// consistent -- the vague-subject/no-match honest-fallback behavior below is completely unchanged.
const KEYWORD_SUBJECT_PATTERN =
  /\b(?:keyword\s+research|keyword\s+opportunit(?:y|ies)|keyword\s+ideas?|target\s+keywords?|search\s+intent|search\s+terms?|(?:research|find|identify|discover|evaluate|analyze|analyse)\s+keywords?)\b.{0,40}?\b(?:for|about|around|on)\s+([a-z0-9][\w\s&'-]{1,80}?)(?:[.?!,]|\s+and\s+(?:tell|identify|analyze|analyse|recommend|find|discover|evaluate)\b|$)/i;
// TARGET-VS-KEYWORD FIX (2026-09-03, real, live-confirmed defect): a real live request for
// "keyword research for https://ommfreelancer-del.github.io/portfolio-website/" -- phrased by the user as
// "...for this target: https://..." -- sent DataForSEO the literal, non-existent search term "this target"
// and reported real (Sandbox-free, billed) volume/difficulty numbers FOR THAT LITERAL PHRASE. Root cause:
// the capture group above can only ever include letters/digits/spaces/&/'/- (never a URL's ":"/"//"), so
// once a URL appears after "for", the regex naturally stops capturing right where the URL starts and
// requires a terminator (one of .?!, or "and ..." or end-of-string) immediately after. A phrasing like
// "for this target: https://..." or "for this target, https://..." puts a real terminator (":"/","/".")
// right after the word "target" -- so the ONLY thing captured is "this target". The vague-word filter below
// already excludes "this"/"that" individually, but "target" was never in the set, so "this target" (not
// EVERY word vague) slipped through as if it were a real, deliberately-named topic. A URL is a TARGET
// WEBSITE, never a keyword/topic -- this agent has no capability to derive keywords from a domain/URL at
// all (KeywordResearchRequest only ever takes explicit seedKeywords strings), so when only target/URL
// language surrounds an actual link, there is no real topic to extract; the honest behavior is to return
// null here (extended vague-word coverage below) so the caller's own existing "please name a topic" fallback
// fires -- never silently sending target/URL-referring instructional words to DataForSEO as a search term.
const VAGUE_KEYWORD_SUBJECT_WORDS = new Set([
  "business", "businesses", "website", "websites", "site", "sites", "seo", "company", "companies",
  "brand", "brands", "it", "them", "this", "that", "growth", "traffic", "us",
  "target", "targets", "url", "urls", "link", "links", "domain", "domains", "page", "pages", "current",
]);

export function extractKeywordResearchSubject(text: string): string | null {
  const match = KEYWORD_SUBJECT_PATTERN.exec(text);
  if (!match) return null;
  let subject = match[1]!.trim().replace(/\s+/g, " ");
  subject = subject.replace(/^(?:our|my|your|the|a|an)\s+/i, "").trim();
  if (!subject) return null;
  const words = subject.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return null;
  // Every word is generic filler -- no real, specific topic was actually named.
  if (words.every((w) => VAGUE_KEYWORD_SUBJECT_WORDS.has(w) || w.length <= 2)) return null;
  return subject;
}

export async function researchKeywords(businessObjective: string, seedKeywords: readonly string[], targetAudience?: string): Promise<KeywordResearchResult> {
  const agent = await getAgent();
  return agent.researchKeywords({
    id: randomUUID(),
    businessObjective,
    seedKeywords,
    ...(targetAudience ? { targetAudience } : {}),
  });
}

/**
 * KEYWORD RESEARCH CHAT EXECUTION FIX (2026-09-08): builds a reply straight from a real
 * KeywordResearchResult -- no LLM, no fabrication, every number traceable to the real
 * DataForSeoKeywordDataProvider (or an honest "not available" disclosure when it returned nothing) --
 * mirroring website-audit.ts's own summarizeAuditForChat() convention exactly. Used by
 * workspace/messages/route.ts's dedicated keyword-research-agent branch.
 */
export function summarizeKeywordResearchForChat(subject: string, result: KeywordResearchResult): string {
  const lines: string[] = [`Ran real keyword research for "${subject}" through ADASOS's DataForSEO Keyword Research integration.`, ""];

  if (result.metricsAvailable) {
    lines.push("Real keyword metrics:");
    for (const k of result.classifiedKeywords) {
      lines.push(
        k.metrics
          ? `- "${k.keyword}": search volume ${k.metrics.searchVolume}/mo, difficulty ${k.metrics.difficulty}/100, intent: ${k.intent}.`
          : `- "${k.keyword}": intent ${k.intent} -- real search volume/difficulty were not available for this specific keyword.`,
      );
    }
  } else {
    lines.push(
      result.metricsProviderConfigured
        ? "No real search-volume or difficulty data is available right now -- DataForSEO Keyword Research is " +
            "configured, but the real API call did not return usable data for any keyword this run (see " +
            "Limitations below for the specific reason). I can still classify search intent and group topics, " +
            "but I will not state a search volume, difficulty, or competition number without it."
        : "No real search-volume or difficulty data is available right now -- DataForSEO Keyword Research isn't " +
            "configured. I can still classify search intent and group topics, but I will not state a search " +
            "volume, difficulty, or competition number without it.",
    );
  }

  if (result.topicClusters.length > 0) {
    lines.push("", "Topic clusters:");
    for (const cluster of result.topicClusters) {
      lines.push(`- ${cluster.label}: ${cluster.keywords.join(", ")}`);
    }
  }

  lines.push("", result.rankingDisclaimer);
  if (result.limitations.length > 0) {
    lines.push("", `Limitations: ${result.limitations.join(" ")}`);
  }

  return lines.join("\n");
}
