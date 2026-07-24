import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { OFF_PAGE_SEO_AGENT_ID, isOffPageSeoAssignment } from "../../../src/agents/off-page-seo-agent/dispatch.js";
import { OffPageSeoAgent } from "../../../src/agents/off-page-seo-agent/off-page-seo-agent.js";
import { OffPageSeoRequestValidator } from "../../../src/agents/off-page-seo-agent/validation/off-page-seo-request-validator.js";
import { NullBacklinkDataProvider } from "../../../src/agents/off-page-seo-agent/providers/null-backlink-data-provider.js";
import { ReferringDomainGrowthBuilder } from "../../../src/agents/off-page-seo-agent/synthesis/referring-domain-growth-builder.js";
import { ToxicBacklinkInsightBuilder } from "../../../src/agents/off-page-seo-agent/synthesis/toxic-backlink-insight-builder.js";
import { AuthorityGapBuilder } from "../../../src/agents/off-page-seo-agent/synthesis/authority-gap-builder.js";
import { OffPageOpportunityBuilder } from "../../../src/agents/off-page-seo-agent/synthesis/off-page-opportunity-builder.js";
import { OffPageRecommendationBuilder } from "../../../src/agents/off-page-seo-agent/synthesis/off-page-recommendation-builder.js";
import { AuditLogger } from "../../../src/core/governance/audit-logger.js";
import type { ApprovalChannel } from "../../../src/core/governance/approval-channel.js";
import type { RoutingDecision } from "../../../src/boss-agent/types/routing.types.js";
import type { WebsiteAuditResult } from "../../../src/agents/website-audit-agent/types/website-audit-request.types.js";
import type { CompetitorIntelligenceResult } from "../../../src/agents/competitor-intelligence-agent/types/competitor-intelligence-request.types.js";

function makeDecision(overrides: Partial<RoutingDecision> = {}): RoutingDecision {
  return {
    taskId: "task-1",
    status: "assigned",
    assignedAgentId: OFF_PAGE_SEO_AGENT_ID,
    candidates: [],
    rationale: "Matched.",
    decidedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("isOffPageSeoAssignment", () => {
  it("is true when the decision is assigned to the off-page SEO agent", () => {
    expect(isOffPageSeoAssignment(makeDecision())).toBe(true);
  });

  it("is false when assigned to a different agent", () => {
    expect(isOffPageSeoAssignment(makeDecision({ assignedAgentId: "performance-analytics-agent" }))).toBe(false);
  });

  it("is false when the decision was rejected", () => {
    expect(
      isOffPageSeoAssignment({
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
    dir = await mkdtemp(join(tmpdir(), "off-page-seo-dispatch-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("carries the same id from RoutingDecision.taskId through to OffPageSeoResult.requestId", async () => {
    const decision = makeDecision({ taskId: "boss-agent-task-11" });
    expect(isOffPageSeoAssignment(decision)).toBe(true);

    const approvalChannel: ApprovalChannel = {
      requestDecision: async () => {
        throw new Error("should not be called for a clean request with no backlink data configured");
      },
    };
    const agent = new OffPageSeoAgent(
      new OffPageSeoRequestValidator(),
      new NullBacklinkDataProvider(),
      new ReferringDomainGrowthBuilder(),
      new ToxicBacklinkInsightBuilder(),
      new AuthorityGapBuilder(),
      new OffPageOpportunityBuilder(),
      new OffPageRecommendationBuilder(),
      approvalChannel,
      new AuditLogger(join(dir, "audit-log.jsonl")),
    );

    const websiteAudit: WebsiteAuditResult = {
      requestId: "wa-1",
      url: "https://oursite.com/plumbing",
      findings: [],
      summary: { criticalCount: 0, warningCount: 0, infoCount: 0 },
      limitations: [],
      decidedAt: new Date().toISOString(),
    };
    const competitorIntelligence: CompetitorIntelligenceResult = {
      requestId: "ci-1",
      competitorGapAnalysis: [],
      technicalComparison: [],
      contentGapAnalysis: [],
      recommendations: [],
      limitations: [],
      decidedAt: new Date().toISOString(),
    };

    const result = await agent.developOffPageStrategy({
      id: decision.taskId,
      url: "https://oursite.com/plumbing",
      businessObjective: "Grow emergency plumbing leads.",
      competitorIntelligence,
      websiteAudit,
    });

    expect(result.requestId).toBe("boss-agent-task-11");
  });
});
