import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ContactIntelligenceAgent } from "../../../src/agents/contact-intelligence-agent/contact-intelligence-agent.js";
import { ContactIntelligenceRequestValidator } from "../../../src/agents/contact-intelligence-agent/validation/contact-intelligence-request-validator.js";
import { NullContactDiscoveryProvider } from "../../../src/agents/contact-intelligence-agent/providers/null-contact-discovery-provider.js";
import { ContactRecordBuilder } from "../../../src/agents/contact-intelligence-agent/contact/contact-record-builder.js";
import { AuditLogger } from "../../../src/core/governance/audit-logger.js";
import type { ApprovalChannel } from "../../../src/core/governance/approval-channel.js";
import type { ApprovalDecision } from "../../../src/core/types/approval.types.js";
import type { ContactIntelligenceRequest } from "../../../src/agents/contact-intelligence-agent/types/contact-intelligence-request.types.js";
import type {
  ContactDiscoveryProvider,
  ContactDiscoveryRequest,
  ContactDiscoverySnapshot,
} from "../../../src/agents/contact-intelligence-agent/types/contact-discovery-provider.types.js";
import type { PublisherQualificationResult, QualifiedProspect } from "../../../src/agents/publisher-qualification-agent/types/publisher-qualification-request.types.js";

function makeApprovalChannel(decision: ApprovalDecision): ApprovalChannel {
  return { requestDecision: async () => decision };
}

const REJECTING_DECISION: ApprovalDecision = {
  requestId: "unused",
  outcome: "rejected",
  notes: "should not be called",
  decidedAt: new Date().toISOString(),
};

class MapBackedContactDiscoveryProvider implements ContactDiscoveryProvider {
  readonly name = "fixed-test-provider";
  constructor(private readonly snapshots: ReadonlyMap<string, ContactDiscoverySnapshot | null>) {}
  async discoverContacts(request: ContactDiscoveryRequest): Promise<ContactDiscoverySnapshot | null> {
    return this.snapshots.get(request.domain) ?? null;
  }
}

function makeApprovedProspect(overrides: Partial<QualifiedProspect> = {}): QualifiedProspect {
  return { url: "https://example.com/blog", domain: "example.com", title: "Example Blog", decision: "approved", notes: "x", ...overrides };
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

function makeRequest(overrides: Partial<ContactIntelligenceRequest> = {}): ContactIntelligenceRequest {
  return {
    id: "req-1",
    publisherQualification: makePublisherQualification(),
    campaignRequirements: "Find contacts for approved guest-post publishers.",
    ...overrides,
  };
}

describe("ContactIntelligenceAgent", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "contact-intelligence-agent-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  function buildAgent(provider: ContactDiscoveryProvider, approvalDecision: ApprovalDecision = REJECTING_DECISION) {
    const auditLogPath = join(dir, "audit-log.jsonl");
    const agent = new ContactIntelligenceAgent(
      new ContactIntelligenceRequestValidator(),
      provider,
      new ContactRecordBuilder(),
      makeApprovalChannel(approvalDecision),
      new AuditLogger(auditLogPath),
    );
    return { agent, auditLogPath };
  }

  async function readEventTypes(auditLogPath: string): Promise<string[]> {
    const lines = (await readFile(auditLogPath, "utf8")).trim().split("\n");
    return lines.map((line) => JSON.parse(line).eventType);
  }

  it("reports no verified contacts and data unavailable with the default NullContactDiscoveryProvider", async () => {
    const { agent, auditLogPath } = buildAgent(new NullContactDiscoveryProvider());

    const result = await agent.gatherContacts(makeRequest());

    expect(result.dataAvailable).toBe(false);
    expect(result.verifiedRecords).toHaveLength(0);
    expect(result.unverifiedRecords).toHaveLength(1);
    expect(result.unverifiedRecords[0]?.contactMethod).toBeNull();
    expect(result.limitations.some((l) => l.includes('using "none-configured"'))).toBe(true);
    expect(await readEventTypes(auditLogPath)).toEqual([
      "contact_intelligence_requested",
      "contact_intelligence_completed",
    ]);
  });

  it("carries forward the publisher qualification limitation", async () => {
    const { agent } = buildAgent(new NullContactDiscoveryProvider());
    const result = await agent.gatherContacts(makeRequest());
    expect(result.limitations).toEqual(expect.arrayContaining(["Publisher qualification limitation."]));
  });

  it("produces a real verified record when the provider supplies verified contact evidence", async () => {
    const provider = new MapBackedContactDiscoveryProvider(
      new Map([
        [
          "example.com",
          {
            domain: "example.com",
            candidates: [{ method: "email", value: "hello@example.com", isVerified: true, sourceUrl: "https://example.com/contact" }],
            source: "fixed-test-provider",
            retrievedAt: new Date().toISOString(),
          },
        ],
      ]),
    );
    const { agent, auditLogPath } = buildAgent(provider);

    const result = await agent.gatherContacts(makeRequest());

    expect(result.dataAvailable).toBe(true);
    expect(result.verifiedRecords).toHaveLength(1);
    expect(result.verifiedRecords[0]?.contactValue).toBe("hello@example.com");
    expect(result.unverifiedRecords).toHaveLength(0);
    expect(await readEventTypes(auditLogPath)).toEqual([
      "contact_intelligence_requested",
      "contact_intelligence_completed",
    ]);
  });

  it("throws and audit-logs validation failures without producing a result", async () => {
    const { agent, auditLogPath } = buildAgent(new NullContactDiscoveryProvider());

    await expect(agent.gatherContacts(makeRequest({ campaignRequirements: "   " }))).rejects.toThrow();

    expect(await readEventTypes(auditLogPath)).toEqual(["contact_intelligence_validation_failed"]);
  });

  it("escalates when real discovery yields zero verified records, and proceeds when a human approves", async () => {
    const provider = new MapBackedContactDiscoveryProvider(
      new Map([
        [
          "example.com",
          {
            domain: "example.com",
            candidates: [{ method: "social-media", value: "@example", isVerified: false, sourceUrl: "https://example.com/about" }],
            source: "fixed-test-provider",
            retrievedAt: new Date().toISOString(),
          },
        ],
      ]),
    );
    const approvingDecision: ApprovalDecision = {
      requestId: "unused",
      outcome: "candidate_selected",
      selectedCandidateId: "proceed",
      notes: "Proceed with zero verified.",
      decidedAt: new Date().toISOString(),
    };
    const { agent, auditLogPath } = buildAgent(provider, approvingDecision);

    const result = await agent.gatherContacts(makeRequest());

    expect(result.verifiedRecords).toHaveLength(0);
    expect(await readEventTypes(auditLogPath)).toEqual([
      "contact_intelligence_requested",
      "contact_intelligence_escalated",
      "contact_intelligence_escalation_resolved",
      "contact_intelligence_completed",
    ]);
  });

  it("rejects the request when a human declines the zero-verified escalation", async () => {
    const provider = new MapBackedContactDiscoveryProvider(
      new Map([
        [
          "example.com",
          {
            domain: "example.com",
            candidates: [{ method: "social-media", value: "@example", isVerified: false, sourceUrl: "https://example.com/about" }],
            source: "fixed-test-provider",
            retrievedAt: new Date().toISOString(),
          },
        ],
      ]),
    );
    const { agent, auditLogPath } = buildAgent(provider, REJECTING_DECISION);

    await expect(agent.gatherContacts(makeRequest())).rejects.toThrow(/no contact records could be verified/);

    expect(await readEventTypes(auditLogPath)).toEqual([
      "contact_intelligence_requested",
      "contact_intelligence_escalated",
      "contact_intelligence_escalation_resolved",
      "contact_intelligence_rejected",
    ]);
  });

  it("does not escalate when there are no approved publishers to evaluate at all", async () => {
    const { agent, auditLogPath } = buildAgent(new NullContactDiscoveryProvider());

    const result = await agent.gatherContacts(makeRequest({ publisherQualification: makePublisherQualification([]) }));

    expect(result.verifiedRecords).toHaveLength(0);
    expect(result.unverifiedRecords).toHaveLength(0);
    expect(await readEventTypes(auditLogPath)).toEqual([
      "contact_intelligence_requested",
      "contact_intelligence_completed",
    ]);
  });
});
