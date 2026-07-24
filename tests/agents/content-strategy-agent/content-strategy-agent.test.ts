import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ContentStrategyAgent } from "../../../src/agents/content-strategy-agent/content-strategy-agent.js";
import { ContentStrategyRequestValidator } from "../../../src/agents/content-strategy-agent/validation/content-strategy-request-validator.js";
import { ContentTopicClusterBuilder } from "../../../src/agents/content-strategy-agent/clustering/content-topic-cluster-builder.js";
import { PillarStrategyBuilder } from "../../../src/agents/content-strategy-agent/planning/pillar-strategy-builder.js";
import { InternalLinkingRecommender } from "../../../src/agents/content-strategy-agent/planning/internal-linking-recommender.js";
import { EditorialCalendarScheduler } from "../../../src/agents/content-strategy-agent/planning/editorial-calendar-scheduler.js";
import { ContentGapAnalyzer } from "../../../src/agents/content-strategy-agent/planning/content-gap-analyzer.js";
import { ContentBriefBuilder } from "../../../src/agents/content-strategy-agent/planning/content-brief-builder.js";
import { AuditLogger } from "../../../src/core/governance/audit-logger.js";
import type { ApprovalChannel } from "../../../src/core/governance/approval-channel.js";
import type { ApprovalDecision } from "../../../src/core/types/approval.types.js";
import type { ContentStrategyRequest } from "../../../src/agents/content-strategy-agent/types/content-strategy-request.types.js";
import type { KeywordResearchResult } from "../../../src/agents/keyword-research-agent/types/keyword-request.types.js";

function makeApprovalChannel(decision: ApprovalDecision): ApprovalChannel {
  return { requestDecision: async () => decision };
}

function makeKeywordResearch(overrides: Partial<KeywordResearchResult> = {}): KeywordResearchResult {
  return {
    requestId: "kw-req-1",
    classifiedKeywords: [
      { keyword: "plumber", intent: "informational", intentRationale: "default", metrics: null },
      { keyword: "emergency plumber", intent: "informational", intentRationale: "default", metrics: null },
      { keyword: "buy plumbing supplies", intent: "transactional", intentRationale: "matched buy", metrics: null },
    ],
    topicClusters: [
      { label: "plumber", keywords: ["plumber", "emergency plumber"] },
      { label: "buy plumbing supplies", keywords: ["buy plumbing supplies"] },
    ],
    metricsAvailable: false,
    limitations: ["No keyword data provider is configured; metrics are unavailable."],
    rankingDisclaimer: "No guarantee of rankings or traffic.",
    decidedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeRequest(overrides: Partial<ContentStrategyRequest> = {}): ContentStrategyRequest {
  return {
    id: "req-1",
    businessObjective: "Grow organic traffic for a home services website.",
    keywordResearch: makeKeywordResearch(),
    calendarStartDate: "2026-01-01T00:00:00.000Z",
    articlesPerWeek: 7,
    ...overrides,
  };
}

const REJECTING_DECISION: ApprovalDecision = {
  requestId: "unused",
  outcome: "rejected",
  notes: "should not be called",
  decidedAt: new Date().toISOString(),
};

describe("ContentStrategyAgent", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "content-strategy-agent-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  function buildAgent(approvalDecision: ApprovalDecision) {
    const auditLogPath = join(dir, "audit-log.jsonl");
    const agent = new ContentStrategyAgent(
      new ContentStrategyRequestValidator(),
      new ContentTopicClusterBuilder(),
      new PillarStrategyBuilder(),
      new InternalLinkingRecommender(),
      new EditorialCalendarScheduler(),
      new ContentGapAnalyzer(),
      new ContentBriefBuilder(),
      makeApprovalChannel(approvalDecision),
      new AuditLogger(auditLogPath),
    );
    return { agent, auditLogPath };
  }

  async function readEventTypes(auditLogPath: string): Promise<string[]> {
    const lines = (await readFile(auditLogPath, "utf8")).trim().split("\n");
    return lines.map((line) => JSON.parse(line).eventType);
  }

  it("produces a full strategy carrying forward upstream limitations, with no fabricated metrics", async () => {
    const { agent, auditLogPath } = buildAgent(REJECTING_DECISION);

    const result = await agent.developStrategy(makeRequest());

    expect(result.topicClusters).toHaveLength(2);
    expect(result.pillarPageStrategy.length).toBeGreaterThan(0);
    expect(result.internalLinkingRecommendations.length).toBeGreaterThan(0);
    expect(result.editorialCalendar.length).toBeGreaterThan(0);
    expect(result.contentBriefs.length).toBeGreaterThan(0);
    expect(result.limitations).toEqual(
      expect.arrayContaining(["No keyword data provider is configured; metrics are unavailable."]),
    );

    expect(await readEventTypes(auditLogPath)).toEqual([
      "content_strategy_requested",
      "content_strategy_completed",
    ]);
  });

  it("defaults to treating every cluster as a content gap when no inventory is supplied", async () => {
    const { agent } = buildAgent(REJECTING_DECISION);

    const result = await agent.developStrategy(makeRequest());

    expect(result.contentGaps).toHaveLength(2);
    expect(result.limitations.some((l) => l.includes("No existingContentInventory was supplied"))).toBe(true);
  });

  it("excludes covered topics from content gaps when an inventory is supplied", async () => {
    const { agent } = buildAgent(REJECTING_DECISION);

    const result = await agent.developStrategy(
      makeRequest({ existingContentInventory: ["The Ultimate Plumber Guide"] }),
    );

    expect(result.contentGaps.map((g) => g.clusterLabel)).toEqual(["buy plumbing supplies"]);
  });

  it("throws and audit-logs validation failures without producing a result", async () => {
    const { agent, auditLogPath } = buildAgent(REJECTING_DECISION);

    await expect(
      agent.developStrategy(makeRequest({ businessObjective: "   " })),
    ).rejects.toThrow();

    expect(await readEventTypes(auditLogPath)).toEqual(["content_strategy_validation_failed"]);
  });

  it("escalates policy-risk signals and proceeds when a human approves", async () => {
    const approvingDecision: ApprovalDecision = {
      requestId: "unused",
      outcome: "candidate_selected",
      selectedCandidateId: "proceed",
      notes: "Reviewed, acceptable to proceed.",
      decidedAt: new Date().toISOString(),
    };
    const { agent, auditLogPath } = buildAgent(approvingDecision);

    const result = await agent.developStrategy(
      makeRequest({ businessObjective: "Use keyword stuffing to grow rankings fast." }),
    );

    expect(result.requestId).toBe("req-1");
    expect(await readEventTypes(auditLogPath)).toEqual([
      "content_strategy_requested",
      "content_strategy_escalated",
      "content_strategy_escalation_resolved",
      "content_strategy_completed",
    ]);
  });

  it("rejects the request when a human declines a policy-risk escalation", async () => {
    const { agent, auditLogPath } = buildAgent(REJECTING_DECISION);

    await expect(
      agent.developStrategy(makeRequest({ businessObjective: "Use keyword stuffing to grow rankings fast." })),
    ).rejects.toThrow(/rejected by human review/);

    expect(await readEventTypes(auditLogPath)).toEqual([
      "content_strategy_requested",
      "content_strategy_escalated",
      "content_strategy_escalation_resolved",
      "content_strategy_rejected",
    ]);
  });
});
