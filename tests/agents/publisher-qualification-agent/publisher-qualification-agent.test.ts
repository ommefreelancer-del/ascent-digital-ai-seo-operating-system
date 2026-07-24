import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PublisherQualificationAgent } from "../../../src/agents/publisher-qualification-agent/publisher-qualification-agent.js";
import { PublisherQualificationRequestValidator } from "../../../src/agents/publisher-qualification-agent/validation/publisher-qualification-request-validator.js";
import { NullPublisherQualityProvider } from "../../../src/agents/publisher-qualification-agent/providers/null-publisher-quality-provider.js";
import { ProspectQualifier } from "../../../src/agents/publisher-qualification-agent/qualification/prospect-qualifier.js";
import { AuditLogger } from "../../../src/core/governance/audit-logger.js";
import type { ApprovalChannel } from "../../../src/core/governance/approval-channel.js";
import type { ApprovalDecision } from "../../../src/core/types/approval.types.js";
import type { PublisherQualificationRequest } from "../../../src/agents/publisher-qualification-agent/types/publisher-qualification-request.types.js";
import type {
  PublisherQualityProvider,
  PublisherQualityRequest,
  PublisherQualitySnapshot,
} from "../../../src/agents/publisher-qualification-agent/types/publisher-quality-provider.types.js";
import type { Prospect, ProspectingResult } from "../../../src/agents/prospecting-agent/types/prospecting-request.types.js";

function makeApprovalChannel(decision: ApprovalDecision): ApprovalChannel {
  return { requestDecision: async () => decision };
}

const REJECTING_DECISION: ApprovalDecision = {
  requestId: "unused",
  outcome: "rejected",
  notes: "should not be called",
  decidedAt: new Date().toISOString(),
};

class MapBackedPublisherQualityProvider implements PublisherQualityProvider {
  readonly name = "fixed-test-provider";
  constructor(private readonly snapshots: ReadonlyMap<string, PublisherQualitySnapshot | null>) {}
  async fetchPublisherQuality(request: PublisherQualityRequest): Promise<PublisherQualitySnapshot | null> {
    return this.snapshots.get(request.domain) ?? null;
  }
}

function makeProspect(overrides: Partial<Prospect> = {}): Prospect {
  return {
    url: "https://example.com/blog",
    domain: "example.com",
    title: "Example Plumbing Blog",
    category: "guest-post",
    confidence: "high",
    notes: "Covers plumbing topics.",
    ...overrides,
  };
}

function makeProspecting(prospects: Prospect[] = [makeProspect()]): ProspectingResult {
  return {
    requestId: "pr-1",
    dataAvailable: true,
    prospects,
    duplicatesRemoved: 0,
    limitations: ["Prospecting limitation."],
    decidedAt: new Date().toISOString(),
  };
}

function makeRequest(overrides: Partial<PublisherQualificationRequest> = {}): PublisherQualificationRequest {
  return {
    id: "req-1",
    prospecting: makeProspecting(),
    campaignRequirements: "Find guest posting opportunities for a plumbing brand.",
    targetNiche: "plumbing",
    ...overrides,
  };
}

describe("PublisherQualificationAgent", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "publisher-qualification-agent-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  function buildAgent(provider: PublisherQualityProvider, approvalDecision: ApprovalDecision = REJECTING_DECISION) {
    const auditLogPath = join(dir, "audit-log.jsonl");
    const agent = new PublisherQualificationAgent(
      new PublisherQualificationRequestValidator(),
      provider,
      new ProspectQualifier(),
      makeApprovalChannel(approvalDecision),
      new AuditLogger(auditLogPath),
    );
    return { agent, auditLogPath };
  }

  async function readEventTypes(auditLogPath: string): Promise<string[]> {
    const lines = (await readFile(auditLogPath, "utf8")).trim().split("\n");
    return lines.map((line) => JSON.parse(line).eventType);
  }

  it("rejects every prospect and reports data unavailable with the default NullPublisherQualityProvider", async () => {
    const { agent, auditLogPath } = buildAgent(new NullPublisherQualityProvider());

    const result = await agent.qualifyProspects(makeRequest());

    expect(result.dataAvailable).toBe(false);
    expect(result.approvedProspects).toHaveLength(0);
    expect(result.rejectedProspects).toHaveLength(1);
    expect(result.rejectedProspects[0]?.notes).toContain("No real publisher quality data is available");
    expect(result.limitations.some((l) => l.includes('using "none-configured"'))).toBe(true);
    expect(await readEventTypes(auditLogPath)).toEqual([
      "publisher_qualification_requested",
      "publisher_qualification_completed",
    ]);
  });

  it("carries forward the prospecting limitation", async () => {
    const { agent } = buildAgent(new NullPublisherQualityProvider());
    const result = await agent.qualifyProspects(makeRequest());
    expect(result.limitations).toEqual(expect.arrayContaining(["Prospecting limitation."]));
  });

  it("approves a real, qualifying prospect when real quality evidence is available", async () => {
    const provider = new MapBackedPublisherQualityProvider(
      new Map([
        [
          "example.com",
          {
            domain: "example.com",
            domainAuthority: 40,
            spamScore: 2,
            estimatedMonthlyTraffic: 5000,
            isNicheRelevant: true,
            source: "fixed-test-provider",
            retrievedAt: new Date().toISOString(),
          },
        ],
      ]),
    );
    const { agent, auditLogPath } = buildAgent(provider);

    const result = await agent.qualifyProspects(makeRequest());

    expect(result.dataAvailable).toBe(true);
    expect(result.approvedProspects).toHaveLength(1);
    expect(result.rejectedProspects).toHaveLength(0);
    expect(await readEventTypes(auditLogPath)).toEqual([
      "publisher_qualification_requested",
      "publisher_qualification_completed",
    ]);
  });

  it("throws and audit-logs validation failures without producing a result", async () => {
    const { agent, auditLogPath } = buildAgent(new NullPublisherQualityProvider());

    await expect(agent.qualifyProspects(makeRequest({ targetNiche: "   " }))).rejects.toThrow();

    expect(await readEventTypes(auditLogPath)).toEqual(["publisher_qualification_validation_failed"]);
  });

  it("escalates when real evidence yields zero approvals, and proceeds when a human approves", async () => {
    const provider = new MapBackedPublisherQualityProvider(
      new Map([
        [
          "example.com",
          {
            domain: "example.com",
            domainAuthority: 5,
            spamScore: 90,
            estimatedMonthlyTraffic: 100,
            isNicheRelevant: false,
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
      notes: "Proceed with zero approvals.",
      decidedAt: new Date().toISOString(),
    };
    const { agent, auditLogPath } = buildAgent(provider, approvingDecision);

    const result = await agent.qualifyProspects(makeRequest());

    expect(result.approvedProspects).toHaveLength(0);
    expect(await readEventTypes(auditLogPath)).toEqual([
      "publisher_qualification_requested",
      "publisher_qualification_escalated",
      "publisher_qualification_escalation_resolved",
      "publisher_qualification_completed",
    ]);
  });

  it("rejects the request when a human declines the zero-approvals escalation", async () => {
    const provider = new MapBackedPublisherQualityProvider(
      new Map([
        [
          "example.com",
          {
            domain: "example.com",
            domainAuthority: 5,
            spamScore: 90,
            estimatedMonthlyTraffic: 100,
            isNicheRelevant: false,
            source: "fixed-test-provider",
            retrievedAt: new Date().toISOString(),
          },
        ],
      ]),
    );
    const { agent, auditLogPath } = buildAgent(provider, REJECTING_DECISION);

    await expect(agent.qualifyProspects(makeRequest())).rejects.toThrow(/no prospects were approved/);

    expect(await readEventTypes(auditLogPath)).toEqual([
      "publisher_qualification_requested",
      "publisher_qualification_escalated",
      "publisher_qualification_escalation_resolved",
      "publisher_qualification_rejected",
    ]);
  });

  it("does not escalate when there are no prospects to evaluate at all", async () => {
    const { agent, auditLogPath } = buildAgent(new NullPublisherQualityProvider());

    const result = await agent.qualifyProspects(makeRequest({ prospecting: makeProspecting([]) }));

    expect(result.approvedProspects).toHaveLength(0);
    expect(result.rejectedProspects).toHaveLength(0);
    expect(await readEventTypes(auditLogPath)).toEqual([
      "publisher_qualification_requested",
      "publisher_qualification_completed",
    ]);
  });
});
