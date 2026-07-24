import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ProspectingAgent } from "../../../src/agents/prospecting-agent/prospecting-agent.js";
import { ProspectingRequestValidator } from "../../../src/agents/prospecting-agent/validation/prospecting-request-validator.js";
import { NullProspectDiscoveryProvider } from "../../../src/agents/prospecting-agent/providers/null-prospect-discovery-provider.js";
import { ProspectDeduplicator } from "../../../src/agents/prospecting-agent/processing/prospect-deduplicator.js";
import { ProspectBuilder } from "../../../src/agents/prospecting-agent/processing/prospect-builder.js";
import { AuditLogger } from "../../../src/core/governance/audit-logger.js";
import type { ApprovalChannel } from "../../../src/core/governance/approval-channel.js";
import type { ApprovalDecision } from "../../../src/core/types/approval.types.js";
import type { ProspectingRequest } from "../../../src/agents/prospecting-agent/types/prospecting-request.types.js";
import type {
  ProspectDiscoveryProvider,
  ProspectDiscoveryRequest,
  ProspectDiscoverySnapshot,
} from "../../../src/agents/prospecting-agent/types/prospect-discovery-provider.types.js";

function makeApprovalChannel(decision: ApprovalDecision): ApprovalChannel {
  return { requestDecision: async () => decision };
}

const REJECTING_DECISION: ApprovalDecision = {
  requestId: "unused",
  outcome: "rejected",
  notes: "should not be called",
  decidedAt: new Date().toISOString(),
};

class FixedProspectDiscoveryProvider implements ProspectDiscoveryProvider {
  readonly name = "fixed-test-provider";
  constructor(private readonly snapshot: ProspectDiscoverySnapshot | null) {}
  async discoverProspects(_request: ProspectDiscoveryRequest): Promise<ProspectDiscoverySnapshot | null> {
    return this.snapshot;
  }
}

function makeRequest(overrides: Partial<ProspectingRequest> = {}): ProspectingRequest {
  return {
    id: "req-1",
    campaignRequirements: "Find guest posting opportunities for a plumbing brand.",
    targetNiche: "plumbing",
    targetCountry: "US",
    targetLanguage: "en",
    ...overrides,
  };
}

describe("ProspectingAgent", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "prospecting-agent-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  function buildAgent(provider: ProspectDiscoveryProvider, approvalDecision: ApprovalDecision = REJECTING_DECISION) {
    const auditLogPath = join(dir, "audit-log.jsonl");
    const agent = new ProspectingAgent(
      new ProspectingRequestValidator(),
      provider,
      new ProspectDeduplicator(),
      new ProspectBuilder(),
      makeApprovalChannel(approvalDecision),
      new AuditLogger(auditLogPath),
    );
    return { agent, auditLogPath };
  }

  async function readEventTypes(auditLogPath: string): Promise<string[]> {
    const lines = (await readFile(auditLogPath, "utf8")).trim().split("\n");
    return lines.map((line) => JSON.parse(line).eventType);
  }

  it("reports data unavailable with the default NullProspectDiscoveryProvider and does not escalate", async () => {
    const { agent, auditLogPath } = buildAgent(new NullProspectDiscoveryProvider());

    const result = await agent.discoverProspects(makeRequest());

    expect(result.dataAvailable).toBe(false);
    expect(result.prospects).toEqual([]);
    expect(result.duplicatesRemoved).toBe(0);
    expect(result.limitations.some((l) => l.includes('using "none-configured"'))).toBe(true);
    expect(await readEventTypes(auditLogPath)).toEqual(["prospecting_requested", "prospecting_completed"]);
  });

  it("produces real, deduplicated, categorized prospects when the provider supplies real data", async () => {
    const snapshot: ProspectDiscoverySnapshot = {
      candidates: [
        { url: "https://a.com/blog", domain: "a.com", title: "A", snippet: "s", opportunityType: "guest-post", relevanceScore: 0.9 },
        { url: "https://b.com/blog", domain: "b.com", title: "B", snippet: "s", opportunityType: "backlink", relevanceScore: 0.6 },
        { url: "https://a.com/other", domain: "a.com", title: "A dup", snippet: "s", opportunityType: "guest-post", relevanceScore: 0.2 },
      ],
      source: "fixed-test-provider",
      retrievedAt: new Date().toISOString(),
    };
    const { agent, auditLogPath } = buildAgent(new FixedProspectDiscoveryProvider(snapshot));

    const result = await agent.discoverProspects(makeRequest());

    expect(result.dataAvailable).toBe(true);
    expect(result.prospects).toHaveLength(2);
    expect(result.duplicatesRemoved).toBe(1);
    expect(result.prospects.find((p) => p.domain === "a.com")?.confidence).toBe("high");
    expect(await readEventTypes(auditLogPath)).toEqual(["prospecting_requested", "prospecting_completed"]);
  });

  it("throws and audit-logs validation failures without producing a result", async () => {
    const { agent, auditLogPath } = buildAgent(new NullProspectDiscoveryProvider());

    await expect(agent.discoverProspects(makeRequest({ targetNiche: "   " }))).rejects.toThrow();

    expect(await readEventTypes(auditLogPath)).toEqual(["prospecting_validation_failed"]);
  });

  it("escalates when a real provider found zero prospects, and proceeds when a human approves", async () => {
    const emptySnapshot: ProspectDiscoverySnapshot = { candidates: [], source: "fixed-test-provider", retrievedAt: new Date().toISOString() };
    const approvingDecision: ApprovalDecision = {
      requestId: "unused",
      outcome: "candidate_selected",
      selectedCandidateId: "proceed",
      notes: "Proceed with empty list.",
      decidedAt: new Date().toISOString(),
    };
    const { agent, auditLogPath } = buildAgent(new FixedProspectDiscoveryProvider(emptySnapshot), approvingDecision);

    const result = await agent.discoverProspects(makeRequest());

    expect(result.prospects).toEqual([]);
    expect(await readEventTypes(auditLogPath)).toEqual([
      "prospecting_requested",
      "prospecting_escalated",
      "prospecting_escalation_resolved",
      "prospecting_completed",
    ]);
  });

  it("rejects when a human declines the low-confidence escalation", async () => {
    const lowConfidenceSnapshot: ProspectDiscoverySnapshot = {
      candidates: [{ url: "https://a.com", domain: "a.com", title: "A", snippet: "s", opportunityType: "general", relevanceScore: 0.1 }],
      source: "fixed-test-provider",
      retrievedAt: new Date().toISOString(),
    };
    const { agent, auditLogPath } = buildAgent(new FixedProspectDiscoveryProvider(lowConfidenceSnapshot), REJECTING_DECISION);

    await expect(agent.discoverProspects(makeRequest())).rejects.toThrow(/empty or entirely low-confidence/);

    expect(await readEventTypes(auditLogPath)).toEqual([
      "prospecting_requested",
      "prospecting_escalated",
      "prospecting_escalation_resolved",
      "prospecting_rejected",
    ]);
  });
});
