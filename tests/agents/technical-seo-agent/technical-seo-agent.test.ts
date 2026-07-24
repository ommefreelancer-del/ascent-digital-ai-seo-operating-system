import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TechnicalSeoAgent } from "../../../src/agents/technical-seo-agent/technical-seo-agent.js";
import { TechnicalSeoRequestValidator } from "../../../src/agents/technical-seo-agent/validation/technical-seo-request-validator.js";
import { CrawlabilityRecommender } from "../../../src/agents/technical-seo-agent/recommendations/crawlability-recommender.js";
import { RobotsTxtRecommender } from "../../../src/agents/technical-seo-agent/recommendations/robots-txt-recommender.js";
import { HttpsRecommender } from "../../../src/agents/technical-seo-agent/recommendations/https-recommender.js";
import { PageStructureRecommender } from "../../../src/agents/technical-seo-agent/recommendations/page-structure-recommender.js";
import { CrossFunctionalNotesBuilder } from "../../../src/agents/on-page-seo-agent/recommendations/cross-functional-notes-builder.js";
import { AuditLogger } from "../../../src/core/governance/audit-logger.js";
import type { ApprovalChannel } from "../../../src/core/governance/approval-channel.js";
import type { ApprovalDecision } from "../../../src/core/types/approval.types.js";
import type { TechnicalSeoRequest } from "../../../src/agents/technical-seo-agent/types/technical-seo-request.types.js";
import type { AuditFinding, WebsiteAuditResult } from "../../../src/agents/website-audit-agent/types/website-audit-request.types.js";

const NOTES_BUILDER = new CrossFunctionalNotesBuilder();

function makeWebsiteAudit(findings: AuditFinding[]): WebsiteAuditResult {
  return {
    requestId: "wa-1",
    url: "http://example.com/page",
    findings,
    summary: {
      criticalCount: findings.filter((f) => f.severity === "critical").length,
      warningCount: findings.filter((f) => f.severity === "warning").length,
      infoCount: findings.filter((f) => f.severity === "info").length,
    },
    limitations: ["Structural audit only."],
    decidedAt: new Date().toISOString(),
  };
}

function notesFor(websiteAudit: WebsiteAuditResult): string[] {
  return NOTES_BUILDER.build({ websiteAudit, targetKeyword: "x", intent: "informational" });
}

function makeRequest(overrides: Partial<TechnicalSeoRequest> = {}): TechnicalSeoRequest {
  const websiteAudit = makeWebsiteAudit([
    { category: "technical-seo", severity: "critical", message: 'The audited URL uses "http://" rather than "https://".', recommendation: "x" },
  ]);
  return {
    id: "req-1",
    websiteAudit,
    crossFunctionalNotes: notesFor(websiteAudit),
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

describe("TechnicalSeoAgent", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "technical-seo-agent-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  function buildAgent(approvalDecision: ApprovalDecision) {
    const auditLogPath = join(dir, "audit-log.jsonl");
    const agent = new TechnicalSeoAgent(
      new TechnicalSeoRequestValidator(),
      [
        new CrawlabilityRecommender(),
        new RobotsTxtRecommender(),
        new HttpsRecommender(),
        new PageStructureRecommender(),
      ],
      makeApprovalChannel(approvalDecision),
      new AuditLogger(auditLogPath),
    );
    return { agent, auditLogPath };
  }

  async function readEventTypes(auditLogPath: string): Promise<string[]> {
    const lines = (await readFile(auditLogPath, "utf8")).trim().split("\n");
    return lines.map((line) => JSON.parse(line).eventType);
  }

  it("produces recommendations tied to real findings, marked as confirmed by the cross-functional note", async () => {
    const { agent, auditLogPath } = buildAgent(REJECTING_DECISION);

    const result = await agent.generateRecommendations(makeRequest());

    expect(result.recommendations).toHaveLength(1);
    expect(result.recommendations[0]?.category).toBe("https");
    expect(result.recommendations[0]?.confirmedByCrossFunctionalNote).toBe(true);
    expect(result.limitations).toEqual(
      expect.arrayContaining(["Structural audit only."]),
    );
    expect(result.limitations.some((l) => l.includes("Core Web Vitals"))).toBe(true);

    expect(await readEventTypes(auditLogPath)).toEqual(["technical_seo_requested", "technical_seo_completed"]);
  });

  it("throws and audit-logs validation failures without producing a result", async () => {
    const { agent, auditLogPath } = buildAgent(REJECTING_DECISION);

    await expect(
      agent.generateRecommendations(makeRequest({ crossFunctionalNotes: ["not a real note"] })),
    ).rejects.toThrow();

    expect(await readEventTypes(auditLogPath)).toEqual(["technical_seo_validation_failed"]);
  });

  it("escalates a double-blocked page and proceeds when a human approves", async () => {
    const approvingDecision: ApprovalDecision = {
      requestId: "unused",
      outcome: "candidate_selected",
      selectedCandidateId: "proceed",
      notes: "Confirmed, this page should be indexable.",
      decidedAt: new Date().toISOString(),
    };
    const { agent, auditLogPath } = buildAgent(approvingDecision);

    const websiteAudit = makeWebsiteAudit([
      { category: "crawlability", severity: "critical", message: "noindex found.", recommendation: "x" },
      { category: "robots-txt", severity: "critical", message: 'Disallow: /page blocks this URL.', recommendation: "x" },
    ]);

    const result = await agent.generateRecommendations({
      id: "req-2",
      websiteAudit,
      crossFunctionalNotes: notesFor(websiteAudit),
    });

    expect(result.recommendations.some((r) => r.category === "crawlability")).toBe(true);
    expect(result.recommendations.some((r) => r.category === "robots-txt")).toBe(true);
    expect(await readEventTypes(auditLogPath)).toEqual([
      "technical_seo_requested",
      "technical_seo_escalated",
      "technical_seo_escalation_resolved",
      "technical_seo_completed",
    ]);
  });

  it("rejects when a human declines the double-blocked escalation", async () => {
    const { agent, auditLogPath } = buildAgent(REJECTING_DECISION);

    const websiteAudit = makeWebsiteAudit([
      { category: "crawlability", severity: "critical", message: "noindex found.", recommendation: "x" },
      { category: "robots-txt", severity: "critical", message: "Disallow: /page blocks this URL.", recommendation: "x" },
    ]);

    await expect(
      agent.generateRecommendations({ id: "req-2", websiteAudit, crossFunctionalNotes: notesFor(websiteAudit) }),
    ).rejects.toThrow(/blocked from indexing by two independent mechanisms/);

    expect(await readEventTypes(auditLogPath)).toEqual([
      "technical_seo_requested",
      "technical_seo_escalated",
      "technical_seo_escalation_resolved",
      "technical_seo_rejected",
    ]);
  });
});
