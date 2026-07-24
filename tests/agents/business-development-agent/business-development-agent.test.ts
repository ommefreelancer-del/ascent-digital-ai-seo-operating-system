import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BusinessDevelopmentAgent } from "../../../src/agents/business-development-agent/business-development-agent.js";
import { BusinessDevelopmentRequestValidator } from "../../../src/agents/business-development-agent/validation/business-development-request-validator.js";
import { LeadQualifier } from "../../../src/agents/business-development-agent/development/lead-qualifier.js";
import { SalesPipelineSummaryBuilder } from "../../../src/agents/business-development-agent/development/sales-pipeline-summary-builder.js";
import { ClientProposalDraftBuilder } from "../../../src/agents/business-development-agent/development/client-proposal-draft-builder.js";
import { GrowthOpportunityBuilder } from "../../../src/agents/business-development-agent/development/growth-opportunity-builder.js";
import { PartnershipRecommendationBuilder } from "../../../src/agents/business-development-agent/development/partnership-recommendation-builder.js";
import { AuditLogger } from "../../../src/core/governance/audit-logger.js";
import type { ApprovalChannel } from "../../../src/core/governance/approval-channel.js";
import type { ApprovalDecision } from "../../../src/core/types/approval.types.js";
import type {
  BusinessDevelopmentRequest,
  ServicePortfolioItem,
} from "../../../src/agents/business-development-agent/types/business-development-request.types.js";
import type { AiCrmResult } from "../../../src/agents/ai-crm-agent/types/ai-crm-request.types.js";

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
    leadPipeline: [{ domain: "example.com", stage: "negotiating", notes: "Real note." }],
    followUpActivities: [],
    clientStatusReport: [{ clientName: "Acme Plumbing", status: "active retainer", activity: "active", lastContactedAt: "2026-07-01T00:00:00.000Z" }],
    campaignActivity: { campaignName: "Plumbing Guest Post Campaign", phase: "in-progress", draftedCount: 1, skippedCount: 0 },
    crmRecordUpdates: [],
    limitations: ["CRM limitation."],
    decidedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeService(overrides: Partial<ServicePortfolioItem> = {}): ServicePortfolioItem {
  return { serviceName: "SEO Audit", description: "A full technical audit.", priceRangeLabel: "$500-$1,000", ...overrides };
}

function makeRequest(overrides: Partial<BusinessDevelopmentRequest> = {}): BusinessDevelopmentRequest {
  return {
    id: "req-1",
    crmData: makeCrmData(),
    businessGoals: "Grow monthly recurring revenue from existing clients.",
    servicePortfolio: [makeService()],
    ...overrides,
  };
}

describe("BusinessDevelopmentAgent", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "business-development-agent-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  function buildAgent(approvalDecision: ApprovalDecision = REJECTING_DECISION) {
    const auditLogPath = join(dir, "audit-log.jsonl");
    const agent = new BusinessDevelopmentAgent(
      new BusinessDevelopmentRequestValidator(),
      new LeadQualifier(),
      new SalesPipelineSummaryBuilder(),
      new ClientProposalDraftBuilder(),
      new GrowthOpportunityBuilder(),
      new PartnershipRecommendationBuilder(),
      makeApprovalChannel(approvalDecision),
      new AuditLogger(auditLogPath),
    );
    return { agent, auditLogPath };
  }

  async function readEventTypes(auditLogPath: string): Promise<string[]> {
    const lines = (await readFile(auditLogPath, "utf8")).trim().split("\n");
    return lines.map((line) => JSON.parse(line).eventType);
  }

  it("produces a real qualified lead report, pipeline summary, proposals, opportunities, and recommendations", async () => {
    const { agent, auditLogPath } = buildAgent();

    const result = await agent.developBusiness(makeRequest());

    expect(result.dataAvailable).toBe(true);
    expect(result.qualifiedLeadReport).toEqual([{ domain: "example.com", stage: "negotiating", qualification: "qualified", notes: "Real note." }]);
    expect(result.salesPipelineSummary).toEqual({ totalLeads: 1, qualifiedCount: 1, earlyStageCount: 0, notQualifiedCount: 0 });
    expect(result.clientProposals).toHaveLength(1);
    expect(result.growthOpportunities).toEqual([]);
    expect(result.partnershipRecommendations).toEqual([]);
    expect(await readEventTypes(auditLogPath)).toEqual(["business_development_requested", "business_development_completed"]);
  });

  it("mirrors crmData.dataAvailable directly", async () => {
    const { agent } = buildAgent();
    const result = await agent.developBusiness(makeRequest({ crmData: makeCrmData({ dataAvailable: false }) }));
    expect(result.dataAvailable).toBe(false);
  });

  it("carries forward every upstream limitation plus its own standing and conditional disclaimers", async () => {
    const { agent } = buildAgent();
    const result = await agent.developBusiness(
      makeRequest({ crmData: makeCrmData({ dataAvailable: false }), servicePortfolio: [] }),
    );

    expect(result.limitations).toEqual(
      expect.arrayContaining([
        "CRM limitation.",
        "No real CRM data was available; the lead pipeline and sales pipeline summary reflect no real leads.",
        "No market research was supplied; growth opportunities reflect CRM signals only.",
        "No service portfolio was supplied; no client proposals could be prepared.",
      ]),
    );
    expect(result.limitations.some((l) => l.includes("never calls HubSpot CRM"))).toBe(true);
    expect(result.clientProposals).toEqual([]);
  });

  it("recommends a partnership for a real confirmed agreement", async () => {
    const { agent } = buildAgent();
    const result = await agent.developBusiness(
      makeRequest({ crmData: makeCrmData({ leadPipeline: [{ domain: "a.com", stage: "agreed-confirmed", notes: "Signed." }] }) }),
    );
    expect(result.partnershipRecommendations).toHaveLength(1);
    expect(result.partnershipRecommendations[0]?.domain).toBe("a.com");
  });

  it("throws and audit-logs validation failures without producing a result", async () => {
    const { agent, auditLogPath } = buildAgent();

    await expect(agent.developBusiness(makeRequest({ businessGoals: "   " }))).rejects.toThrow();

    expect(await readEventTypes(auditLogPath)).toEqual(["business_development_validation_failed"]);
  });

  it("escalates a policy-risk signal and proceeds when a human approves", async () => {
    const approvingDecision: ApprovalDecision = {
      requestId: "unused",
      outcome: "candidate_selected",
      selectedCandidateId: "proceed",
      notes: "Proceed anyway.",
      decidedAt: new Date().toISOString(),
    };
    const { agent, auditLogPath } = buildAgent(approvingDecision);

    const result = await agent.developBusiness(makeRequest({ businessGoals: "We guarantee more leads every month." }));

    expect(result.qualifiedLeadReport).toHaveLength(1);
    expect(await readEventTypes(auditLogPath)).toEqual([
      "business_development_requested",
      "business_development_escalated",
      "business_development_escalation_resolved",
      "business_development_completed",
    ]);
  });

  it("rejects when a human declines the policy-risk escalation", async () => {
    const { agent, auditLogPath } = buildAgent(REJECTING_DECISION);

    await expect(agent.developBusiness(makeRequest({ businessGoals: "We guarantee more leads every month." }))).rejects.toThrow(
      /policy-risk/,
    );

    expect(await readEventTypes(auditLogPath)).toEqual([
      "business_development_requested",
      "business_development_escalated",
      "business_development_escalation_resolved",
      "business_development_rejected",
    ]);
  });
});
