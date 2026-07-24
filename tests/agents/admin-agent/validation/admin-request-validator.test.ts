import { describe, expect, it } from "vitest";
import {
  AdminRequestValidator,
  AdminValidationError,
} from "../../../../src/agents/admin-agent/validation/admin-request-validator.js";
import type {
  AdminRequest,
  InternalDocumentEntry,
  ProjectUpdateEntry,
  TeamRequestEntry,
} from "../../../../src/agents/admin-agent/types/admin-request.types.js";
import type { AiCrmResult } from "../../../../src/agents/ai-crm-agent/types/ai-crm-request.types.js";
import type { BusinessDevelopmentResult } from "../../../../src/agents/business-development-agent/types/business-development-request.types.js";

function makeCrmData(): AiCrmResult {
  return {
    requestId: "crm-1",
    dataAvailable: true,
    leadPipeline: [],
    followUpActivities: [],
    clientStatusReport: [],
    campaignActivity: { campaignName: "Campaign", phase: "in-progress", draftedCount: 1, skippedCount: 0 },
    crmRecordUpdates: [],
    limitations: [],
    decidedAt: new Date().toISOString(),
  };
}

function makeBusinessDevelopment(): BusinessDevelopmentResult {
  return {
    requestId: "bd-1",
    dataAvailable: true,
    qualifiedLeadReport: [],
    salesPipelineSummary: { totalLeads: 0, qualifiedCount: 0, earlyStageCount: 0, notQualifiedCount: 0 },
    clientProposals: [],
    growthOpportunities: [],
    partnershipRecommendations: [],
    limitations: [],
    decidedAt: new Date().toISOString(),
  };
}

function makeDocument(overrides: Partial<InternalDocumentEntry> = {}): InternalDocumentEntry {
  return { name: "Onboarding Checklist", category: "onboarding", lastUpdatedAt: "2026-01-01T00:00:00.000Z", ...overrides };
}

function makeProjectUpdate(overrides: Partial<ProjectUpdateEntry> = {}): ProjectUpdateEntry {
  return { projectName: "Acme Website Revamp", status: "in-progress", note: "On track.", ...overrides };
}

function makeTeamRequest(overrides: Partial<TeamRequestEntry> = {}): TeamRequestEntry {
  return { requestedBy: "Jordan", description: "Please update the onboarding template.", ...overrides };
}

function makeRequest(overrides: Partial<AdminRequest> = {}): AdminRequest {
  return {
    id: "req-1",
    crmData: makeCrmData(),
    businessDevelopment: makeBusinessDevelopment(),
    ...overrides,
  };
}

describe("AdminRequestValidator", () => {
  const validator = new AdminRequestValidator();

  describe("validate", () => {
    it("accepts a well-formed request with no optional fields", () => {
      expect(() => validator.validate(makeRequest())).not.toThrow();
    });

    it("accepts a well-formed request with all optional fields", () => {
      expect(() =>
        validator.validate(
          makeRequest({
            internalDocuments: [makeDocument()],
            projectUpdates: [makeProjectUpdate()],
            teamRequests: [makeTeamRequest()],
          }),
        ),
      ).not.toThrow();
    });

    it("throws when an internalDocuments entry has a blank name", () => {
      expect(() => validator.validate(makeRequest({ internalDocuments: [makeDocument({ name: "  " })] }))).toThrow(
        AdminValidationError,
      );
    });

    it("throws when a projectUpdates entry has a blank projectName", () => {
      expect(() => validator.validate(makeRequest({ projectUpdates: [makeProjectUpdate({ projectName: "  " })] }))).toThrow(
        AdminValidationError,
      );
    });

    it("throws when a teamRequests entry has a blank description", () => {
      expect(() => validator.validate(makeRequest({ teamRequests: [makeTeamRequest({ description: "  " })] }))).toThrow(
        AdminValidationError,
      );
    });
  });

  describe("findDestructiveActionSignals", () => {
    it("returns an empty array when there are no signals", () => {
      expect(validator.findDestructiveActionSignals(makeRequest())).toEqual([]);
    });

    it("does not flag archiving, since it is one of this agent's own normal responsibilities", () => {
      const signals = validator.findDestructiveActionSignals(
        makeRequest({ projectUpdates: [makeProjectUpdate({ status: "archived", note: "Please archive this completed project." })] }),
      );
      expect(signals).toEqual([]);
    });

    it("flags a deletion signal in a team request description", () => {
      const signals = validator.findDestructiveActionSignals(
        makeRequest({ teamRequests: [makeTeamRequest({ description: "Please delete the old contract records." })] }),
      );
      expect(signals).toContain("deletion");
    });

    it("flags a removal signal in a project update note", () => {
      const signals = validator.findDestructiveActionSignals(
        makeRequest({ projectUpdates: [makeProjectUpdate({ note: "Remove all client files for this project." })] }),
      );
      expect(signals).toContain("removal");
    });

    it("flags a purge signal", () => {
      const signals = validator.findDestructiveActionSignals(
        makeRequest({ teamRequests: [makeTeamRequest({ description: "Purge the archived onboarding docs." })] }),
      );
      expect(signals).toContain("purge");
    });

    it("flags a wipe signal", () => {
      const signals = validator.findDestructiveActionSignals(
        makeRequest({ teamRequests: [makeTeamRequest({ description: "Wipe the old compliance records." })] }),
      );
      expect(signals).toContain("wipe");
    });

    it("returns each matched label only once even with multiple occurrences", () => {
      const signals = validator.findDestructiveActionSignals(
        makeRequest({ teamRequests: [makeTeamRequest({ description: "Delete this. Also delete that." })] }),
      );
      expect(signals.filter((s) => s === "deletion")).toHaveLength(1);
    });
  });
});
