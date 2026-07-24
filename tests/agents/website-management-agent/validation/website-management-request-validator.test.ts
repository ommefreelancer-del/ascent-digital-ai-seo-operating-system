import { describe, expect, it } from "vitest";
import {
  WebsiteManagementRequestValidator,
  WebsiteManagementValidationError,
} from "../../../../src/agents/website-management-agent/validation/website-management-request-validator.js";
import type { WebsiteManagementRequest } from "../../../../src/agents/website-management-agent/types/website-management-request.types.js";
import type { WebsiteAuditResult } from "../../../../src/agents/website-audit-agent/types/website-audit-request.types.js";
import type { TechnicalSeoResult } from "../../../../src/agents/technical-seo-agent/types/technical-seo-request.types.js";

function makeWebsiteAudit(url: string | null): WebsiteAuditResult {
  return {
    requestId: "wa-1",
    url,
    findings: [],
    summary: { criticalCount: 0, warningCount: 0, infoCount: 0 },
    limitations: [],
    decidedAt: new Date().toISOString(),
  };
}

function makeTechnicalSeo(url: string | null): TechnicalSeoResult {
  return {
    requestId: "ts-1",
    url,
    recommendations: [],
    limitations: [],
    decidedAt: new Date().toISOString(),
  };
}

function makeRequest(overrides: Partial<WebsiteManagementRequest> = {}): WebsiteManagementRequest {
  return {
    id: "req-1",
    url: "https://oursite.com/plumbing",
    websiteAudit: makeWebsiteAudit("https://oursite.com/plumbing"),
    technicalSeo: makeTechnicalSeo("https://oursite.com/plumbing"),
    ...overrides,
  };
}

describe("WebsiteManagementRequestValidator", () => {
  const validator = new WebsiteManagementRequestValidator();

  it("accepts a well-formed, internally consistent request", () => {
    expect(() => validator.validate(makeRequest())).not.toThrow();
  });

  it("throws when url is empty", () => {
    expect(() => validator.validate(makeRequest({ url: "   " }))).toThrow(WebsiteManagementValidationError);
  });

  it("throws when websiteAudit describes a different page than the requested url", () => {
    expect(() =>
      validator.validate(makeRequest({ websiteAudit: makeWebsiteAudit("https://oursite.com/electrical") })),
    ).toThrow(/appears to describe a different page/);
  });

  it("throws when technicalSeo describes a different page than the requested url", () => {
    expect(() =>
      validator.validate(makeRequest({ technicalSeo: makeTechnicalSeo("https://oursite.com/electrical") })),
    ).toThrow(/appears to describe a different page/);
  });

  it("tolerates null websiteAudit/technicalSeo urls", () => {
    expect(() =>
      validator.validate(makeRequest({ websiteAudit: makeWebsiteAudit(null), technicalSeo: makeTechnicalSeo(null) })),
    ).not.toThrow();
  });

  it("findDestructiveActionSignals returns empty for a clean request", () => {
    expect(validator.findDestructiveActionSignals(makeRequest())).toEqual([]);
  });

  it("findDestructiveActionSignals returns empty for a routine, non-destructive update request", () => {
    const signals = validator.findDestructiveActionSignals(
      makeRequest({ updateRequests: ["Update the Yoast SEO plugin to the latest version"] }),
    );
    expect(signals).toEqual([]);
  });

  it("findDestructiveActionSignals detects a restore signal in an update request", () => {
    const signals = validator.findDestructiveActionSignals(
      makeRequest({ updateRequests: ["Restore last week's backup"] }),
    );
    expect(signals).toContain("backup restore");
  });

  it("findDestructiveActionSignals detects a deletion signal in a security alert", () => {
    const signals = validator.findDestructiveActionSignals(
      makeRequest({ securityAlerts: ["Delete the compromised admin account"] }),
    );
    expect(signals).toContain("deletion");
  });

  it("findDestructiveActionSignals never returns duplicate labels", () => {
    const signals = validator.findDestructiveActionSignals(
      makeRequest({ updateRequests: ["delete this", "delete that", "please delete everything"] }),
    );
    expect(signals).toEqual(["deletion"]);
  });
});
