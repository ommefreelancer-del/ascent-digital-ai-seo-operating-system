import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
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
import type { ApprovalDecision } from "../../../src/core/types/approval.types.js";
import type { PerformanceAnalyticsRequest } from "../../../src/agents/performance-analytics-agent/types/performance-analytics-request.types.js";
import type {
  PerformanceData,
  PerformanceDataProvider,
  PerformanceMetricsRequest,
} from "../../../src/agents/performance-analytics-agent/types/performance-data-provider.types.js";
import type { KeywordResearchResult } from "../../../src/agents/keyword-research-agent/types/keyword-request.types.js";
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

class FixedPerformanceDataProvider implements PerformanceDataProvider {
  readonly name = "fixed-test-provider";
  constructor(private readonly data: PerformanceData | null) {}
  async fetchPerformanceData(_request: PerformanceMetricsRequest): Promise<PerformanceData | null> {
    return this.data;
  }
}

function makeKeywordResearch(): KeywordResearchResult {
  return {
    requestId: "kw-1",
    classifiedKeywords: [{ keyword: "plumber", intent: "informational", intentRationale: "x", metrics: null }],
    topicClusters: [],
    metricsAvailable: false,
    limitations: ["Keyword research limitation."],
    rankingDisclaimer: "No guarantee.",
    decidedAt: new Date().toISOString(),
  };
}

function makeWebsiteAudit(findings: WebsiteAuditResult["findings"] = []): WebsiteAuditResult {
  return {
    requestId: "wa-1",
    url: "https://oursite.com/plumbing",
    findings,
    summary: { criticalCount: 0, warningCount: 0, infoCount: 0 },
    limitations: ["Website audit limitation."],
    decidedAt: new Date().toISOString(),
  };
}

function makeTechnicalSeo(): TechnicalSeoResult {
  return {
    requestId: "ts-1",
    url: "https://oursite.com/plumbing",
    recommendations: [],
    limitations: ["Technical SEO limitation."],
    decidedAt: new Date().toISOString(),
  };
}

function makeRequest(overrides: Partial<PerformanceAnalyticsRequest> = {}): PerformanceAnalyticsRequest {
  return {
    id: "req-1",
    url: "https://oursite.com/plumbing",
    keywordResearch: makeKeywordResearch(),
    websiteAudit: makeWebsiteAudit(),
    technicalSeo: makeTechnicalSeo(),
    ...overrides,
  };
}

describe("PerformanceAnalyticsAgent", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "performance-analytics-agent-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  function buildAgent(dataProvider: PerformanceDataProvider, approvalDecision: ApprovalDecision = REJECTING_DECISION) {
    const auditLogPath = join(dir, "audit-log.jsonl");
    const agent = new PerformanceAnalyticsAgent(
      new PerformanceAnalyticsRequestValidator(),
      dataProvider,
      new RankingInsightBuilder(),
      new TrafficInsightBuilder(),
      new CoreWebVitalsInsightBuilder(),
      new RoiInsightBuilder(),
      new PerformanceOpportunityBuilder(),
      new PerformanceRecommendationBuilder(),
      makeApprovalChannel(approvalDecision),
      new AuditLogger(auditLogPath),
    );
    return { agent, auditLogPath };
  }

  async function readEventTypes(auditLogPath: string): Promise<string[]> {
    const lines = (await readFile(auditLogPath, "utf8")).trim().split("\n");
    return lines.map((line) => JSON.parse(line).eventType);
  }

  it("reports data unavailable and produces no data-dependent output with the default NullPerformanceDataProvider", async () => {
    const { agent, auditLogPath } = buildAgent(new NullPerformanceDataProvider());

    const result = await agent.analyzePerformance(makeRequest());

    expect(result.dataAvailable).toBe(false);
    expect(result.rankingInsights).toHaveLength(0);
    expect(result.trafficInsight).toBeNull();
    expect(result.coreWebVitalInsights).toHaveLength(0);
    expect(result.roiInsight).toBeNull();
    expect(result.opportunities).toHaveLength(0);
    expect(result.recommendations).toHaveLength(0);
    expect(result.limitations.some((l) => l.includes('using "none-configured"'))).toBe(true);
    expect(await readEventTypes(auditLogPath)).toEqual(["performance_analytics_requested", "performance_analytics_completed"]);
  });

  it("carries forward every upstream limitation", async () => {
    const { agent } = buildAgent(new NullPerformanceDataProvider());
    const result = await agent.analyzePerformance(makeRequest());

    expect(result.limitations).toEqual(
      expect.arrayContaining([
        "Keyword research limitation.",
        "Website audit limitation.",
        "Technical SEO limitation.",
      ]),
    );
  });

  it("produces real insights, opportunities, an ROI estimate, and recommendations when the provider supplies real data", async () => {
    const performanceData: PerformanceData = {
      url: "https://oursite.com/plumbing",
      rankings: [{ keyword: "plumber", position: 15, previousPosition: 20, impressions: 500, clicks: 20, ctr: 0.04 }],
      traffic: { organicSessions: 200, previousOrganicSessions: 150, conversions: 10, averageConversionValue: 75 },
      coreWebVitals: { lcpMs: 3000, inpMs: 150, cls: 0.05 },
      source: "fixed-test-provider",
      retrievedAt: new Date().toISOString(),
    };
    const { agent, auditLogPath } = buildAgent(new FixedPerformanceDataProvider(performanceData));

    const result = await agent.analyzePerformance(makeRequest());

    expect(result.dataAvailable).toBe(true);
    expect(result.rankingInsights).toHaveLength(1);
    expect(result.rankingInsights[0]).toMatchObject({ isPageOneOpportunity: true, trend: "improving" });
    expect(result.trafficInsight).toMatchObject({ trend: "improving", conversions: 10 });
    expect(result.coreWebVitalInsights.find((v) => v.metric === "LCP")?.passesThreshold).toBe(false);
    expect(result.roiInsight).toMatchObject({ conversions: 10, averageConversionValue: 75, estimatedRevenue: 750 });
    expect(result.opportunities.length).toBeGreaterThan(0);
    expect(result.recommendations.length).toBeGreaterThan(0);
    expect(await readEventTypes(auditLogPath)).toEqual(["performance_analytics_requested", "performance_analytics_completed"]);
  });

  it("throws and audit-logs validation failures without producing a result", async () => {
    const { agent, auditLogPath } = buildAgent(new NullPerformanceDataProvider());

    await expect(agent.analyzePerformance(makeRequest({ url: "   " }))).rejects.toThrow();

    expect(await readEventTypes(auditLogPath)).toEqual(["performance_analytics_validation_failed"]);
  });

  it("escalates a noindex/active-ranking contradiction and proceeds when a human approves", async () => {
    const performanceData: PerformanceData = {
      url: "https://oursite.com/plumbing",
      rankings: [{ keyword: "plumber", position: 5, previousPosition: 5, impressions: 100, clicks: 10, ctr: 0.1 }],
      traffic: null,
      coreWebVitals: null,
      source: "fixed-test-provider",
      retrievedAt: new Date().toISOString(),
    };
    const approvingDecision: ApprovalDecision = {
      requestId: "unused",
      outcome: "candidate_selected",
      selectedCandidateId: "proceed",
      notes: "Proceed despite the contradiction.",
      decidedAt: new Date().toISOString(),
    };
    const { agent, auditLogPath } = buildAgent(new FixedPerformanceDataProvider(performanceData), approvingDecision);

    const request = makeRequest({
      websiteAudit: makeWebsiteAudit([
        { category: "crawlability", severity: "critical", message: "A noindex tag was found.", recommendation: "x" },
      ]),
    });

    const result = await agent.analyzePerformance(request);

    expect(result.requestId).toBe("req-1");
    expect(await readEventTypes(auditLogPath)).toEqual([
      "performance_analytics_requested",
      "performance_analytics_escalated",
      "performance_analytics_escalation_resolved",
      "performance_analytics_completed",
    ]);
  });

  it("rejects when a human declines the noindex/active-ranking escalation", async () => {
    const performanceData: PerformanceData = {
      url: "https://oursite.com/plumbing",
      rankings: [{ keyword: "plumber", position: 5, previousPosition: 5, impressions: 100, clicks: 10, ctr: 0.1 }],
      traffic: null,
      coreWebVitals: null,
      source: "fixed-test-provider",
      retrievedAt: new Date().toISOString(),
    };
    const { agent, auditLogPath } = buildAgent(new FixedPerformanceDataProvider(performanceData), REJECTING_DECISION);

    const request = makeRequest({
      websiteAudit: makeWebsiteAudit([
        { category: "crawlability", severity: "critical", message: "A noindex tag was found.", recommendation: "x" },
      ]),
    });

    await expect(agent.analyzePerformance(request)).rejects.toThrow(
      /both flagged noindex and shows real ranking activity/,
    );

    expect(await readEventTypes(auditLogPath)).toEqual([
      "performance_analytics_requested",
      "performance_analytics_escalated",
      "performance_analytics_escalation_resolved",
      "performance_analytics_rejected",
    ]);
  });
});
