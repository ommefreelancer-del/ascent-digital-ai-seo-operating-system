import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  PERFORMANCE_ANALYTICS_AGENT_ID,
  isPerformanceAnalyticsAssignment,
} from "../../../src/agents/performance-analytics-agent/dispatch.js";
import { PerformanceAnalyticsAgent } from "../../../src/agents/performance-analytics-agent/performance-analytics-agent.js";
import { PerformanceAnalyticsRequestValidator } from "../../../src/agents/performance-analytics-agent/validation/performance-analytics-request-validator.js";
import { NullPerformanceDataProvider } from "../../../src/agents/performance-analytics-agent/providers/null-performance-data-provider.js";
import { RankingInsightBuilder } from "../../../src/agents/performance-analytics-agent/synthesis/ranking-insight-builder.js";
import { TrafficInsightBuilder } from "../../../src/agents/performance-analytics-agent/synthesis/traffic-insight-builder.js";
import { CoreWebVitalsInsightBuilder } from "../../../src/agents/performance-analytics-agent/synthesis/core-web-vitals-insight-builder.js";
import { RoiInsightBuilder } from "../../../src/agents/performance-analytics-agent/synthesis/roi-insight-builder.js";
import { PerformanceOpportunityBuilder } from "../../../src/agents/performance-analytics-agent/synthesis/performance-opportunity-builder.js";
import { PerformanceRecommendationBuilder } from "../../../src/agents/performance-analytics-agent/synthesis/performance-recommendation-builder.js";
import { AuditLogger } from "../../../src/core/governance/audit-logger.js";
import type { ApprovalChannel } from "../../../src/core/governance/approval-channel.js";
import type { RoutingDecision } from "../../../src/boss-agent/types/routing.types.js";
import type { KeywordResearchResult } from "../../../src/agents/keyword-research-agent/types/keyword-request.types.js";
import type { WebsiteAuditResult } from "../../../src/agents/website-audit-agent/types/website-audit-request.types.js";
import type { TechnicalSeoResult } from "../../../src/agents/technical-seo-agent/types/technical-seo-request.types.js";

function makeDecision(overrides: Partial<RoutingDecision> = {}): RoutingDecision {
  return {
    taskId: "task-1",
    status: "assigned",
    assignedAgentId: PERFORMANCE_ANALYTICS_AGENT_ID,
    candidates: [],
    rationale: "Matched.",
    decidedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("isPerformanceAnalyticsAssignment", () => {
  it("is true when the decision is assigned to the performance analytics agent", () => {
    expect(isPerformanceAnalyticsAssignment(makeDecision())).toBe(true);
  });

  it("is false when assigned to a different agent", () => {
    expect(isPerformanceAnalyticsAssignment(makeDecision({ assignedAgentId: "seo-strategy-agent" }))).toBe(false);
  });

  it("is false when the decision was rejected", () => {
    expect(
      isPerformanceAnalyticsAssignment({
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
    dir = await mkdtemp(join(tmpdir(), "performance-analytics-dispatch-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("carries the same id from RoutingDecision.taskId through to PerformanceAnalyticsResult.requestId", async () => {
    const decision = makeDecision({ taskId: "boss-agent-task-9" });
    expect(isPerformanceAnalyticsAssignment(decision)).toBe(true);

    const approvalChannel: ApprovalChannel = {
      requestDecision: async () => {
        throw new Error("should not be called for a clean request with no performance data configured");
      },
    };
    const agent = new PerformanceAnalyticsAgent(
      new PerformanceAnalyticsRequestValidator(),
      new NullPerformanceDataProvider(),
      new RankingInsightBuilder(),
      new TrafficInsightBuilder(),
      new CoreWebVitalsInsightBuilder(),
      new RoiInsightBuilder(),
      new PerformanceOpportunityBuilder(),
      new PerformanceRecommendationBuilder(),
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

    const result = await agent.analyzePerformance({
      id: decision.taskId,
      url: "https://oursite.com/plumbing",
      keywordResearch,
      websiteAudit,
      technicalSeo,
    });

    expect(result.requestId).toBe("boss-agent-task-9");
  });
});
