import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { KeywordResearchAgent } from "../../../src/agents/keyword-research-agent/keyword-research-agent.js";
import { KeywordRequestValidator } from "../../../src/agents/keyword-research-agent/validation/keyword-request-validator.js";
import { SearchIntentClassifier } from "../../../src/agents/keyword-research-agent/intent/search-intent-classifier.js";
import { TopicClusterBuilder } from "../../../src/agents/keyword-research-agent/clustering/topic-cluster-builder.js";
import { NullKeywordDataProvider } from "../../../src/agents/keyword-research-agent/providers/null-keyword-data-provider.js";
import { AuditLogger } from "../../../src/core/governance/audit-logger.js";
import type { ApprovalChannel } from "../../../src/core/governance/approval-channel.js";
import type { ApprovalDecision } from "../../../src/core/types/approval.types.js";
import type {
  KeywordDataProvider,
  KeywordMetrics,
  KeywordMetricsRequest,
} from "../../../src/agents/keyword-research-agent/types/keyword-data-provider.types.js";
import type { KeywordResearchRequest } from "../../../src/agents/keyword-research-agent/types/keyword-request.types.js";

function makeApprovalChannel(decision: ApprovalDecision): ApprovalChannel {
  return { requestDecision: async () => decision };
}

/** Returns real metrics for one keyword and throws for another, to prove partial-failure tolerance. */
class PartiallyFailingProvider implements KeywordDataProvider {
  readonly name = "fixture-provider";

  async fetchMetrics(request: KeywordMetricsRequest): Promise<KeywordMetrics | null> {
    if (request.keyword === "plumber near me") {
      return {
        keyword: request.keyword,
        searchVolume: 1200,
        difficulty: 42,
        source: this.name,
        retrievedAt: new Date().toISOString(),
      };
    }
    throw new Error("simulated provider outage");
  }
}

function makeRequest(overrides: Partial<KeywordResearchRequest> = {}): KeywordResearchRequest {
  return {
    id: "req-1",
    businessObjective: "Grow organic traffic for a home services website.",
    seedKeywords: ["plumber near me", "emergency plumbing"],
    ...overrides,
  };
}

describe("KeywordResearchAgent", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "keyword-research-agent-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  function buildAgent(approvalDecision: ApprovalDecision, dataProvider: KeywordDataProvider = new NullKeywordDataProvider()) {
    const auditLogPath = join(dir, "audit-log.jsonl");
    const agent = new KeywordResearchAgent(
      new KeywordRequestValidator(),
      new SearchIntentClassifier(),
      new TopicClusterBuilder(),
      dataProvider,
      makeApprovalChannel(approvalDecision),
      new AuditLogger(auditLogPath),
    );
    return { agent, auditLogPath };
  }

  async function readEventTypes(auditLogPath: string): Promise<string[]> {
    const lines = (await readFile(auditLogPath, "utf8")).trim().split("\n");
    return lines.map((line) => JSON.parse(line).eventType);
  }

  const REJECTING_DECISION: ApprovalDecision = {
    requestId: "unused",
    outcome: "rejected",
    notes: "should not be called",
    decidedAt: new Date().toISOString(),
  };

  it("produces a result with no fabricated metrics when no data provider is configured", async () => {
    const { agent, auditLogPath } = buildAgent(REJECTING_DECISION);

    const result = await agent.researchKeywords(makeRequest());

    expect(result.metricsAvailable).toBe(false);
    expect(result.classifiedKeywords.every((k) => k.metrics === null)).toBe(true);
    expect(result.limitations.some((l) => l.includes("No keyword data provider is configured"))).toBe(true);
    expect(result.rankingDisclaimer).toContain("does not guarantee search rankings");

    expect(await readEventTypes(auditLogPath)).toEqual(["keyword_research_requested", "keyword_research_completed"]);
  });

  it("classifies every seed keyword's search intent with a rationale", async () => {
    const { agent } = buildAgent(REJECTING_DECISION);

    const result = await agent.researchKeywords(
      makeRequest({ seedKeywords: ["buy plumbing supplies", "how to fix a leaky faucet"] }),
    );

    const transactional = result.classifiedKeywords.find((k) => k.keyword === "buy plumbing supplies");
    const informational = result.classifiedKeywords.find((k) => k.keyword === "how to fix a leaky faucet");
    expect(transactional?.intent).toBe("transactional");
    expect(informational?.intent).toBe("informational");
    expect(transactional?.intentRationale).toBeTruthy();
  });

  it("throws and audit-logs validation failures without producing a result", async () => {
    const { agent, auditLogPath } = buildAgent(REJECTING_DECISION);

    await expect(agent.researchKeywords(makeRequest({ seedKeywords: [] }))).rejects.toThrow();

    expect(await readEventTypes(auditLogPath)).toEqual(["keyword_research_validation_failed"]);
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

    const result = await agent.researchKeywords(
      makeRequest({ seedKeywords: ["keyword stuffing tactics"] }),
    );

    expect(result.classifiedKeywords).toHaveLength(1);
    expect(await readEventTypes(auditLogPath)).toEqual([
      "keyword_research_requested",
      "keyword_research_escalated",
      "keyword_research_escalation_resolved",
      "keyword_research_completed",
    ]);
  });

  it("rejects the request when a human declines a policy-risk escalation", async () => {
    const { agent, auditLogPath } = buildAgent(REJECTING_DECISION);

    await expect(
      agent.researchKeywords(makeRequest({ seedKeywords: ["keyword stuffing tactics"] })),
    ).rejects.toThrow(/rejected by human review/);

    expect(await readEventTypes(auditLogPath)).toEqual([
      "keyword_research_requested",
      "keyword_research_escalated",
      "keyword_research_escalation_resolved",
      "keyword_research_rejected",
    ]);
  });

  it("tolerates a per-keyword provider failure without failing the whole request", async () => {
    const { agent } = buildAgent(REJECTING_DECISION, new PartiallyFailingProvider());

    const result = await agent.researchKeywords(makeRequest());

    expect(result.metricsAvailable).toBe(true);
    const succeeded = result.classifiedKeywords.find((k) => k.keyword === "plumber near me");
    const failed = result.classifiedKeywords.find((k) => k.keyword === "emergency plumbing");
    expect(succeeded?.metrics?.searchVolume).toBe(1200);
    expect(failed?.metrics).toBeNull();
    expect(result.limitations.some((l) => l.includes('Metrics lookup failed for "emergency plumbing"'))).toBe(
      true,
    );
    expect(result.limitations.some((l) => l.includes("No keyword data provider is configured"))).toBe(false);
  });
});
