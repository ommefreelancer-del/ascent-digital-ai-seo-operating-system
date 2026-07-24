import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  GOOGLE_BUSINESS_PROFILE_AGENT_ID,
  isGoogleBusinessProfileAssignment,
} from "../../../src/agents/google-business-profile-agent/dispatch.js";
import { GoogleBusinessProfileAgent } from "../../../src/agents/google-business-profile-agent/google-business-profile-agent.js";
import { GoogleBusinessProfileRequestValidator } from "../../../src/agents/google-business-profile-agent/validation/google-business-profile-request-validator.js";
import { NullGbpDataProvider } from "../../../src/agents/google-business-profile-agent/providers/null-gbp-data-provider.js";
import { NapConsistencyBuilder } from "../../../src/agents/google-business-profile-agent/reporting/nap-consistency-builder.js";
import { ReviewManagementReportBuilder } from "../../../src/agents/google-business-profile-agent/reporting/review-management-report-builder.js";
import { LocalPerformanceReportBuilder } from "../../../src/agents/google-business-profile-agent/reporting/local-performance-report-builder.js";
import { GooglePostsPlanBuilder } from "../../../src/agents/google-business-profile-agent/reporting/google-posts-plan-builder.js";
import { LocalSeoRecommendationBuilder } from "../../../src/agents/google-business-profile-agent/reporting/local-seo-recommendation-builder.js";
import { AuditLogger } from "../../../src/core/governance/audit-logger.js";
import type { ApprovalChannel } from "../../../src/core/governance/approval-channel.js";
import type { RoutingDecision } from "../../../src/boss-agent/types/routing.types.js";

function makeDecision(overrides: Partial<RoutingDecision> = {}): RoutingDecision {
  return {
    taskId: "task-1",
    status: "assigned",
    assignedAgentId: GOOGLE_BUSINESS_PROFILE_AGENT_ID,
    candidates: [],
    rationale: "Matched.",
    decidedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("isGoogleBusinessProfileAssignment", () => {
  it("is true when the decision is assigned to the Google Business Profile agent", () => {
    expect(isGoogleBusinessProfileAssignment(makeDecision())).toBe(true);
  });

  it("is false when assigned to a different agent", () => {
    expect(isGoogleBusinessProfileAssignment(makeDecision({ assignedAgentId: "client-reporting-agent" }))).toBe(false);
  });

  it("is false when the decision was rejected", () => {
    expect(
      isGoogleBusinessProfileAssignment({
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
    dir = await mkdtemp(join(tmpdir(), "gbp-dispatch-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("carries the same id from RoutingDecision.taskId through to GoogleBusinessProfileResult.requestId", async () => {
    const decision = makeDecision({ taskId: "boss-agent-task-21" });
    expect(isGoogleBusinessProfileAssignment(decision)).toBe(true);

    const approvalChannel: ApprovalChannel = {
      requestDecision: async () => {
        throw new Error("should not be called for a clean request with no policy-risk signals");
      },
    };
    const agent = new GoogleBusinessProfileAgent(
      new GoogleBusinessProfileRequestValidator(),
      new NullGbpDataProvider(),
      new NapConsistencyBuilder(),
      new ReviewManagementReportBuilder(),
      new LocalPerformanceReportBuilder(),
      new GooglePostsPlanBuilder(),
      new LocalSeoRecommendationBuilder(),
      approvalChannel,
      new AuditLogger(join(dir, "audit-log.jsonl")),
    );

    const result = await agent.manageProfile({
      id: decision.taskId,
      businessName: "Acme Plumbing",
      websiteUrl: "https://oursite.com",
      expectedNap: { name: "Acme Plumbing", address: "123 Main St", phone: "555-1234" },
    });

    expect(result.requestId).toBe("boss-agent-task-21");
  });
});
