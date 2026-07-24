import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { OnPageSeoAgent } from "../../../src/agents/on-page-seo-agent/on-page-seo-agent.js";
import { OnPageSeoRequestValidator } from "../../../src/agents/on-page-seo-agent/validation/on-page-seo-request-validator.js";
import { TitleMetaRecommender } from "../../../src/agents/on-page-seo-agent/recommendations/title-meta-recommender.js";
import { HeadingRecommender } from "../../../src/agents/on-page-seo-agent/recommendations/heading-recommender.js";
import { CanonicalRecommender } from "../../../src/agents/on-page-seo-agent/recommendations/canonical-recommender.js";
import { OnPageInternalLinkRecommender } from "../../../src/agents/on-page-seo-agent/recommendations/internal-link-recommender.js";
import { ImageAltRecommender } from "../../../src/agents/on-page-seo-agent/recommendations/image-alt-recommender.js";
import { StructuredDataRecommender } from "../../../src/agents/on-page-seo-agent/recommendations/structured-data-recommender.js";
import { KeywordUsageRecommender } from "../../../src/agents/on-page-seo-agent/recommendations/keyword-usage-recommender.js";
import { CrossFunctionalNotesBuilder } from "../../../src/agents/on-page-seo-agent/recommendations/cross-functional-notes-builder.js";
import { AuditLogger } from "../../../src/core/governance/audit-logger.js";
import type { ApprovalChannel } from "../../../src/core/governance/approval-channel.js";
import type { ApprovalDecision } from "../../../src/core/types/approval.types.js";
import type { OnPageSeoRequest } from "../../../src/agents/on-page-seo-agent/types/on-page-seo-request.types.js";
import type { KeywordResearchResult } from "../../../src/agents/keyword-research-agent/types/keyword-request.types.js";
import type { WebsiteAuditResult, AuditFinding } from "../../../src/agents/website-audit-agent/types/website-audit-request.types.js";

function makeKeywordResearch(overrides: Partial<KeywordResearchResult> = {}): KeywordResearchResult {
  return {
    requestId: "kw-1",
    classifiedKeywords: [
      { keyword: "plumber near me", intent: "informational", intentRationale: "default", metrics: null },
    ],
    topicClusters: [],
    metricsAvailable: false,
    limitations: ["No keyword data provider is configured."],
    rankingDisclaimer: "No guarantee.",
    decidedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeWebsiteAudit(findings: AuditFinding[], overrides: Partial<WebsiteAuditResult> = {}): WebsiteAuditResult {
  return {
    requestId: "wa-1",
    url: "https://example.com/services",
    findings,
    summary: {
      criticalCount: findings.filter((f) => f.severity === "critical").length,
      warningCount: findings.filter((f) => f.severity === "warning").length,
      infoCount: findings.filter((f) => f.severity === "info").length,
    },
    limitations: ["Structural audit only."],
    decidedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeRequest(overrides: Partial<OnPageSeoRequest> = {}): OnPageSeoRequest {
  return {
    id: "req-1",
    websiteAudit: makeWebsiteAudit([
      { category: "metadata", severity: "critical", message: "No <title> tag was found.", recommendation: "x" },
      { category: "crawlability", severity: "critical", message: "noindex found.", recommendation: "x" },
    ]),
    keywordResearch: makeKeywordResearch(),
    targetKeyword: "plumber near me",
    ...overrides,
  };
}

function makeApprovalChannel(decision: ApprovalDecision): ApprovalChannel {
  return { requestDecision: async () => decision };
}

const REJECTING_DECISION: ApprovalDecision = {
  requestId: "unused",
  outcome: "rejected",
  notes: "should not be called",
  decidedAt: new Date().toISOString(),
};

describe("OnPageSeoAgent", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "on-page-seo-agent-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  function buildAgent(approvalDecision: ApprovalDecision) {
    const auditLogPath = join(dir, "audit-log.jsonl");
    const agent = new OnPageSeoAgent(
      new OnPageSeoRequestValidator(),
      [
        new TitleMetaRecommender(),
        new HeadingRecommender(),
        new CanonicalRecommender(),
        new OnPageInternalLinkRecommender(),
        new ImageAltRecommender(),
        new StructuredDataRecommender(),
        new KeywordUsageRecommender(),
      ],
      new CrossFunctionalNotesBuilder(),
      makeApprovalChannel(approvalDecision),
      new AuditLogger(auditLogPath),
    );
    return { agent, auditLogPath };
  }

  async function readEventTypes(auditLogPath: string): Promise<string[]> {
    const lines = (await readFile(auditLogPath, "utf8")).trim().split("\n");
    return lines.map((line) => JSON.parse(line).eventType);
  }

  it("produces recommendations tied to real audit findings and carries forward upstream limitations", async () => {
    const { agent, auditLogPath } = buildAgent(REJECTING_DECISION);

    const result = await agent.generateRecommendations(makeRequest());

    expect(result.recommendations.some((r) => r.category === "title-tag")).toBe(true);
    expect(result.limitations).toEqual(
      expect.arrayContaining(["No keyword data provider is configured.", "Structural audit only."]),
    );

    expect(await readEventTypes(auditLogPath)).toEqual(["on_page_seo_requested", "on_page_seo_completed"]);
  });

  it("surfaces out-of-scope critical findings as cross-functional notes, not as recommendations it tries to fix", async () => {
    const { agent } = buildAgent(REJECTING_DECISION);

    const result = await agent.generateRecommendations(makeRequest());

    expect(result.crossFunctionalNotes.some((n) => n.includes("crawlability"))).toBe(true);
    expect(result.crossFunctionalNotes.some((n) => n.includes("Technical SEO Agent"))).toBe(true);
    expect(result.recommendations.some((r) => r.category === "crawlability")).toBe(false);
  });

  it("throws and audit-logs validation failures without producing a result", async () => {
    const { agent, auditLogPath } = buildAgent(REJECTING_DECISION);

    await expect(
      agent.generateRecommendations(makeRequest({ targetKeyword: "unrelated" })),
    ).rejects.toThrow();

    expect(await readEventTypes(auditLogPath)).toEqual(["on_page_seo_validation_failed"]);
  });

  it("escalates policy-risk signals and proceeds when a human approves", async () => {
    const approvingDecision: ApprovalDecision = {
      requestId: "unused",
      outcome: "candidate_selected",
      selectedCandidateId: "proceed",
      notes: "Reviewed, acceptable.",
      decidedAt: new Date().toISOString(),
    };
    const { agent, auditLogPath } = buildAgent(approvingDecision);

    const result = await agent.generateRecommendations(
      makeRequest({
        keywordResearch: makeKeywordResearch({
          classifiedKeywords: [
            { keyword: "keyword stuffing", intent: "informational", intentRationale: "x", metrics: null },
          ],
        }),
        targetKeyword: "keyword stuffing",
      }),
    );

    expect(result.requestId).toBe("req-1");
    expect(await readEventTypes(auditLogPath)).toEqual([
      "on_page_seo_requested",
      "on_page_seo_escalated",
      "on_page_seo_escalation_resolved",
      "on_page_seo_completed",
    ]);
  });

  it("rejects the request when a human declines a policy-risk escalation", async () => {
    const { agent, auditLogPath } = buildAgent(REJECTING_DECISION);

    await expect(
      agent.generateRecommendations(
        makeRequest({
          keywordResearch: makeKeywordResearch({
            classifiedKeywords: [
              { keyword: "keyword stuffing", intent: "informational", intentRationale: "x", metrics: null },
            ],
          }),
          targetKeyword: "keyword stuffing",
        }),
      ),
    ).rejects.toThrow(/rejected by human review/);

    expect(await readEventTypes(auditLogPath)).toEqual([
      "on_page_seo_requested",
      "on_page_seo_escalated",
      "on_page_seo_escalation_resolved",
      "on_page_seo_rejected",
    ]);
  });
});
