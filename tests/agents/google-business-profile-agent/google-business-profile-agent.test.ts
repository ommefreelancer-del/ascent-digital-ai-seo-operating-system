import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
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
import type { ApprovalDecision } from "../../../src/core/types/approval.types.js";
import type { GoogleBusinessProfileRequest } from "../../../src/agents/google-business-profile-agent/types/google-business-profile-request.types.js";
import type {
  GbpDataProvider,
  GbpDataRequest,
  GbpSnapshot,
} from "../../../src/agents/google-business-profile-agent/types/gbp-data-provider.types.js";

function makeApprovalChannel(decision: ApprovalDecision): ApprovalChannel {
  return { requestDecision: async () => decision };
}

const REJECTING_DECISION: ApprovalDecision = {
  requestId: "unused",
  outcome: "rejected",
  notes: "should not be called",
  decidedAt: new Date().toISOString(),
};

class FixedGbpDataProvider implements GbpDataProvider {
  readonly name = "fixed-test-provider";
  constructor(private readonly snapshot: GbpSnapshot | null) {}
  async fetchGbpSnapshot(_request: GbpDataRequest): Promise<GbpSnapshot | null> {
    return this.snapshot;
  }
}

function makeRequest(overrides: Partial<GoogleBusinessProfileRequest> = {}): GoogleBusinessProfileRequest {
  return {
    id: "req-1",
    businessName: "Acme Plumbing",
    websiteUrl: "https://oursite.com",
    expectedNap: { name: "Acme Plumbing", address: "123 Main St", phone: "555-1234" },
    ...overrides,
  };
}

describe("GoogleBusinessProfileAgent", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "google-business-profile-agent-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  function buildAgent(provider: GbpDataProvider, approvalDecision: ApprovalDecision = REJECTING_DECISION) {
    const auditLogPath = join(dir, "audit-log.jsonl");
    const agent = new GoogleBusinessProfileAgent(
      new GoogleBusinessProfileRequestValidator(),
      provider,
      new NapConsistencyBuilder(),
      new ReviewManagementReportBuilder(),
      new LocalPerformanceReportBuilder(),
      new GooglePostsPlanBuilder(),
      new LocalSeoRecommendationBuilder(),
      makeApprovalChannel(approvalDecision),
      new AuditLogger(auditLogPath),
    );
    return { agent, auditLogPath };
  }

  async function readEventTypes(auditLogPath: string): Promise<string[]> {
    const lines = (await readFile(auditLogPath, "utf8")).trim().split("\n");
    return lines.map((line) => JSON.parse(line).eventType);
  }

  it("reports data unavailable with the default NullGbpDataProvider, but still drafts general posts/recommendations", async () => {
    const { agent, auditLogPath } = buildAgent(new NullGbpDataProvider());

    const result = await agent.manageProfile(makeRequest());

    expect(result.dataAvailable).toBe(false);
    expect(result.napConsistency).toEqual({ isConsistent: null, discrepancies: [] });
    expect(result.observedCategories).toBeNull();
    expect(result.reviewManagement).toEqual({ totalReviews: 0, averageRating: null, reviewsNeedingResponse: [] });
    expect(result.googlePostsPlan.length).toBeGreaterThan(0);
    expect(result.recommendations.some((r) => r.category === "citation")).toBe(true);
    expect(result.limitations.some((l) => l.includes('using "none-configured"'))).toBe(true);
    expect(await readEventTypes(auditLogPath)).toEqual(["gbp_requested", "gbp_completed"]);
  });

  it("produces real NAP/review/performance reports when the provider supplies real data", async () => {
    const snapshot: GbpSnapshot = {
      nap: { name: "Acme Plumbing", address: "999 Wrong St", phone: "555-1234" },
      categoryInfo: { primaryCategory: "Plumber", secondaryCategories: [] },
      reviews: [
        { reviewId: "r1", rating: 1, text: "Bad", hasOwnerResponse: false, postedAt: new Date().toISOString() },
      ],
      localSearchPerformance: { searchViews: 400, mapViews: 100, callClicks: 10, directionRequests: 5, previousSearchViews: 500 },
      source: "fixed-test-provider",
      retrievedAt: new Date().toISOString(),
    };
    const { agent, auditLogPath } = buildAgent(new FixedGbpDataProvider(snapshot));

    const result = await agent.manageProfile(makeRequest());

    expect(result.dataAvailable).toBe(true);
    expect(result.napConsistency.isConsistent).toBe(false);
    expect(result.observedCategories).toEqual({ primaryCategory: "Plumber", secondaryCategories: [] });
    expect(result.reviewManagement.reviewsNeedingResponse).toHaveLength(1);
    expect(result.localPerformance.trend).toBe("declining");
    expect(result.recommendations.some((r) => r.category === "nap")).toBe(true);
    expect(result.recommendations.some((r) => r.category === "review")).toBe(true);
    expect(result.recommendations.some((r) => r.category === "performance")).toBe(true);
    expect(await readEventTypes(auditLogPath)).toEqual(["gbp_requested", "gbp_completed"]);
  });

  it("throws and audit-logs validation failures without producing a result", async () => {
    const { agent, auditLogPath } = buildAgent(new NullGbpDataProvider());

    await expect(agent.manageProfile(makeRequest({ businessName: "   " }))).rejects.toThrow();

    expect(await readEventTypes(auditLogPath)).toEqual(["gbp_validation_failed"]);
  });

  it("escalates a policy-risk signal and proceeds when a human approves", async () => {
    const approvingDecision: ApprovalDecision = {
      requestId: "unused",
      outcome: "candidate_selected",
      selectedCandidateId: "proceed",
      notes: "Proceed anyway.",
      decidedAt: new Date().toISOString(),
    };
    const { agent, auditLogPath } = buildAgent(new NullGbpDataProvider(), approvingDecision);

    const result = await agent.manageProfile(makeRequest({ localSeoStrategy: "Consider fake reviews to boost rating." }));

    expect(result.requestId).toBe("req-1");
    expect(await readEventTypes(auditLogPath)).toEqual([
      "gbp_requested",
      "gbp_escalated",
      "gbp_escalation_resolved",
      "gbp_completed",
    ]);
  });

  it("rejects when a human declines the policy-risk escalation", async () => {
    const { agent, auditLogPath } = buildAgent(new NullGbpDataProvider(), REJECTING_DECISION);

    await expect(
      agent.manageProfile(makeRequest({ localSeoStrategy: "Consider fake reviews to boost rating." })),
    ).rejects.toThrow(/policy-risk signals/);

    expect(await readEventTypes(auditLogPath)).toEqual([
      "gbp_requested",
      "gbp_escalated",
      "gbp_escalation_resolved",
      "gbp_rejected",
    ]);
  });
});
