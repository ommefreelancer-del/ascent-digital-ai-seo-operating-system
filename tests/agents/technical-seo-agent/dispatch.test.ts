import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  TECHNICAL_SEO_AGENT_ID,
  isTechnicalSeoAssignment,
} from "../../../src/agents/technical-seo-agent/dispatch.js";
import { TechnicalSeoAgent } from "../../../src/agents/technical-seo-agent/technical-seo-agent.js";
import { TechnicalSeoRequestValidator } from "../../../src/agents/technical-seo-agent/validation/technical-seo-request-validator.js";
import { CrawlabilityRecommender } from "../../../src/agents/technical-seo-agent/recommendations/crawlability-recommender.js";
import { AuditLogger } from "../../../src/core/governance/audit-logger.js";
import type { ApprovalChannel } from "../../../src/core/governance/approval-channel.js";
import type { RoutingDecision } from "../../../src/boss-agent/types/routing.types.js";
import type { WebsiteAuditResult } from "../../../src/agents/website-audit-agent/types/website-audit-request.types.js";

function makeDecision(overrides: Partial<RoutingDecision> = {}): RoutingDecision {
  return {
    taskId: "task-1",
    status: "assigned",
    assignedAgentId: TECHNICAL_SEO_AGENT_ID,
    candidates: [],
    rationale: "Matched.",
    decidedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("isTechnicalSeoAssignment", () => {
  it("is true when the decision is assigned to the technical seo agent", () => {
    expect(isTechnicalSeoAssignment(makeDecision())).toBe(true);
  });

  it("is false when assigned to a different agent", () => {
    expect(isTechnicalSeoAssignment(makeDecision({ assignedAgentId: "on-page-seo-agent" }))).toBe(false);
  });

  it("is false when the decision was rejected", () => {
    expect(
      isTechnicalSeoAssignment({
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
    dir = await mkdtemp(join(tmpdir(), "technical-seo-dispatch-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("carries the same id from RoutingDecision.taskId through to TechnicalSeoResult.requestId", async () => {
    const decision = makeDecision({ taskId: "boss-agent-task-9" });
    expect(isTechnicalSeoAssignment(decision)).toBe(true);

    const approvalChannel: ApprovalChannel = {
      requestDecision: async () => {
        throw new Error("should not be called for a clean request");
      },
    };
    const agent = new TechnicalSeoAgent(
      new TechnicalSeoRequestValidator(),
      [new CrawlabilityRecommender()],
      approvalChannel,
      new AuditLogger(join(dir, "audit-log.jsonl")),
    );

    const websiteAudit: WebsiteAuditResult = {
      requestId: "wa-1",
      url: "https://example.com/page",
      findings: [],
      summary: { criticalCount: 0, warningCount: 0, infoCount: 0 },
      limitations: [],
      decidedAt: new Date().toISOString(),
    };

    const result = await agent.generateRecommendations({
      id: decision.taskId,
      websiteAudit,
      crossFunctionalNotes: [],
    });

    expect(result.requestId).toBe("boss-agent-task-9");
  });
});
