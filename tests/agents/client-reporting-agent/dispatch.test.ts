import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CLIENT_REPORTING_AGENT_ID, isClientReportingAssignment } from "../../../src/agents/client-reporting-agent/dispatch.js";
import { ClientReportingAgent } from "../../../src/agents/client-reporting-agent/client-reporting-agent.js";
import { ClientReportingRequestValidator } from "../../../src/agents/client-reporting-agent/validation/client-reporting-request-validator.js";
import { KpiDashboardBuilder } from "../../../src/agents/client-reporting-agent/synthesis/kpi-dashboard-builder.js";
import { AchievementChallengeBuilder } from "../../../src/agents/client-reporting-agent/synthesis/achievement-challenge-builder.js";
import { ClientRecommendationBuilder } from "../../../src/agents/client-reporting-agent/synthesis/client-recommendation-builder.js";
import { ExecutiveSummaryBuilder } from "../../../src/agents/client-reporting-agent/synthesis/executive-summary-builder.js";
import { ScoreCardBuilder } from "../../../src/agents/client-reporting-agent/synthesis/score-card-builder.js";
import { PriorityMatrixBuilder } from "../../../src/agents/client-reporting-agent/synthesis/priority-matrix-builder.js";
import { AuditLogger } from "../../../src/core/governance/audit-logger.js";
import type { ApprovalChannel } from "../../../src/core/governance/approval-channel.js";
import type { RoutingDecision } from "../../../src/boss-agent/types/routing.types.js";
import type { PerformanceAnalyticsResult } from "../../../src/agents/performance-analytics-agent/types/performance-analytics-request.types.js";
import type { WebsiteAuditResult } from "../../../src/agents/website-audit-agent/types/website-audit-request.types.js";
import type { TechnicalSeoResult } from "../../../src/agents/technical-seo-agent/types/technical-seo-request.types.js";

function makeDecision(overrides: Partial<RoutingDecision> = {}): RoutingDecision {
  return {
    taskId: "task-1",
    status: "assigned",
    assignedAgentId: CLIENT_REPORTING_AGENT_ID,
    candidates: [],
    rationale: "Matched.",
    decidedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("isClientReportingAssignment", () => {
  it("is true when the decision is assigned to the client reporting agent", () => {
    expect(isClientReportingAssignment(makeDecision())).toBe(true);
  });

  it("is false when assigned to a different agent", () => {
    expect(isClientReportingAssignment(makeDecision({ assignedAgentId: "seo-strategy-agent" }))).toBe(false);
  });

  it("is false when the decision was rejected", () => {
    expect(
      isClientReportingAssignment({
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
    dir = await mkdtemp(join(tmpdir(), "client-reporting-dispatch-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("carries the same id from RoutingDecision.taskId through to ClientReportingResult.requestId", async () => {
    const decision = makeDecision({ taskId: "boss-agent-task-19" });
    expect(isClientReportingAssignment(decision)).toBe(true);

    const approvalChannel: ApprovalChannel = {
      requestDecision: async () => {
        throw new Error("should not be called when real performance data is available");
      },
    };
    const agent = new ClientReportingAgent(
      new ClientReportingRequestValidator(),
      new KpiDashboardBuilder(),
      new AchievementChallengeBuilder(),
      new ClientRecommendationBuilder(),
      new ExecutiveSummaryBuilder(),
      new ScoreCardBuilder(),
      new PriorityMatrixBuilder(),
      approvalChannel,
      new AuditLogger(join(dir, "audit-log.jsonl")),
    );

    const performanceAnalytics: PerformanceAnalyticsResult = {
      requestId: "pa-1",
      url: "https://oursite.com",
      dataAvailable: true,
      rankingInsights: [],
      trafficInsight: { organicSessions: 100, trend: "stable", conversions: null },
      coreWebVitalInsights: [],
      lighthouseCategoryScores: null,
      opportunities: [],
      roiInsight: null,
      recommendations: [],
      limitations: [],
      decidedAt: new Date().toISOString(),
    };
    const websiteAudit: WebsiteAuditResult = {
      requestId: "wa-1",
      url: "https://oursite.com",
      findings: [],
      summary: { criticalCount: 0, warningCount: 0, infoCount: 0 },
      limitations: [],
      decidedAt: new Date().toISOString(),
    };
    const technicalSeo: TechnicalSeoResult = {
      requestId: "ts-1",
      url: "https://oursite.com",
      recommendations: [],
      limitations: [],
      decidedAt: new Date().toISOString(),
    };

    const result = await agent.generateReport({
      id: decision.taskId,
      clientName: "Acme",
      reportingPeriodLabel: "July 2026",
      performanceAnalytics,
      websiteAudit,
      technicalSeo,
    });

    expect(result.requestId).toBe("boss-agent-task-19");
  });
});
