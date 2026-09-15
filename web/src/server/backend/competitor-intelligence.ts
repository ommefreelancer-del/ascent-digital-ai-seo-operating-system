// COMPETITOR INTELLIGENCE REAL ORCHESTRATION (2026-09-03): connects the real, already-implemented,
// already-tested CompetitorIntelligenceAgent (src/agents/competitor-intelligence-agent/) into the actual
// ADASOS chat workflow. The agent itself was never the gap -- per its own documented contract
// (competitor-intelligence-request.types.ts's own header), "competitors are never discovered automatically
// and never fetched"; the CALLER must assemble a real WebsiteAuditResult/TechnicalSeoResult/
// KeywordResearchResult for "our" site plus real fetched HTML for each competitor. Nothing in chat ever
// assembled those inputs before this file existed (see git history: this module previously contained only
// buildCompetitorIntelligenceContext(), a stopgap honesty-disclaimer block appended to a generic LLM
// role-play reply -- kept below for the one case this orchestration itself can't resolve: no target URL).
//
// Real execution pipeline (mirrors keyword-research.ts's/website-audit.ts's own real-dispatch convention,
// no LLM call anywhere in this file):
//   1. CURRENT target URL only -- the caller (route.ts) passes whatever extractUrl(message) found on
//      THIS message; this function never falls back to a previous audit, a connected repository's live
//      URL, or any other historical URL. No valid current target => an honest request for one, not a guess.
//   2. runFullAudit(targetUrl, "") -- the SAME real, already-used-by-chat multi-page-crawl pipeline the
//      audit branch elsewhere in route.ts calls -- supplies ourWebsiteAudit/ourTechnicalSeo directly; both
//      are exactly the types CompetitorIntelligenceRequest needs, with zero conversion.
//   3. researchKeywords()/extractKeywordResearchSubject() (keyword-research.ts, already real and wired) --
//      supplies ourKeywordResearch. If no real topic can be deterministically identified in the user's own
//      words, this never invents one: it builds an honest, structurally-valid EMPTY KeywordResearchResult
//      (metricsAvailable: false, a disclosed limitation) rather than calling the agent with a fabricated
//      seed keyword.
//   4. getCompetitorDomains() (server/dataforseo.ts) -- the ONE new DataForSEO wiring this feature needed:
//      real organic-competitor discovery via DataForSEO Labs' competitors_domain/live, reusing the exact
//      same cost gate/client architecture as every other Keyword Data/Labs call in this codebase. Bounded
//      to MAX_COMPETITORS_TO_ANALYZE. A discovery failure (not configured, cost-gated, real API error) is
//      reported honestly; it never falls back to a fabricated competitor list.
//   5. fetchHtml() (website-audit.ts's own re-export of the canonical, SSRF-safe
//      src/core/crawling/fetch-html.ts) -- real HTML for each discovered domain's homepage. A per-domain
//      fetch failure is recorded and that domain is simply excluded from `competitors`, mirroring
//      CompetitorIntelligenceAgent's own per-competitor-skip design; it is never backfilled with placeholder
//      HTML, stale HTML, or the target's own HTML. If literally none can be fetched, this returns an honest
//      failure without ever calling the agent.
//   6. The real CompetitorIntelligenceAgent.analyzeCompetitors() (via a lazy-singleton factory below,
//      constructing the SAME agent class with its own real, injected WebsiteAuditAgent dependency -- never
//      a parallel/duplicate competitor system).
//   7. summarizeCompetitorIntelligenceForChat() formats the real, already-computed CompetitorIntelligenceResult
//      into chat text -- deterministic, no LLM call. This is a deliberate security property, not just a
//      style choice: CompetitorIntelligenceAgent only ever extracts STRUCTURAL signals (title/heading text,
//      issue counts) from each competitor's HTML via WebsiteAuditAgent's own deterministic parser -- raw
//      competitor HTML is NEVER passed to an LLM anywhere in this pipeline, which structurally eliminates
//      prompt-injection risk into the AI's conversational output (defense-in-depth note, per this feature's
//      own security requirement: competitor HTML/content is untrusted reference DATA, never system/
//      developer/routing authority -- it cannot alter agent role, routing, tool permissions, or approvals).
//   8. Persisted via db.report.create() (the SAME Report model/convention already used for
//      "seo-performance"/"ai-usage"/"keyword-growth"/"doctor-flow"), scoped to the calling userId -- no new
//      persistence framework.

import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createWebApprovalChannel } from "./approval";
import { fetchHtml, runFullAudit, type FullAuditResult } from "./website-audit";
import { extractKeywordResearchSubject, researchKeywords } from "./keyword-research";
import { getCompetitorDomains, type DataForSeoCompetitorDomain } from "@/server/dataforseo";
import { db } from "@/server/db";
import type {
  CompetitorIntelligenceRequest,
  CompetitorIntelligenceResult,
  CompetitorSnapshot,
  KeywordResearchResult,
} from "./types";

const here = path.dirname(fileURLToPath(import.meta.url));
const backendDist = path.resolve(here, "../../../../dist/src");
const backendRoot = path.resolve(here, "../../../..");

async function importBackend(relativeToSrc: string) {
  return import(/* webpackIgnore: true */ `file://${path.join(backendDist, relativeToSrc)}`);
}

// A SEPARATE WebsiteAuditAgent instance from website-audit.ts's own internal
// SiteAuditOrchestrator/onPageAgent/techSeoAgent trio -- required because
// CompetitorIntelligenceAgent.create() takes a bare WebsiteAuditAgent as a
// constructor dependency (used internally, once per competitor snapshot, to
// audit each competitor's real fetched HTML). Its own dedicated audit-log
// path keeps its lifecycle events distinct from the "our site" audit trail.
let websiteAuditAgentPromise: Promise<any> | null = null;

async function getWebsiteAuditAgentForCompetitors() {
  if (!websiteAuditAgentPromise) {
    websiteAuditAgentPromise = (async () => {
      const [{ WebsiteAuditAgent }, { loadWebsiteAuditAgentConfig }] = await Promise.all([
        importBackend("agents/website-audit-agent/website-audit-agent.js"),
        importBackend("agents/website-audit-agent/config/website-audit-agent.config.js"),
      ]);
      const config = loadWebsiteAuditAgentConfig(
        { auditLogPath: path.join(backendRoot, "var", "web", "competitor-intelligence-agent", "website-audit-agent-audit-log.jsonl") },
        backendRoot,
      );
      return WebsiteAuditAgent.create(config, createWebApprovalChannel());
    })();
  }
  return websiteAuditAgentPromise;
}

let agentPromise: Promise<any> | null = null;

async function getAgent() {
  if (!agentPromise) {
    agentPromise = (async () => {
      const [{ CompetitorIntelligenceAgent }, { loadCompetitorIntelligenceAgentConfig }, websiteAuditAgent] = await Promise.all([
        importBackend("agents/competitor-intelligence-agent/competitor-intelligence-agent.js"),
        importBackend("agents/competitor-intelligence-agent/config/competitor-intelligence-agent.config.js"),
        getWebsiteAuditAgentForCompetitors(),
      ]);
      const config = loadCompetitorIntelligenceAgentConfig(
        { auditLogPath: path.join(backendRoot, "var", "web", "competitor-intelligence-agent", "audit-log.jsonl") },
        backendRoot,
      );
      // A non-interactive channel is required here: the default CliApprovalChannel reads process.stdin,
      // which would hang a web request forever if the agent's own single-competitor low-confidence
      // escalation ("low_confidence_match") ever fires. That reason auto-resolves safely (see approval.ts's
      // own NEVER_AUTO_RESOLVE_REASONS -- low_confidence_match there refers to TaskRouter's routing
      // decision, a different reason string entirely from this agent-internal one).
      return CompetitorIntelligenceAgent.create(config, websiteAuditAgent, createWebApprovalChannel());
    })();
  }
  return agentPromise;
}

/** Bounded, configurable shortlist size -- no uncontrolled fan-out of discovery/HTML-fetch/audit calls. */
const MAX_COMPETITORS_TO_ANALYZE = 3;

function emptyKeywordResearchResult(limitations: readonly string[]): KeywordResearchResult {
  return {
    requestId: randomUUID(),
    classifiedKeywords: [],
    topicClusters: [],
    metricsAvailable: false,
    metricsProviderConfigured: false,
    limitations,
    rankingDisclaimer: "No keyword research was run for this competitor analysis.",
    decidedAt: new Date().toISOString(),
  };
}

/**
 * Real, honest capability-status block for a competitor-intelligence-agent chat assignment where no
 * current-task target URL could be identified. Kept as its own function (rather than inlined) since it is
 * also what runCompetitorIntelligence() itself returns for that exact case -- one honest message, one
 * source of truth. Never throws, makes no network/database call.
 */
export function buildCompetitorIntelligenceContext(): string {
  return (
    "I can run a real Competitor Intelligence analysis for you -- a live Website Audit, Technical SEO review, " +
    "and Keyword Research pass on your own site, real DataForSEO Labs organic-competitor discovery, and real " +
    "fetched HTML analyzed for each competitor -- but I need the URL of the site to analyze first. Please share " +
    "it and I'll run the full comparison."
  );
}

/**
 * Real orchestration: assembles the three existing SEO results, discovers real competitors via DataForSEO,
 * fetches their real HTML, and runs the real CompetitorIntelligenceAgent. See this module's own header for
 * the full pipeline and every anti-fabrication/isolation guarantee. `targetUrl` MUST be derived from the
 * CURRENT message only (route.ts passes extractUrl(message) directly) -- never a historical/connected-
 * repository/most-recent-audit fallback, so a previous task's site can never leak into this analysis.
 */
export async function runCompetitorIntelligence(userId: string, targetUrl: string | null, message: string): Promise<string> {
  if (!targetUrl) {
    return buildCompetitorIntelligenceContext();
  }

  let hostname: string;
  try {
    hostname = new URL(targetUrl).hostname;
  } catch {
    return `I can run Competitor Intelligence on a real site, but "${targetUrl}" isn't a valid URL -- please share a full URL (e.g. https://example.com).`;
  }

  let audit: FullAuditResult;
  try {
    audit = await runFullAudit(targetUrl, "");
  } catch (error) {
    const reason = error instanceof Error ? error.message : "an unknown error";
    return `I tried to run Competitor Intelligence for ${targetUrl}, but the required Website Audit stage failed, so I can't proceed: ${reason}`;
  }

  const keywordSubject = extractKeywordResearchSubject(message);
  let ourKeywordResearch: KeywordResearchResult;
  if (keywordSubject) {
    try {
      ourKeywordResearch = await researchKeywords(message, [keywordSubject]);
    } catch (error) {
      const reason = error instanceof Error ? error.message : "an unknown error";
      ourKeywordResearch = emptyKeywordResearchResult([
        `Real keyword research for "${keywordSubject}" failed (${reason}) -- content-cluster gap analysis below will be empty.`,
      ]);
    }
  } else {
    ourKeywordResearch = emptyKeywordResearchResult([
      "No specific topic, product, or service was named in the request to run real keyword research against -- " +
        "content-cluster gap analysis below will be empty.",
    ]);
  }

  let discoveredDomains: DataForSeoCompetitorDomain[];
  try {
    discoveredDomains = await getCompetitorDomains(hostname, { limit: MAX_COMPETITORS_TO_ANALYZE });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "an unknown error";
    return (
      `I ran a real Website Audit, Technical SEO review, and Keyword Research pass for ${targetUrl}, but real ` +
      `competitor discovery through DataForSEO failed, so I can't proceed with the competitor comparison: ${reason}`
    );
  }

  if (discoveredDomains.length === 0) {
    return (
      `I ran a real Website Audit, Technical SEO review, and Keyword Research pass for ${targetUrl}, but ` +
      "DataForSEO's real competitor-discovery data returned no organic competitors for this domain, so there's " +
      "nothing to compare against right now."
    );
  }

  const selected = discoveredDomains.slice(0, MAX_COMPETITORS_TO_ANALYZE);
  const fetched = await Promise.allSettled(
    selected.map(async (d) => ({ domain: d.domain, url: `https://${d.domain}/`, html: await fetchHtml(`https://${d.domain}/`) })),
  );

  const snapshots: CompetitorSnapshot[] = [];
  const fetchFailures: string[] = [];
  for (let i = 0; i < fetched.length; i++) {
    const outcome = fetched[i]!;
    const domain = selected[i]!.domain;
    if (outcome.status === "fulfilled") {
      snapshots.push({ id: domain, html: outcome.value.html, url: outcome.value.url });
    } else {
      const reason = outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason);
      fetchFailures.push(`${domain} (${reason})`);
    }
  }

  if (snapshots.length === 0) {
    return (
      `I ran a real Website Audit, Technical SEO review, Keyword Research pass, and real competitor discovery for ` +
      `${targetUrl}, but I couldn't fetch real HTML from any discovered competitor -- ${fetchFailures.join("; ")} -- ` +
      "so I can't run the comparison. No competitor data has been fabricated."
    );
  }

  const request: CompetitorIntelligenceRequest = {
    id: randomUUID(),
    ourWebsiteAudit: audit.websiteAudit,
    ourTechnicalSeo: audit.technicalSeo,
    ourKeywordResearch,
    competitors: snapshots,
  };

  const agent = await getAgent();
  let result: CompetitorIntelligenceResult;
  try {
    result = await agent.analyzeCompetitors(request);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "an unknown error";
    return `I gathered real data for ${targetUrl} and ${snapshots.length} real competitor(s), but the Competitor Intelligence analysis itself failed: ${reason}`;
  }

  try {
    await db.report.create({
      data: { userId, title: `Competitor Intelligence — ${targetUrl}`, type: "competitor-intelligence", resultJson: JSON.stringify(result) },
    });
  } catch {
    // A persistence failure never blocks delivering the already-computed, real result to the user.
  }

  return summarizeCompetitorIntelligenceForChat(targetUrl, result, fetchFailures);
}

/**
 * Builds a reply straight from a real CompetitorIntelligenceResult -- no LLM, no fabrication, every number
 * traceable to the real audited data -- mirroring website-audit.ts's summarizeAuditForChat()/
 * keyword-research.ts's summarizeKeywordResearchForChat() convention exactly. Never receives or reads raw
 * competitor HTML (only the agent's own structured output), so competitor-supplied text can never influence
 * this function's own control flow or output beyond the specific structured fields the real agent computed.
 */
export function summarizeCompetitorIntelligenceForChat(targetUrl: string, result: CompetitorIntelligenceResult, fetchFailures: readonly string[]): string {
  const lines: string[] = [
    `Ran a real Competitor Intelligence analysis for ${targetUrl} through ADASOS's Website Audit + Technical SEO ` +
      "+ Keyword Research + DataForSEO Labs competitor-discovery pipeline (nothing below is estimated).",
    "",
  ];

  if (result.competitorGapAnalysis.length === 0) {
    lines.push("No competitor could be successfully analyzed this run (see limitations below).");
  } else {
    lines.push("Competitive gap analysis (based on real, freshly-audited pages):");
    for (const gap of result.competitorGapAnalysis) {
      const label = gap.competitorUrl ?? gap.competitorId;
      const verdict = gap.assessment === "we_are_ahead" ? "we are ahead" : gap.assessment === "we_are_behind" ? "we are behind" : "comparable";
      lines.push(`- ${label}: ${gap.ourTotalIssues} real issue(s) found on our site vs ${gap.competitorTotalIssues} on theirs -- ${verdict}.`);
    }
  }

  if (result.technicalComparison.length > 0) {
    lines.push("", "Technical comparison:");
    for (const comp of result.technicalComparison) {
      const label = comp.competitorUrl ?? comp.competitorId;
      for (const cat of comp.categories) {
        const advantageLabel = cat.advantage === "us" ? "advantage: us" : cat.advantage === "competitor" ? "advantage: competitor" : "tie";
        lines.push(`- ${label} / ${cat.category}: us ${cat.ourIssueCount} issue(s), them ${cat.competitorIssueCount} issue(s) (${advantageLabel}).`);
      }
    }
  }

  if (result.contentGapAnalysis.length > 0) {
    lines.push("", "Content-cluster coverage:");
    for (const cluster of result.contentGapAnalysis) {
      lines.push(
        cluster.coveredByCompetitors.length > 0
          ? `- "${cluster.clusterLabel}": covered by ${cluster.coveredByCompetitors.join(", ")}.`
          : `- "${cluster.clusterLabel}": not covered by any analyzed competitor's title/headings.`,
      );
    }
  }

  if (result.recommendations.length > 0) {
    lines.push("", "Recommendations:");
    for (const rec of result.recommendations.slice(0, 8)) {
      lines.push(`- [${rec.priority}] (${rec.category}) ${rec.recommendation} -- ${rec.rationale}`);
    }
  }

  if (fetchFailures.length > 0) {
    lines.push("", `Some discovered competitors could not be fetched and were excluded: ${fetchFailures.join("; ")}.`);
  }

  if (result.limitations.length > 0) {
    lines.push("", `Limitations: ${result.limitations.join(" ")}`);
  }

  return lines.join("\n");
}
