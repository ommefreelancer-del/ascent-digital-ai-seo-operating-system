import { describe, expect, it } from "vitest";
import {
  TechnicalSeoRequestValidator,
  TechnicalSeoValidationError,
} from "../../../../src/agents/technical-seo-agent/validation/technical-seo-request-validator.js";
import { CrossFunctionalNotesBuilder } from "../../../../src/agents/on-page-seo-agent/recommendations/cross-functional-notes-builder.js";
import type { AuditFinding, WebsiteAuditResult } from "../../../../src/agents/website-audit-agent/types/website-audit-request.types.js";
import type { TechnicalSeoRequest } from "../../../../src/agents/technical-seo-agent/types/technical-seo-request.types.js";

function makeAudit(findings: AuditFinding[]): WebsiteAuditResult {
  return {
    requestId: "wa-1",
    url: "https://example.com/page",
    findings,
    summary: {
      criticalCount: findings.filter((f) => f.severity === "critical").length,
      warningCount: findings.filter((f) => f.severity === "warning").length,
      infoCount: findings.filter((f) => f.severity === "info").length,
    },
    limitations: [],
    decidedAt: new Date().toISOString(),
  };
}

const NOINDEX_FINDING: AuditFinding = {
  category: "crawlability",
  severity: "critical",
  message: 'A <meta name="robots"> tag with "noindex" was found (content="noindex").',
  recommendation: "Remove it.",
};

const DISALLOW_FINDING: AuditFinding = {
  category: "robots-txt",
  severity: "critical",
  message: 'robots.txt contains "Disallow: /page", which blocks the audited URL\'s path "/page".',
  recommendation: "Remove it.",
};

function makeRequest(overrides: Partial<TechnicalSeoRequest> = {}): TechnicalSeoRequest {
  return {
    id: "req-1",
    websiteAudit: makeAudit([]),
    crossFunctionalNotes: [],
    ...overrides,
  };
}

describe("TechnicalSeoRequestValidator.validate", () => {
  const validator = new TechnicalSeoRequestValidator();
  const notesBuilder = new CrossFunctionalNotesBuilder();

  it("accepts a request with no cross-functional notes", () => {
    expect(() => validator.validate(makeRequest())).not.toThrow();
  });

  it("accepts a request whose cross-functional notes correlate to real findings", () => {
    const websiteAudit = makeAudit([NOINDEX_FINDING]);
    const notes = notesBuilder.build({ websiteAudit, targetKeyword: "x", intent: "informational" });

    expect(() => validator.validate(makeRequest({ websiteAudit, crossFunctionalNotes: notes }))).not.toThrow();
  });

  it("throws when a note does not match the expected format", () => {
    expect(() =>
      validator.validate(makeRequest({ crossFunctionalNotes: ["this is not a real cross-functional note"] })),
    ).toThrow(TechnicalSeoValidationError);
  });

  it("throws when a note references a finding not present in the supplied websiteAudit", () => {
    const notesBuiltFromDifferentAudit = notesBuilder.build({
      websiteAudit: makeAudit([NOINDEX_FINDING]),
      targetKeyword: "x",
      intent: "informational",
    });

    // The request's own websiteAudit has no findings at all -- mismatched with the notes above.
    expect(() =>
      validator.validate(makeRequest({ websiteAudit: makeAudit([]), crossFunctionalNotes: notesBuiltFromDifferentAudit })),
    ).toThrow(/references a finding not present/);
  });
});

describe("TechnicalSeoRequestValidator.looksAmbiguous", () => {
  const validator = new TechnicalSeoRequestValidator();

  it("is false when neither noindex nor Disallow is present", () => {
    expect(validator.looksAmbiguous(makeAudit([]))).toBe(false);
  });

  it("is false when only noindex is present", () => {
    expect(validator.looksAmbiguous(makeAudit([NOINDEX_FINDING]))).toBe(false);
  });

  it("is false when only a Disallow rule is present", () => {
    expect(validator.looksAmbiguous(makeAudit([DISALLOW_FINDING]))).toBe(false);
  });

  it("is true when both noindex and Disallow are present", () => {
    expect(validator.looksAmbiguous(makeAudit([NOINDEX_FINDING, DISALLOW_FINDING]))).toBe(true);
  });
});
