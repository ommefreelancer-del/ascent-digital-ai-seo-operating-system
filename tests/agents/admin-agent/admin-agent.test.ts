import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AdminAgent } from "../../../src/agents/admin-agent/admin-agent.js";
import { AdminRequestValidator } from "../../../src/agents/admin-agent/validation/admin-request-validator.js";
import { DocumentOrganizer } from "../../../src/agents/admin-agent/organizing/document-organizer.js";
import { SopReviewFlagBuilder } from "../../../src/agents/admin-agent/organizing/sop-review-flag-builder.js";
import { ProjectStatusReportBuilder } from "../../../src/agents/admin-agent/organizing/project-status-report-builder.js";
import { AdministrativeRecordBuilder } from "../../../src/agents/admin-agent/organizing/administrative-record-builder.js";
import { ComplianceChecklistBuilder } from "../../../src/agents/admin-agent/organizing/compliance-checklist-builder.js";
import { AuditLogger } from "../../../src/core/governance/audit-logger.js";
import type { ApprovalChannel } from "../../../src/core/governance/approval-channel.js";
import type { ApprovalDecision } from "../../../src/core/types/approval.types.js";
import type { AdminRequest } from "../../../src/agents/admin-agent/types/admin-request.types.js";
import type { AiCrmResult } from "../../../src/agents/ai-crm-agent/types/ai-crm-request.types.js";
import type { BusinessDevelopmentResult } from "../../../src/agents/business-development-agent/types/business-development-request.types.js";

function makeApprovalChannel(decision: ApprovalDecision): ApprovalChannel {
  return { requestDecision: async () => decision };
}

const REJECTING_DECISION: ApprovalDecision = {
  requestId: "unused",
  outcome: "rejected",
  notes: "should not be called",
  decidedAt: new Date().toISOString(),
};

function makeCrmData(overrides: Partial<AiCrmResult> = {}): AiCrmResult {
  return {
    requestId: "crm-1",
    dataAvailable: true,
    leadPipeline: [],
    followUpActivities: [],
    clientStatusReport: [{ clientName: "Acme Plumbing", status: "active retainer", activity: "active", lastContactedAt: "2026-07-01T00:00:00.000Z" }],
    campaignActivity: { campaignName: "Campaign", phase: "in-progress", draftedCount: 1, skippedCount: 0 },
    crmRecordUpdates: [{ recordType: "client", action: "update", identifier: "Acme Plumbing", summary: "x", requiresApproval: true }],
    limitations: ["CRM limitation."],
    decidedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeBusinessDevelopment(overrides: Partial<BusinessDevelopmentResult> = {}): BusinessDevelopmentResult {
  return {
    requestId: "bd-1",
    dataAvailable: true,
    qualifiedLeadReport: [{ domain: "example.com", stage: "negotiating", qualification: "qualified", notes: "x" }],
    salesPipelineSummary: { totalLeads: 1, qualifiedCount: 1, earlyStageCount: 0, notQualifiedCount: 0 },
    clientProposals: [{ domain: "example.com", subject: "x", body: "x", requiresApproval: true }],
    growthOpportunities: [{ category: "pipeline", description: "x", rationale: "x" }],
    partnershipRecommendations: [],
    limitations: ["Business development limitation."],
    decidedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeRequest(overrides: Partial<AdminRequest> = {}): AdminRequest {
  return {
    id: "req-1",
    crmData: makeCrmData(),
    businessDevelopment: makeBusinessDevelopment(),
    ...overrides,
  };
}

describe("AdminAgent", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "admin-agent-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  function buildAgent(approvalDecision: ApprovalDecision = REJECTING_DECISION) {
    const auditLogPath = join(dir, "audit-log.jsonl");
    const agent = new AdminAgent(
      new AdminRequestValidator(),
      new DocumentOrganizer(),
      new SopReviewFlagBuilder(),
      new ProjectStatusReportBuilder(),
      new AdministrativeRecordBuilder(),
      new ComplianceChecklistBuilder(),
      makeApprovalChannel(approvalDecision),
      new AuditLogger(auditLogPath),
    );
    return { agent, auditLogPath };
  }

  async function readEventTypes(auditLogPath: string): Promise<string[]> {
    const lines = (await readFile(auditLogPath, "utf8")).trim().split("\n");
    return lines.map((line) => JSON.parse(line).eventType);
  }

  it("produces real organized documentation, project status, administrative records, and a compliance checklist", async () => {
    const { agent, auditLogPath } = buildAgent();

    const result = await agent.manageAdmin(
      makeRequest({
        internalDocuments: [{ name: "Onboarding Checklist", category: "onboarding", lastUpdatedAt: "2026-07-01T00:00:00.000Z" }],
        projectUpdates: [{ projectName: "Acme Website Revamp", status: "in-progress", note: "On track." }],
        businessRequirements: "Keep administrative records accurate.",
      }),
    );

    expect(result.dataAvailable).toBe(true);
    expect(result.organizedDocumentation).toHaveLength(1);
    expect(result.projectStatusReport).toEqual([{ projectName: "Acme Website Revamp", status: "in-progress", note: "On track." }]);
    expect(result.administrativeRecords).toHaveLength(3);
    expect(result.complianceChecklist.every((item) => item.status === "met")).toBe(true);
    expect(await readEventTypes(auditLogPath)).toEqual(["admin_requested", "admin_completed"]);
  });

  it("mirrors real activity from either upstream result for dataAvailable", async () => {
    const { agent } = buildAgent();
    const result = await agent.manageAdmin(
      makeRequest({ crmData: makeCrmData({ dataAvailable: false }), businessDevelopment: makeBusinessDevelopment({ dataAvailable: false }) }),
    );
    expect(result.dataAvailable).toBe(false);
  });

  it("carries forward every upstream limitation plus its own standing and conditional disclaimers", async () => {
    const { agent } = buildAgent();
    const result = await agent.manageAdmin(
      makeRequest({ crmData: makeCrmData({ dataAvailable: false }), businessDevelopment: makeBusinessDevelopment({ dataAvailable: false }) }),
    );

    expect(result.limitations).toEqual(
      expect.arrayContaining([
        "CRM limitation.",
        "Business development limitation.",
        "No internal documents were supplied; organized documentation and SOP review flags are empty.",
        "No project updates were supplied; the project status report is empty.",
        "No team requests were supplied.",
      ]),
    );
    expect(result.limitations.some((l) => l.includes("never calls Notion"))).toBe(true);
    expect(result.limitations.some((l) => l.includes("No real CRM or business development activity"))).toBe(true);
  });

  it("throws and audit-logs validation failures without producing a result", async () => {
    const { agent, auditLogPath } = buildAgent();

    await expect(
      agent.manageAdmin(makeRequest({ teamRequests: [{ requestedBy: "Jordan", description: "   " }] })),
    ).rejects.toThrow();

    expect(await readEventTypes(auditLogPath)).toEqual(["admin_validation_failed"]);
  });

  it("escalates a destructive-action signal and proceeds when a human approves", async () => {
    const approvingDecision: ApprovalDecision = {
      requestId: "unused",
      outcome: "candidate_selected",
      selectedCandidateId: "proceed",
      notes: "Proceed anyway.",
      decidedAt: new Date().toISOString(),
    };
    const { agent, auditLogPath } = buildAgent(approvingDecision);

    const result = await agent.manageAdmin(
      makeRequest({ teamRequests: [{ requestedBy: "Jordan", description: "Please delete the old contract records." }] }),
    );

    expect(result.administrativeRecords.length).toBeGreaterThan(0);
    expect(await readEventTypes(auditLogPath)).toEqual([
      "admin_requested",
      "admin_escalated",
      "admin_escalation_resolved",
      "admin_completed",
    ]);
  });

  it("rejects when a human declines the destructive-action escalation", async () => {
    const { agent, auditLogPath } = buildAgent(REJECTING_DECISION);

    await expect(
      agent.manageAdmin(makeRequest({ teamRequests: [{ requestedBy: "Jordan", description: "Please delete the old contract records." }] })),
    ).rejects.toThrow(/destructive-action/);

    expect(await readEventTypes(auditLogPath)).toEqual([
      "admin_requested",
      "admin_escalated",
      "admin_escalation_resolved",
      "admin_rejected",
    ]);
  });

  it("does not escalate when a project is merely archived", async () => {
    const { agent, auditLogPath } = buildAgent(REJECTING_DECISION);

    const result = await agent.manageAdmin(
      makeRequest({ projectUpdates: [{ projectName: "Beta Migration", status: "archived", note: "Please archive this completed project." }] }),
    );

    expect(result.projectStatusReport).toHaveLength(1);
    expect(await readEventTypes(auditLogPath)).toEqual(["admin_requested", "admin_completed"]);
  });
});
