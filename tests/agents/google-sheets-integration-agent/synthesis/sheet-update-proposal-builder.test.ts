import { describe, expect, it } from "vitest";
import { SheetUpdateProposalBuilder } from "../../../../src/agents/google-sheets-integration-agent/synthesis/sheet-update-proposal-builder.js";
import type { ClientStatusEntry, LeadPipelineEntry } from "../../../../src/agents/ai-crm-agent/types/ai-crm-request.types.js";
import type { CampaignTrackingResult } from "../../../../src/agents/campaign-tracking-agent/types/campaign-tracking-request.types.js";
import type { OutreachStatusEntry } from "../../../../src/agents/outreach-agent/types/outreach-request.types.js";
import type { FinalAgreedPrice, NegotiationStatusEntry } from "../../../../src/agents/reply-negotiation-agent/types/reply-negotiation-request.types.js";
import type { GoogleSheetsSnapshot } from "../../../../src/agents/google-sheets-integration-agent/types/google-sheets-provider.types.js";

function makeClient(overrides: Partial<ClientStatusEntry> = {}): ClientStatusEntry {
  return { clientName: "Acme Plumbing", status: "active retainer", activity: "active", lastContactedAt: "2026-07-01T00:00:00.000Z", ...overrides };
}

function makeLead(overrides: Partial<LeadPipelineEntry> = {}): LeadPipelineEntry {
  return { domain: "example.com", stage: "negotiating", notes: "Real note.", ...overrides };
}

function makePrice(overrides: Partial<FinalAgreedPrice> = {}): FinalAgreedPrice {
  return { domain: "example.com", agreedPrice: 150, currency: "USD", confirmedAt: "2026-07-05T00:00:00.000Z", ...overrides };
}

function makeOutreachStatus(overrides: Partial<OutreachStatusEntry> = {}): OutreachStatusEntry {
  return { domain: "example.com", status: "drafted", notes: "Real note.", ...overrides };
}

function makeNegotiationStatus(overrides: Partial<NegotiationStatusEntry> = {}): NegotiationStatusEntry {
  return { domain: "example.com", status: "negotiating", notes: "Real note.", ...overrides };
}

function makeCampaignTracking(overrides: Partial<CampaignTrackingResult> = {}): CampaignTrackingResult {
  return {
    requestId: "ct-1",
    campaignName: "Plumbing Guest Post Campaign",
    dataAvailable: true,
    campaignStatus: { phase: "in-progress", totalApprovedPublishers: 1, draftedCount: 1, skippedCount: 0 },
    progressReports: [],
    performanceSummary: { draftRate: 1, outreachDataAvailable: true },
    limitations: [],
    decidedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeSnapshot(overrides: Partial<GoogleSheetsSnapshot> = {}): GoogleSheetsSnapshot {
  return { spreadsheetId: "sheet-1", existingRecords: [], source: "test-provider", retrievedAt: new Date().toISOString(), ...overrides };
}

describe("SheetUpdateProposalBuilder", () => {
  const builder = new SheetUpdateProposalBuilder();

  it("returns no proposals when there is no real data and no campaign activity", () => {
    const proposals = builder.build([], [], [], [], [], makeCampaignTracking({ campaignStatus: { phase: "not-started", totalApprovedPublishers: 0, draftedCount: 0, skippedCount: 0 } }), null);
    expect(proposals).toEqual([]);
  });

  it("proposes a create for a client with no snapshot configured", () => {
    const proposals = builder.build([makeClient()], [], [], [], [], makeCampaignTracking(), null);
    const clientProposal = proposals.find((p) => p.recordCategory === "client");
    expect(clientProposal).toEqual({
      recordCategory: "client",
      action: "create",
      identifier: "Acme Plumbing",
      summary: "active retainer (active)",
      requiresApproval: true,
    });
  });

  it("proposes an update for a client that already exists in the real snapshot", () => {
    const snapshot = makeSnapshot({ existingRecords: [{ recordType: "client", identifier: "Acme Plumbing" }] });
    const proposals = builder.build([makeClient()], [], [], [], [], makeCampaignTracking(), snapshot);
    const clientProposal = proposals.find((p) => p.recordCategory === "client");
    expect(clientProposal?.action).toBe("update");
  });

  it("proposes a create for a publisher not found in the real snapshot", () => {
    const snapshot = makeSnapshot({ existingRecords: [{ recordType: "publisher", identifier: "other.com" }] });
    const proposals = builder.build([], [makeLead({ domain: "example.com" })], [], [], [], makeCampaignTracking(), snapshot);
    const publisherProposal = proposals.find((p) => p.recordCategory === "publisher");
    expect(publisherProposal?.action).toBe("create");
    expect(publisherProposal?.identifier).toBe("example.com");
  });

  it("always proposes an update for pricing, outreach-status, and deal-status", () => {
    const proposals = builder.build([], [], [makePrice()], [makeOutreachStatus()], [makeNegotiationStatus()], makeCampaignTracking(), null);
    expect(proposals.find((p) => p.recordCategory === "pricing")?.action).toBe("update");
    expect(proposals.find((p) => p.recordCategory === "outreach-status")?.action).toBe("update");
    expect(proposals.find((p) => p.recordCategory === "deal-status")?.action).toBe("update");
  });

  it("proposes a campaign-status update when the campaign has real activity", () => {
    const proposals = builder.build([], [], [], [], [], makeCampaignTracking(), null);
    const campaignProposal = proposals.find((p) => p.recordCategory === "campaign-status");
    expect(campaignProposal?.identifier).toBe("Plumbing Guest Post Campaign");
    expect(campaignProposal?.summary).toContain("in-progress");
  });

  it("does not propose a campaign-status update when the campaign has no real activity", () => {
    const proposals = builder.build(
      [],
      [],
      [],
      [],
      [],
      makeCampaignTracking({ campaignStatus: { phase: "not-started", totalApprovedPublishers: 0, draftedCount: 0, skippedCount: 0 } }),
      null,
    );
    expect(proposals.find((p) => p.recordCategory === "campaign-status")).toBeUndefined();
  });
});
