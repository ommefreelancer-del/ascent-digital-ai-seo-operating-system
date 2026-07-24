import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SeoStrategyAgent } from "../../../src/agents/seo-strategy-agent/seo-strategy-agent.js";
import { SeoStrategyRequestValidator } from "../../../src/agents/seo-strategy-agent/validation/seo-strategy-request-validator.js";
import { StrategyItemCollector } from "../../../src/agents/seo-strategy-agent/synthesis/strategy-item-collector.js";
import { PrioritizationMatrixBuilder } from "../../../src/agents/seo-strategy-agent/synthesis/prioritization-matrix-builder.js";
import { RoadmapBuilder } from "../../../src/agents/seo-strategy-agent/synthesis/roadmap-builder.js";
import { ImplementationPlanBuilder } from "../../../src/agents/seo-strategy-agent/synthesis/implementation-plan-builder.js";
import { AuditLogger } from "../../../src/core/governance/audit-logger.js";
import type { ApprovalChannel } from "../../../src/core/governance/approval-channel.js";
import type { ApprovalDecision } from "../../../src/core/types/approval.types.js";
import type { SeoStrategyRequest } from "../../../src/agents/seo-strategy-agent/types/seo-strategy-request.types.js";
import type { KeywordResearchResult } from "../../../src/agents/keyword-research-agent/types/keyword-request.types.js";
import type { WebsiteAuditResult } from "../../../src/agents/website-audit-agent/types/website-audit-request.types.js";
import type { TechnicalSeoResult } from "../../../src/agents/technical-seo-agent/types/technical-seo-request.types.js";
import type { CompetitorIntelligenceResult } from "../../../src/agents/competitor-intelligence-agent/types/competitor-intelligence-request.types.js";

function makeApprovalChannel(decision: ApprovalDecision): ApprovalChannel {
  return { requestDecision: async () => decision };
}

const REJECTING_DECISION: ApprovalDecision = {
  requestId: "unused",
  outcome: "rejected",
  notes: "should not be called",
  decidedAt: new Date().toISOString(),
};

function makeKeywordResearch(): KeywordResearchResult {
  return {
    requestId: "kw-1",
    classifiedKeywords: [],
    topicClusters: [],
    metricsAvailable: false,
    limitations: ["Keyword research limitation."],
    rankingDisclaimer: "No guarantee.",
    decidedAt: new Date().toISOString(),
  };
}

function makeWebsiteAudit(): WebsiteAuditResult {
  return {
    requestId: "wa-1",
    url: "https://oursite.com/plumbing",
    findings: [],
    summary: { criticalCount: 0, warningCount: 0, infoCount: 0 },
    limitations: ["Website audit limitation."],
    decidedAt: new Date().toISOString(),
  };
}

function makeTechnicalSeo(): TechnicalSeoResult {
  return {
    requestId: "ts-1",
    url: "https://oursite.com/plumbing",
    recommendations: [
      {
        category: "crawlability",
        priority: "high",
        recommendation: "Remove the noindex directive.",
        rationale: "The page should be indexable.",
        confirmedByCrossFunctionalNote: false,
      },
    ],
    limitations: ["Technical SEO limitation."],
    decidedAt: new Date().toISOString(),
  };
}

function makeCompetitorIntelligence(
  competitorGapAnalysis: CompetitorIntelligenceResult["competitorGapAnalysis"] = [
    { competitorId: "competitor-a", competitorUrl: null, ourTotalIssues: 1, competitorTotalIssues: 0, assessment: "we_are_behind" },
  ],
): CompetitorIntelligenceResult {
  return {
    requestId: "ci-1",
    competitorGapAnalysis,
    technicalComparison: [],
    contentGapAnalysis: [],
    recommendations: [
      {
        category: "https",
        priority: "medium",
        recommendation: "Migrate to HTTPS.",
        rationale: "Competitors already use HTTPS.",
      },
    ],
    limitations: ["Competitor intelligence limitation."],
    decidedAt: new Date().toISOString(),
  };
}

function makeRequest(overrides: Partial<SeoStrategyRequest> = {}): SeoStrategyRequest {
  return {
    id: "req-1",
    businessObjective: "Grow organic traffic for local plumbing services.",
    keywordResearch: makeKeywordResearch(),
    websiteAudit: makeWebsiteAudit(),
    technicalSeo: makeTechnicalSeo(),
    competitorIntelligence: makeCompetitorIntelligence(),
    ...overrides,
  };
}

describe("SeoStrategyAgent", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "seo-strategy-agent-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  function buildAgent(approvalDecision: ApprovalDecision) {
    const auditLogPath = join(dir, "audit-log.jsonl");
    const agent = new SeoStrategyAgent(
      new SeoStrategyRequestValidator(),
      new StrategyItemCollector(),
      new PrioritizationMatrixBuilder(),
      new RoadmapBuilder(),
      new ImplementationPlanBuilder(),
      makeApprovalChannel(approvalDecision),
      new AuditLogger(auditLogPath),
    );
    return { agent, auditLogPath };
  }

  async function readEventTypes(auditLogPath: string): Promise<string[]> {
    const lines = (await readFile(auditLogPath, "utf8")).trim().split("\n");
    return lines.map((line) => JSON.parse(line).eventType);
  }

  it("synthesizes a full strategy, matrix, roadmap, and implementation plan from real upstream results", async () => {
    const { agent, auditLogPath } = buildAgent(REJECTING_DECISION);

    const result = await agent.developStrategy(makeRequest());

    expect(result.requestId).toBe("req-1");
    expect(result.strategy).toHaveLength(2);
    expect(result.prioritizationMatrix.quickWins.length + result.prioritizationMatrix.majorProjects.length).toBeGreaterThan(0);
    expect(result.implementationPlan.length).toBeGreaterThan(0);
    expect(result.implementationPlan[0]?.sequence).toBe(1);

    expect(await readEventTypes(auditLogPath)).toEqual(["seo_strategy_requested", "seo_strategy_completed"]);
  });

  it("carries forward every upstream limitation plus its own standing disclaimers", async () => {
    const { agent } = buildAgent(REJECTING_DECISION);

    const result = await agent.developStrategy(makeRequest());

    expect(result.limitations).toEqual(
      expect.arrayContaining([
        "Keyword research limitation.",
        "Website audit limitation.",
        "Technical SEO limitation.",
        "Competitor intelligence limitation.",
        "contentStrategy was not supplied; content-creation opportunities are not reflected in this strategy.",
        "onPageSeo was not supplied; on-page recommendations are not reflected in this strategy.",
      ]),
    );
    expect(result.limitations.some((l) => l.includes("Performance Analytics"))).toBe(true);
  });

  it("throws and audit-logs validation failures without producing a result", async () => {
    const { agent, auditLogPath } = buildAgent(REJECTING_DECISION);

    await expect(agent.developStrategy(makeRequest({ businessObjective: "   " }))).rejects.toThrow();

    expect(await readEventTypes(auditLogPath)).toEqual(["seo_strategy_validation_failed"]);
  });

  it("escalates when competitor intelligence analyzed zero competitors, and proceeds when a human approves", async () => {
    const approvingDecision: ApprovalDecision = {
      requestId: "unused",
      outcome: "candidate_selected",
      selectedCandidateId: "proceed",
      notes: "Proceed without competitor data.",
      decidedAt: new Date().toISOString(),
    };
    const { agent, auditLogPath } = buildAgent(approvingDecision);

    const result = await agent.developStrategy(makeRequest({ competitorIntelligence: makeCompetitorIntelligence([]) }));

    expect(result.requestId).toBe("req-1");
    expect(await readEventTypes(auditLogPath)).toEqual([
      "seo_strategy_requested",
      "seo_strategy_escalated",
      "seo_strategy_escalation_resolved",
      "seo_strategy_completed",
    ]);
  });

  it("rejects when a human declines the zero-competitor escalation", async () => {
    const { agent, auditLogPath } = buildAgent(REJECTING_DECISION);

    await expect(
      agent.developStrategy(makeRequest({ competitorIntelligence: makeCompetitorIntelligence([]) })),
    ).rejects.toThrow(/no successfully analyzed competitors/);

    expect(await readEventTypes(auditLogPath)).toEqual([
      "seo_strategy_requested",
      "seo_strategy_escalated",
      "seo_strategy_escalation_resolved",
      "seo_strategy_rejected",
    ]);
  });
});
