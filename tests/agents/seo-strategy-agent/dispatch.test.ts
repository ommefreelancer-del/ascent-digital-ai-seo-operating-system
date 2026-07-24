import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SEO_STRATEGY_AGENT_ID, isSeoStrategyAssignment } from "../../../src/agents/seo-strategy-agent/dispatch.js";
import { SeoStrategyAgent } from "../../../src/agents/seo-strategy-agent/seo-strategy-agent.js";
import { SeoStrategyRequestValidator } from "../../../src/agents/seo-strategy-agent/validation/seo-strategy-request-validator.js";
import { StrategyItemCollector } from "../../../src/agents/seo-strategy-agent/synthesis/strategy-item-collector.js";
import { PrioritizationMatrixBuilder } from "../../../src/agents/seo-strategy-agent/synthesis/prioritization-matrix-builder.js";
import { RoadmapBuilder } from "../../../src/agents/seo-strategy-agent/synthesis/roadmap-builder.js";
import { ImplementationPlanBuilder } from "../../../src/agents/seo-strategy-agent/synthesis/implementation-plan-builder.js";
import { AuditLogger } from "../../../src/core/governance/audit-logger.js";
import type { ApprovalChannel } from "../../../src/core/governance/approval-channel.js";
import type { RoutingDecision } from "../../../src/boss-agent/types/routing.types.js";
import type { KeywordResearchResult } from "../../../src/agents/keyword-research-agent/types/keyword-request.types.js";
import type { WebsiteAuditResult } from "../../../src/agents/website-audit-agent/types/website-audit-request.types.js";
import type { TechnicalSeoResult } from "../../../src/agents/technical-seo-agent/types/technical-seo-request.types.js";
import type { CompetitorIntelligenceResult } from "../../../src/agents/competitor-intelligence-agent/types/competitor-intelligence-request.types.js";

function makeDecision(overrides: Partial<RoutingDecision> = {}): RoutingDecision {
  return {
    taskId: "task-1",
    status: "assigned",
    assignedAgentId: SEO_STRATEGY_AGENT_ID,
    candidates: [],
    rationale: "Matched.",
    decidedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("isSeoStrategyAssignment", () => {
  it("is true when the decision is assigned to the SEO strategy agent", () => {
    expect(isSeoStrategyAssignment(makeDecision())).toBe(true);
  });

  it("is false when assigned to a different agent", () => {
    expect(isSeoStrategyAssignment(makeDecision({ assignedAgentId: "competitor-intelligence-agent" }))).toBe(false);
  });

  it("is false when the decision was rejected", () => {
    expect(
      isSeoStrategyAssignment({
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
    dir = await mkdtemp(join(tmpdir(), "seo-strategy-dispatch-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("carries the same id from RoutingDecision.taskId through to SeoStrategyResult.requestId", async () => {
    const decision = makeDecision({ taskId: "boss-agent-task-7" });
    expect(isSeoStrategyAssignment(decision)).toBe(true);

    const approvalChannel: ApprovalChannel = {
      requestDecision: async () => {
        throw new Error("should not be called for a clean, multi-competitor request");
      },
    };
    const agent = new SeoStrategyAgent(
      new SeoStrategyRequestValidator(),
      new StrategyItemCollector(),
      new PrioritizationMatrixBuilder(),
      new RoadmapBuilder(),
      new ImplementationPlanBuilder(),
      approvalChannel,
      new AuditLogger(join(dir, "audit-log.jsonl")),
    );

    const keywordResearch: KeywordResearchResult = {
      requestId: "kw-1",
      classifiedKeywords: [],
      topicClusters: [],
      metricsAvailable: false,
      limitations: [],
      rankingDisclaimer: "No guarantee.",
      decidedAt: new Date().toISOString(),
    };
    const websiteAudit: WebsiteAuditResult = {
      requestId: "wa-1",
      url: "https://oursite.com/plumbing",
      findings: [],
      summary: { criticalCount: 0, warningCount: 0, infoCount: 0 },
      limitations: [],
      decidedAt: new Date().toISOString(),
    };
    const technicalSeo: TechnicalSeoResult = {
      requestId: "ts-1",
      url: "https://oursite.com/plumbing",
      recommendations: [],
      limitations: [],
      decidedAt: new Date().toISOString(),
    };
    const competitorIntelligence: CompetitorIntelligenceResult = {
      requestId: "ci-1",
      competitorGapAnalysis: [
        { competitorId: "competitor-a", competitorUrl: null, ourTotalIssues: 1, competitorTotalIssues: 0, assessment: "we_are_behind" },
      ],
      technicalComparison: [],
      contentGapAnalysis: [],
      recommendations: [],
      limitations: [],
      decidedAt: new Date().toISOString(),
    };

    const result = await agent.developStrategy({
      id: decision.taskId,
      businessObjective: "Grow organic traffic.",
      keywordResearch,
      websiteAudit,
      technicalSeo,
      competitorIntelligence,
    });

    expect(result.requestId).toBe("boss-agent-task-7");
  });
});
