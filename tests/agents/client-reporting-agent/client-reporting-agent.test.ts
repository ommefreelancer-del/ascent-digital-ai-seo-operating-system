import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
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
import type { ApprovalDecision } from "../../../src/core/types/approval.types.js";
import type { ClientReportingRequest } from "../../../src/agents/client-reporting-agent/types/client-reporting-request.types.js";
import type { PerformanceAnalyticsResult } from "../../../src/agents/performance-analytics-agent/types/performance-analytics-request.types.js";
import type { WebsiteAuditResult } from "../../../src/agents/website-audit-agent/types/website-audit-request.types.js";
import type { TechnicalSeoResult } from "../../../src/agents/technical-seo-agent/types/technical-seo-request.types.js";

function makeApprovalChannel(decision: ApprovalDecision): ApprovalChannel {
  return { requestDecision: async () => decision };
}

const REJECTING_DECISION: ApprovalDecision = {
  requestId: "unused",
  outcome: "rejected",
  notes: "should not be called",
  decidedAt: new Date().toISOString(),
};

function makePerformanceAnalytics(overrides: Partial<PerformanceAnalyticsResult> = {}): PerformanceAnalyticsResult {
  return {
    requestId: "pa-1",
    url: "https://oursite.com",
    dataAvailable: true,
    rankingInsights: [],
    trafficInsight: { organicSessions: 420, trend: "improving", conversions: 8 },
    coreWebVitalInsights: [],
    lighthouseCategoryScores: null,
    opportunities: [],
    roiInsight: null,
    recommendations: [{ category: "ranking", priority: "high", recommendation: "Close the gap.", rationale: "x" }],
    limitations: ["Performance analytics limitation."],
    decidedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeWebsiteAudit(): WebsiteAuditResult {
  return {
    requestId: "wa-1",
    url: "https://oursite.com",
    findings: [],
    summary: { criticalCount: 0, warningCount: 1, infoCount: 0 },
    limitations: ["Website audit limitation."],
    decidedAt: new Date().toISOString(),
  };
}

function makeTechnicalSeo(): TechnicalSeoResult {
  return {
    requestId: "ts-1",
    url: "https://oursite.com",
    recommendations: [],
    limitations: ["Technical SEO limitation."],
    decidedAt: new Date().toISOString(),
  };
}

function makeRequest(overrides: Partial<ClientReportingRequest> = {}): ClientReportingRequest {
  return {
    id: "req-1",
    clientName: "Acme Plumbing",
    reportingPeriodLabel: "July 2026",
    performanceAnalytics: makePerformanceAnalytics(),
    websiteAudit: makeWebsiteAudit(),
    technicalSeo: makeTechnicalSeo(),
    ...overrides,
  };
}

describe("ClientReportingAgent", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "client-reporting-agent-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  function buildAgent(approvalDecision: ApprovalDecision) {
    const auditLogPath = join(dir, "audit-log.jsonl");
    const agent = new ClientReportingAgent(
      new ClientReportingRequestValidator(),
      new KpiDashboardBuilder(),
      new AchievementChallengeBuilder(),
      new ClientRecommendationBuilder(),
      new ExecutiveSummaryBuilder(),
      new ScoreCardBuilder(),
      new PriorityMatrixBuilder(),
      makeApprovalChannel(approvalDecision),
      new AuditLogger(auditLogPath),
    );
    return { agent, auditLogPath };
  }

  async function readEventTypes(auditLogPath: string): Promise<string[]> {
    const lines = (await readFile(auditLogPath, "utf8")).trim().split("\n");
    return lines.map((line) => JSON.parse(line).eventType);
  }

  it("generates a full report from real upstream results when performance data is available", async () => {
    const { agent, auditLogPath } = buildAgent(REJECTING_DECISION);

    const result = await agent.generateReport(makeRequest());

    expect(result.requestId).toBe("req-1");
    expect(result.dataAvailable).toBe(true);
    expect(result.executiveSummary).toContain("Acme Plumbing");
    expect(result.kpiDashboard.length).toBeGreaterThan(0);
    expect(result.recommendations).toEqual([{ priority: "high", recommendation: "Close the gap.", rationale: "x" }]);
    expect(await readEventTypes(auditLogPath)).toEqual(["client_reporting_requested", "client_reporting_completed"]);
  });

  it("carries forward every upstream limitation plus the standing no-activity-log disclaimer", async () => {
    const { agent } = buildAgent(REJECTING_DECISION);

    const result = await agent.generateReport(makeRequest());

    expect(result.limitations).toEqual(
      expect.arrayContaining([
        "Performance analytics limitation.",
        "Website audit limitation.",
        "Technical SEO limitation.",
        "seoStrategy was not supplied; recommendations reflect Performance Analytics findings only, not the full prioritized roadmap.",
        "No business KPIs were supplied; the KPI dashboard reflects SEO metrics only.",
      ]),
    );
    expect(result.limitations.some((l) => l.includes("does not include a log of completed SEO activities"))).toBe(true);
  });

  it("throws and audit-logs validation failures without producing a result", async () => {
    const { agent, auditLogPath } = buildAgent(REJECTING_DECISION);

    await expect(agent.generateReport(makeRequest({ clientName: "   " }))).rejects.toThrow();

    expect(await readEventTypes(auditLogPath)).toEqual(["client_reporting_validation_failed"]);
  });

  it("escalates when no real performance data is available, and proceeds when a human approves", async () => {
    const approvingDecision: ApprovalDecision = {
      requestId: "unused",
      outcome: "candidate_selected",
      selectedCandidateId: "proceed",
      notes: "Proceed without performance data.",
      decidedAt: new Date().toISOString(),
    };
    const { agent, auditLogPath } = buildAgent(approvingDecision);

    const result = await agent.generateReport(
      makeRequest({ performanceAnalytics: makePerformanceAnalytics({ dataAvailable: false, trafficInsight: null, recommendations: [] }) }),
    );

    expect(result.dataAvailable).toBe(false);
    expect(result.executiveSummary).toContain("No measured performance data");
    expect(await readEventTypes(auditLogPath)).toEqual([
      "client_reporting_requested",
      "client_reporting_escalated",
      "client_reporting_escalation_resolved",
      "client_reporting_completed",
    ]);
  });

  it("rejects when a human declines the no-performance-data escalation", async () => {
    const { agent, auditLogPath } = buildAgent(REJECTING_DECISION);

    await expect(
      agent.generateReport(
        makeRequest({ performanceAnalytics: makePerformanceAnalytics({ dataAvailable: false, trafficInsight: null, recommendations: [] }) }),
      ),
    ).rejects.toThrow(/no real, measured performance/);

    expect(await readEventTypes(auditLogPath)).toEqual([
      "client_reporting_requested",
      "client_reporting_escalated",
      "client_reporting_escalation_resolved",
      "client_reporting_rejected",
    ]);
  });
});
