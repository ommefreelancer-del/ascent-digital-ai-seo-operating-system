import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { OutreachAgent } from "../../../src/agents/outreach-agent/outreach-agent.js";
import { OutreachRequestValidator } from "../../../src/agents/outreach-agent/validation/outreach-request-validator.js";
import { OutreachDraftBuilder } from "../../../src/agents/outreach-agent/drafting/outreach-draft-builder.js";
import { FollowUpScheduleBuilder } from "../../../src/agents/outreach-agent/drafting/follow-up-schedule-builder.js";
import { AuditLogger } from "../../../src/core/governance/audit-logger.js";
import type { ApprovalChannel } from "../../../src/core/governance/approval-channel.js";
import type { ApprovalDecision } from "../../../src/core/types/approval.types.js";
import type { OutreachRequest } from "../../../src/agents/outreach-agent/types/outreach-request.types.js";
import type { PublisherQualificationResult, QualifiedProspect } from "../../../src/agents/publisher-qualification-agent/types/publisher-qualification-request.types.js";
import type { ContactIntelligenceResult, ContactRecord } from "../../../src/agents/contact-intelligence-agent/types/contact-intelligence-request.types.js";

function makeApprovalChannel(decision: ApprovalDecision): ApprovalChannel {
  return { requestDecision: async () => decision };
}

const REJECTING_DECISION: ApprovalDecision = {
  requestId: "unused",
  outcome: "rejected",
  notes: "should not be called",
  decidedAt: new Date().toISOString(),
};

function makeApprovedProspect(overrides: Partial<QualifiedProspect> = {}): QualifiedProspect {
  return { url: "https://example.com/blog", domain: "example.com", title: "Example Plumbing Blog", decision: "approved", notes: "x", ...overrides };
}

function makePublisherQualification(approvedProspects: QualifiedProspect[] = [makeApprovedProspect()]): PublisherQualificationResult {
  return {
    requestId: "pq-1",
    dataAvailable: true,
    approvedProspects,
    rejectedProspects: [],
    limitations: ["Publisher qualification limitation."],
    decidedAt: new Date().toISOString(),
  };
}

function makeVerifiedRecord(overrides: Partial<ContactRecord> = {}): ContactRecord {
  return {
    url: "https://example.com/blog",
    domain: "example.com",
    title: "Example Plumbing Blog",
    contactMethod: "email",
    contactValue: "hello@example.com",
    sourceUrl: "https://example.com/contact",
    verificationNotes: "x",
    ...overrides,
  };
}

function makeContactIntelligence(
  verifiedRecords: ContactRecord[] = [makeVerifiedRecord()],
  dataAvailable = true,
): ContactIntelligenceResult {
  return {
    requestId: "ci-1",
    dataAvailable,
    verifiedRecords,
    unverifiedRecords: [],
    limitations: ["Contact intelligence limitation."],
    decidedAt: new Date().toISOString(),
  };
}

function makeRequest(overrides: Partial<OutreachRequest> = {}): OutreachRequest {
  return {
    id: "req-1",
    publisherQualification: makePublisherQualification(),
    contactIntelligence: makeContactIntelligence(),
    campaignRequirements: "Guest post outreach for a plumbing brand.",
    ...overrides,
  };
}

describe("OutreachAgent", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "outreach-agent-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  function buildAgent(approvalDecision: ApprovalDecision = REJECTING_DECISION) {
    const auditLogPath = join(dir, "audit-log.jsonl");
    const agent = new OutreachAgent(
      new OutreachRequestValidator(),
      new OutreachDraftBuilder(),
      new FollowUpScheduleBuilder(),
      makeApprovalChannel(approvalDecision),
      new AuditLogger(auditLogPath),
    );
    return { agent, auditLogPath };
  }

  async function readEventTypes(auditLogPath: string): Promise<string[]> {
    const lines = (await readFile(auditLogPath, "utf8")).trim().split("\n");
    return lines.map((line) => JSON.parse(line).eventType);
  }

  it("drafts real, personalized outreach and a follow-up for every matched, verified publisher", async () => {
    const { agent, auditLogPath } = buildAgent();

    const result = await agent.prepareOutreach(makeRequest());

    expect(result.dataAvailable).toBe(true);
    expect(result.outreachDrafts).toHaveLength(1);
    expect(result.outreachDrafts[0]?.contactValue).toBe("hello@example.com");
    expect(result.followUpSchedule).toHaveLength(1);
    expect(result.outreachStatus).toEqual([{ domain: "example.com", status: "drafted", notes: expect.stringContaining("email") }]);
    expect(result.skippedPublishers).toHaveLength(0);
    expect(await readEventTypes(auditLogPath)).toEqual(["outreach_requested", "outreach_completed"]);
  });

  it("skips an approved publisher with no matching verified contact record", async () => {
    const approvingDecision: ApprovalDecision = {
      requestId: "unused",
      outcome: "candidate_selected",
      selectedCandidateId: "proceed",
      notes: "Proceed with the skip.",
      decidedAt: new Date().toISOString(),
    };
    const { agent, auditLogPath } = buildAgent(approvingDecision);

    const result = await agent.prepareOutreach(
      makeRequest({ contactIntelligence: makeContactIntelligence([makeVerifiedRecord({ domain: "other.com" })]) }),
    );

    expect(result.outreachDrafts).toHaveLength(0);
    expect(result.skippedPublishers).toHaveLength(1);
    expect(result.skippedPublishers[0]?.reason).toContain("No verified contact record");
    expect(result.outreachStatus).toEqual([{ domain: "example.com", status: "skipped-no-verified-contact", notes: expect.any(String) }]);
    expect(await readEventTypes(auditLogPath)).toEqual([
      "outreach_requested",
      "outreach_escalated",
      "outreach_escalation_resolved",
      "outreach_completed",
    ]);
  });

  it("reports data unavailable and skips every publisher when contact intelligence had no real data", async () => {
    const { agent, auditLogPath } = buildAgent();

    const result = await agent.prepareOutreach(
      makeRequest({ contactIntelligence: makeContactIntelligence([], false) }),
    );

    expect(result.dataAvailable).toBe(false);
    expect(result.outreachDrafts).toHaveLength(0);
    expect(result.skippedPublishers).toHaveLength(1);
    expect(result.limitations.some((l) => l.includes("No verified contact data was available"))).toBe(true);
    expect(await readEventTypes(auditLogPath)).toEqual(["outreach_requested", "outreach_completed"]);
  });

  it("carries forward upstream limitations from both publisher qualification and contact intelligence", async () => {
    const { agent } = buildAgent();
    const result = await agent.prepareOutreach(makeRequest());
    expect(result.limitations).toEqual(
      expect.arrayContaining(["Publisher qualification limitation.", "Contact intelligence limitation."]),
    );
  });

  it("throws and audit-logs validation failures without producing a result", async () => {
    const { agent, auditLogPath } = buildAgent();

    await expect(agent.prepareOutreach(makeRequest({ campaignRequirements: "   " }))).rejects.toThrow();

    expect(await readEventTypes(auditLogPath)).toEqual(["outreach_validation_failed"]);
  });

  it("escalates when real contact data existed but everything was skipped, and proceeds when approved", async () => {
    const approvingDecision: ApprovalDecision = {
      requestId: "unused",
      outcome: "candidate_selected",
      selectedCandidateId: "proceed",
      notes: "Proceed with zero drafts.",
      decidedAt: new Date().toISOString(),
    };
    const { agent, auditLogPath } = buildAgent(approvingDecision);

    const result = await agent.prepareOutreach(
      makeRequest({ contactIntelligence: makeContactIntelligence([makeVerifiedRecord({ domain: "other.com" })]) }),
    );

    expect(result.outreachDrafts).toHaveLength(0);
    expect(await readEventTypes(auditLogPath)).toEqual([
      "outreach_requested",
      "outreach_escalated",
      "outreach_escalation_resolved",
      "outreach_completed",
    ]);
  });

  it("rejects the request when a human declines the zero-drafts escalation", async () => {
    const { agent, auditLogPath } = buildAgent(REJECTING_DECISION);

    await expect(
      agent.prepareOutreach(makeRequest({ contactIntelligence: makeContactIntelligence([makeVerifiedRecord({ domain: "other.com" })]) })),
    ).rejects.toThrow(/no outreach drafts could be prepared/);

    expect(await readEventTypes(auditLogPath)).toEqual([
      "outreach_requested",
      "outreach_escalated",
      "outreach_escalation_resolved",
      "outreach_rejected",
    ]);
  });

  it("does not escalate when there are no approved publishers to evaluate at all", async () => {
    const { agent, auditLogPath } = buildAgent();

    const result = await agent.prepareOutreach(makeRequest({ publisherQualification: makePublisherQualification([]) }));

    expect(result.outreachDrafts).toHaveLength(0);
    expect(result.skippedPublishers).toHaveLength(0);
    expect(await readEventTypes(auditLogPath)).toEqual(["outreach_requested", "outreach_completed"]);
  });
});
