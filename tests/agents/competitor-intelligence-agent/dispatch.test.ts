import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  COMPETITOR_INTELLIGENCE_AGENT_ID,
  isCompetitorIntelligenceAssignment,
} from "../../../src/agents/competitor-intelligence-agent/dispatch.js";
import { CompetitorIntelligenceAgent } from "../../../src/agents/competitor-intelligence-agent/competitor-intelligence-agent.js";
import { CompetitorIntelligenceRequestValidator } from "../../../src/agents/competitor-intelligence-agent/validation/competitor-intelligence-request-validator.js";
import { CompetitorOverallGapBuilder } from "../../../src/agents/competitor-intelligence-agent/analysis/competitor-overall-gap-builder.js";
import { TechnicalComparisonBuilder } from "../../../src/agents/competitor-intelligence-agent/analysis/technical-comparison-builder.js";
import { ContentClusterCoverageBuilder } from "../../../src/agents/competitor-intelligence-agent/analysis/content-cluster-coverage-builder.js";
import { CompetitorRecommendationBuilder } from "../../../src/agents/competitor-intelligence-agent/analysis/competitor-recommendation-builder.js";
import { WebsiteAuditAgent } from "../../../src/agents/website-audit-agent/website-audit-agent.js";
import { WebsiteAuditRequestValidator } from "../../../src/agents/website-audit-agent/validation/website-audit-request-validator.js";
import { MetadataChecker } from "../../../src/agents/website-audit-agent/checks/metadata-checker.js";
import { AuditLogger } from "../../../src/core/governance/audit-logger.js";
import type { ApprovalChannel } from "../../../src/core/governance/approval-channel.js";
import type { RoutingDecision } from "../../../src/boss-agent/types/routing.types.js";
import type { WebsiteAuditResult } from "../../../src/agents/website-audit-agent/types/website-audit-request.types.js";
import type { TechnicalSeoResult } from "../../../src/agents/technical-seo-agent/types/technical-seo-request.types.js";
import type { KeywordResearchResult } from "../../../src/agents/keyword-research-agent/types/keyword-request.types.js";

function makeDecision(overrides: Partial<RoutingDecision> = {}): RoutingDecision {
  return {
    taskId: "task-1",
    status: "assigned",
    assignedAgentId: COMPETITOR_INTELLIGENCE_AGENT_ID,
    candidates: [],
    rationale: "Matched.",
    decidedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("isCompetitorIntelligenceAssignment", () => {
  it("is true when the decision is assigned to the competitor intelligence agent", () => {
    expect(isCompetitorIntelligenceAssignment(makeDecision())).toBe(true);
  });

  it("is false when assigned to a different agent", () => {
    expect(isCompetitorIntelligenceAssignment(makeDecision({ assignedAgentId: "technical-seo-agent" }))).toBe(
      false,
    );
  });

  it("is false when the decision was rejected", () => {
    expect(
      isCompetitorIntelligenceAssignment({
        taskId: "task-1",
        status: "rejected",
        candidates: [],
        rationale: "Declined.",
        decidedAt: new Date().toISOString(),
      }),
    ).toBe(false);
  });
});

describe("integration: a Boss Agent routing decision can be traced through to a real result", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "competitor-intelligence-dispatch-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("carries the same id from RoutingDecision.taskId through to CompetitorIntelligenceResult.requestId", async () => {
    const decision = makeDecision({ taskId: "boss-agent-task-3" });
    expect(isCompetitorIntelligenceAssignment(decision)).toBe(true);

    const approvalChannel: ApprovalChannel = {
      requestDecision: async () => {
        throw new Error("should not be called for a clean, multi-competitor request");
      },
    };
    const websiteAuditAgent = new WebsiteAuditAgent(
      new WebsiteAuditRequestValidator(),
      [new MetadataChecker()],
      approvalChannel,
      new AuditLogger(join(dir, "website-audit-log.jsonl")),
    );
    const agent = new CompetitorIntelligenceAgent(
      new CompetitorIntelligenceRequestValidator(),
      websiteAuditAgent,
      new CompetitorOverallGapBuilder(),
      new TechnicalComparisonBuilder(),
      new ContentClusterCoverageBuilder(),
      new CompetitorRecommendationBuilder(),
      approvalChannel,
      new AuditLogger(join(dir, "audit-log.jsonl")),
    );

    const ourWebsiteAudit: WebsiteAuditResult = {
      requestId: "wa-1",
      url: "https://oursite.com/page",
      findings: [],
      summary: { criticalCount: 0, warningCount: 0, infoCount: 0 },
      limitations: [],
      decidedAt: new Date().toISOString(),
    };
    const ourTechnicalSeo: TechnicalSeoResult = {
      requestId: "ts-1",
      url: "https://oursite.com/page",
      recommendations: [],
      limitations: [],
      decidedAt: new Date().toISOString(),
    };
    const ourKeywordResearch: KeywordResearchResult = {
      requestId: "kw-1",
      classifiedKeywords: [],
      topicClusters: [],
      metricsAvailable: false,
      limitations: [],
      rankingDisclaimer: "No guarantee.",
      decidedAt: new Date().toISOString(),
    };

    const result = await agent.analyzeCompetitors({
      id: decision.taskId,
      ourWebsiteAudit,
      ourTechnicalSeo,
      ourKeywordResearch,
      competitors: [
        { id: "competitor-a", html: "<title>Competitor A</title>" },
        { id: "competitor-b", html: "<title>Competitor B</title>" },
      ],
    });

    expect(result.requestId).toBe("boss-agent-task-3");
  });
});
