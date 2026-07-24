import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CompetitorIntelligenceAgent } from "../../../src/agents/competitor-intelligence-agent/competitor-intelligence-agent.js";
import { CompetitorIntelligenceRequestValidator } from "../../../src/agents/competitor-intelligence-agent/validation/competitor-intelligence-request-validator.js";
import { CompetitorOverallGapBuilder } from "../../../src/agents/competitor-intelligence-agent/analysis/competitor-overall-gap-builder.js";
import { TechnicalComparisonBuilder } from "../../../src/agents/competitor-intelligence-agent/analysis/technical-comparison-builder.js";
import { ContentClusterCoverageBuilder } from "../../../src/agents/competitor-intelligence-agent/analysis/content-cluster-coverage-builder.js";
import { CompetitorRecommendationBuilder } from "../../../src/agents/competitor-intelligence-agent/analysis/competitor-recommendation-builder.js";
import { WebsiteAuditAgent } from "../../../src/agents/website-audit-agent/website-audit-agent.js";
import { WebsiteAuditRequestValidator } from "../../../src/agents/website-audit-agent/validation/website-audit-request-validator.js";
import { CrawlabilityChecker } from "../../../src/agents/website-audit-agent/checks/crawlability-checker.js";
import { MetadataChecker } from "../../../src/agents/website-audit-agent/checks/metadata-checker.js";
import { HeadingStructureChecker } from "../../../src/agents/website-audit-agent/checks/heading-structure-checker.js";
import { CanonicalChecker } from "../../../src/agents/website-audit-agent/checks/canonical-checker.js";
import { RobotsTxtChecker } from "../../../src/agents/website-audit-agent/checks/robots-txt-checker.js";
import { InternalLinkChecker } from "../../../src/agents/website-audit-agent/checks/internal-link-checker.js";
import { ImageAltChecker } from "../../../src/agents/website-audit-agent/checks/image-alt-checker.js";
import { PageStructureChecker } from "../../../src/agents/website-audit-agent/checks/page-structure-checker.js";
import { TechnicalSeoChecker } from "../../../src/agents/website-audit-agent/checks/technical-seo-checker.js";
import { AuditLogger } from "../../../src/core/governance/audit-logger.js";
import type { ApprovalChannel } from "../../../src/core/governance/approval-channel.js";
import type { ApprovalDecision } from "../../../src/core/types/approval.types.js";
import type {
  CompetitorIntelligenceRequest,
  CompetitorSnapshot,
} from "../../../src/agents/competitor-intelligence-agent/types/competitor-intelligence-request.types.js";
import type { WebsiteAuditResult } from "../../../src/agents/website-audit-agent/types/website-audit-request.types.js";
import type { TechnicalSeoResult } from "../../../src/agents/technical-seo-agent/types/technical-seo-request.types.js";
import type { KeywordResearchResult } from "../../../src/agents/keyword-research-agent/types/keyword-request.types.js";

const OUR_GOOD_PAGE = `<!DOCTYPE html>
<html lang="en">
<head>
  <title>A Complete Guide to Local Plumbing Services</title>
  <meta name="description" content="Everything you need to know about hiring a reliable local plumber for repairs and installations.">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="canonical" href="https://oursite.com/plumbing">
</head>
<body>
  <h1>Local Plumbing Services</h1>
  <a href="/contact">Contact</a>
  <img src="/a.jpg" alt="A plumber at work">
</body>
</html>`;

function makeApprovalChannel(decision: ApprovalDecision): ApprovalChannel {
  return { requestDecision: async () => decision };
}

const REJECTING_DECISION: ApprovalDecision = {
  requestId: "unused",
  outcome: "rejected",
  notes: "should not be called",
  decidedAt: new Date().toISOString(),
};

function makeOurTechnicalSeo(): TechnicalSeoResult {
  return {
    requestId: "ts-1",
    url: "https://oursite.com/plumbing",
    // Matches the "http://" critical finding makeOurWebsiteAudit() reports below.
    recommendations: [
      {
        category: "https",
        priority: "high",
        recommendation: "Migrate to HTTPS.",
        rationale: "x",
        confirmedByCrossFunctionalNote: false,
      },
    ],
    limitations: ["Technical SEO limitation."],
    decidedAt: new Date().toISOString(),
  };
}

function makeOurKeywordResearch(): KeywordResearchResult {
  return {
    requestId: "kw-1",
    classifiedKeywords: [{ keyword: "plumber", intent: "informational", intentRationale: "x", metrics: null }],
    topicClusters: [{ label: "plumber", keywords: ["plumber", "emergency plumber"] }],
    metricsAvailable: false,
    limitations: ["Keyword research limitation."],
    rankingDisclaimer: "No guarantee.",
    decidedAt: new Date().toISOString(),
  };
}

describe("CompetitorIntelligenceAgent", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "competitor-intelligence-agent-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  function buildWebsiteAuditAgent(approvalDecision: ApprovalDecision): WebsiteAuditAgent {
    return new WebsiteAuditAgent(
      new WebsiteAuditRequestValidator(),
      [
        new CrawlabilityChecker(),
        new MetadataChecker(),
        new HeadingStructureChecker(),
        new CanonicalChecker(),
        new RobotsTxtChecker(),
        new InternalLinkChecker(),
        new ImageAltChecker(),
        new PageStructureChecker(),
        new TechnicalSeoChecker(),
      ],
      makeApprovalChannel(approvalDecision),
      new AuditLogger(join(dir, "website-audit-log.jsonl")),
    );
  }

  function buildAgent(
    ourApprovalDecision: ApprovalDecision,
    websiteAuditAgent: WebsiteAuditAgent = buildWebsiteAuditAgent(REJECTING_DECISION),
  ) {
    const auditLogPath = join(dir, "audit-log.jsonl");
    const agent = new CompetitorIntelligenceAgent(
      new CompetitorIntelligenceRequestValidator(),
      websiteAuditAgent,
      new CompetitorOverallGapBuilder(),
      new TechnicalComparisonBuilder(),
      new ContentClusterCoverageBuilder(),
      new CompetitorRecommendationBuilder(),
      makeApprovalChannel(ourApprovalDecision),
      new AuditLogger(auditLogPath),
    );
    return { agent, auditLogPath };
  }

  function makeOurWebsiteAudit(): WebsiteAuditResult {
    return {
      requestId: "wa-1",
      url: "https://oursite.com/plumbing",
      findings: [
        { category: "technical-seo", severity: "critical", message: 'Uses "http://".', recommendation: "x" },
      ],
      summary: { criticalCount: 1, warningCount: 0, infoCount: 0 },
      limitations: ["Website audit limitation."],
      decidedAt: new Date().toISOString(),
    };
  }

  function makeRequest(competitors: CompetitorSnapshot[]): CompetitorIntelligenceRequest {
    return {
      id: "req-1",
      ourWebsiteAudit: makeOurWebsiteAudit(),
      ourTechnicalSeo: makeOurTechnicalSeo(),
      ourKeywordResearch: makeOurKeywordResearch(),
      competitors,
    };
  }

  async function readEventTypes(auditLogPath: string): Promise<string[]> {
    const lines = (await readFile(auditLogPath, "utf8")).trim().split("\n");
    return lines.map((line) => JSON.parse(line).eventType);
  }

  it("produces a full comparison across two real, freshly-audited competitors", async () => {
    const { agent, auditLogPath } = buildAgent(REJECTING_DECISION);

    const result = await agent.analyzeCompetitors(
      makeRequest([
        { id: "competitor-a", html: OUR_GOOD_PAGE, url: "https://competitor-a.com/plumbing" },
        { id: "competitor-b", html: OUR_GOOD_PAGE, url: "https://competitor-b.com/plumbing" },
      ]),
    );

    expect(result.competitorGapAnalysis).toHaveLength(2);
    expect(result.technicalComparison).toHaveLength(2);
    expect(result.contentGapAnalysis).toHaveLength(1);
    expect(result.limitations).toEqual(
      expect.arrayContaining([
        "Website audit limitation.",
        "Technical SEO limitation.",
        "Keyword research limitation.",
      ]),
    );

    expect(await readEventTypes(auditLogPath)).toEqual([
      "competitor_intelligence_requested",
      "competitor_intelligence_completed",
    ]);
  });

  it("recommends addressing https since both competitors use a well-formed page while we use http", async () => {
    const { agent } = buildAgent(REJECTING_DECISION);

    const result = await agent.analyzeCompetitors(
      makeRequest([
        { id: "competitor-a", html: OUR_GOOD_PAGE, url: "https://competitor-a.com/plumbing" },
        { id: "competitor-b", html: OUR_GOOD_PAGE, url: "https://competitor-b.com/plumbing" },
      ]),
    );

    const httpsComparison = result.technicalComparison[0]?.categories.find((c) => c.category === "https");
    expect(httpsComparison?.advantage).toBe("competitor");
    expect(result.recommendations.some((r) => r.category === "https")).toBe(true);
  });

  it("throws and audit-logs validation failures without producing a result", async () => {
    const { agent, auditLogPath } = buildAgent(REJECTING_DECISION);

    await expect(agent.analyzeCompetitors(makeRequest([]))).rejects.toThrow();

    expect(await readEventTypes(auditLogPath)).toEqual(["competitor_intelligence_validation_failed"]);
  });

  it("escalates a single-competitor request and proceeds when a human approves", async () => {
    const approvingDecision: ApprovalDecision = {
      requestId: "unused",
      outcome: "candidate_selected",
      selectedCandidateId: "proceed",
      notes: "Only one available, proceed anyway.",
      decidedAt: new Date().toISOString(),
    };
    const { agent, auditLogPath } = buildAgent(approvingDecision);

    const result = await agent.analyzeCompetitors(
      makeRequest([{ id: "competitor-a", html: OUR_GOOD_PAGE, url: "https://competitor-a.com/plumbing" }]),
    );

    expect(result.competitorGapAnalysis).toHaveLength(1);
    expect(await readEventTypes(auditLogPath)).toEqual([
      "competitor_intelligence_requested",
      "competitor_intelligence_escalated",
      "competitor_intelligence_escalation_resolved",
      "competitor_intelligence_completed",
    ]);
  });

  it("rejects when a human declines the single-competitor escalation", async () => {
    const { agent, auditLogPath } = buildAgent(REJECTING_DECISION);

    await expect(
      agent.analyzeCompetitors(
        makeRequest([{ id: "competitor-a", html: OUR_GOOD_PAGE, url: "https://competitor-a.com/plumbing" }]),
      ),
    ).rejects.toThrow(/only one competitor was supplied/);

    expect(await readEventTypes(auditLogPath)).toEqual([
      "competitor_intelligence_requested",
      "competitor_intelligence_escalated",
      "competitor_intelligence_escalation_resolved",
      "competitor_intelligence_rejected",
    ]);
  });

  it("skips a competitor whose ambiguous snapshot is rejected by human review, without failing the whole request", async () => {
    // The injected WebsiteAuditAgent rejects any ambiguous-input escalation.
    const websiteAuditAgent = buildWebsiteAuditAgent(REJECTING_DECISION);
    const { agent, auditLogPath } = buildAgent(REJECTING_DECISION, websiteAuditAgent);

    const result = await agent.analyzeCompetitors(
      makeRequest([
        { id: "competitor-a", html: OUR_GOOD_PAGE, url: "https://competitor-a.com/plumbing" },
        { id: "competitor-ambiguous", html: "just some plain text, not a real page" },
      ]),
    );

    expect(result.competitorGapAnalysis).toHaveLength(1);
    expect(result.competitorGapAnalysis[0]?.competitorId).toBe("competitor-a");
    expect(result.limitations.some((l) => l.includes('Competitor "competitor-ambiguous" was skipped'))).toBe(true);

    expect(await readEventTypes(auditLogPath)).toEqual([
      "competitor_intelligence_requested",
      "competitor_intelligence_competitor_skipped",
      "competitor_intelligence_completed",
    ]);
  });
});
