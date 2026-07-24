import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ON_PAGE_SEO_AGENT_ID,
  isOnPageSeoAssignment,
} from "../../../src/agents/on-page-seo-agent/dispatch.js";
import { OnPageSeoAgent } from "../../../src/agents/on-page-seo-agent/on-page-seo-agent.js";
import { OnPageSeoRequestValidator } from "../../../src/agents/on-page-seo-agent/validation/on-page-seo-request-validator.js";
import { TitleMetaRecommender } from "../../../src/agents/on-page-seo-agent/recommendations/title-meta-recommender.js";
import { CrossFunctionalNotesBuilder } from "../../../src/agents/on-page-seo-agent/recommendations/cross-functional-notes-builder.js";
import { AuditLogger } from "../../../src/core/governance/audit-logger.js";
import type { ApprovalChannel } from "../../../src/core/governance/approval-channel.js";
import type { RoutingDecision } from "../../../src/boss-agent/types/routing.types.js";
import type { KeywordResearchResult } from "../../../src/agents/keyword-research-agent/types/keyword-request.types.js";
import type { WebsiteAuditResult } from "../../../src/agents/website-audit-agent/types/website-audit-request.types.js";

function makeDecision(overrides: Partial<RoutingDecision> = {}): RoutingDecision {
  return {
    taskId: "task-1",
    status: "assigned",
    assignedAgentId: ON_PAGE_SEO_AGENT_ID,
    candidates: [],
    rationale: "Matched.",
    decidedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("isOnPageSeoAssignment", () => {
  it("is true when the decision is assigned to the on-page seo agent", () => {
    expect(isOnPageSeoAssignment(makeDecision())).toBe(true);
  });

  it("is false when assigned to a different agent", () => {
    expect(isOnPageSeoAssignment(makeDecision({ assignedAgentId: "website-audit-agent" }))).toBe(false);
  });

  it("is false when the decision was rejected", () => {
    expect(
      isOnPageSeoAssignment({
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
    dir = await mkdtemp(join(tmpdir(), "on-page-seo-dispatch-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("carries the same id from RoutingDecision.taskId through to OnPageSeoResult.requestId", async () => {
    const decision = makeDecision({ taskId: "boss-agent-task-5" });
    expect(isOnPageSeoAssignment(decision)).toBe(true);

    const approvalChannel: ApprovalChannel = {
      requestDecision: async () => {
        throw new Error("should not be called for a clean request");
      },
    };
    const agent = new OnPageSeoAgent(
      new OnPageSeoRequestValidator(),
      [new TitleMetaRecommender()],
      new CrossFunctionalNotesBuilder(),
      approvalChannel,
      new AuditLogger(join(dir, "audit-log.jsonl")),
    );

    const keywordResearch: KeywordResearchResult = {
      requestId: "kw-1",
      classifiedKeywords: [{ keyword: "plumber", intent: "informational", intentRationale: "x", metrics: null }],
      topicClusters: [],
      metricsAvailable: false,
      limitations: [],
      rankingDisclaimer: "No guarantee.",
      decidedAt: new Date().toISOString(),
    };
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
      keywordResearch,
      targetKeyword: "plumber",
    });

    expect(result.requestId).toBe("boss-agent-task-5");
  });
});
