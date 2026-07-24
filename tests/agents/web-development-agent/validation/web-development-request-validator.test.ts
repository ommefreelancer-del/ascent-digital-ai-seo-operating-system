import { describe, expect, it } from "vitest";
import {
  WebDevelopmentRequestValidator,
  WebDevelopmentValidationError,
} from "../../../../src/agents/web-development-agent/validation/web-development-request-validator.js";
import type { WebDevelopmentRequest } from "../../../../src/agents/web-development-agent/types/web-development-request.types.js";
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

function makeRequest(overrides: Partial<WebDevelopmentRequest> = {}): WebDevelopmentRequest {
  return {
    id: "req-1",
    websiteAudit: makeWebsiteAudit("https://oursite.com/plumbing"),
    technicalSeo: makeTechnicalSeo("https://oursite.com/plumbing"),
    ...overrides,
  };
}

describe("WebDevelopmentRequestValidator", () => {
  const validator = new WebDevelopmentRequestValidator();

  it("accepts a well-formed, internally consistent request", () => {
    expect(() => validator.validate(makeRequest())).not.toThrow();
  });

  it("throws when websiteAudit and technicalSeo describe different pages", () => {
    expect(() =>
      validator.validate(makeRequest({ technicalSeo: makeTechnicalSeo("https://oursite.com/electrical") })),
    ).toThrow(WebDevelopmentValidationError);
  });

  it("tolerates null websiteAudit/technicalSeo urls", () => {
    expect(() =>
      validator.validate(makeRequest({ websiteAudit: makeWebsiteAudit(null), technicalSeo: makeTechnicalSeo(null) })),
    ).not.toThrow();
  });

  it("findDestructiveActionSignals returns empty for a clean request", () => {
    expect(validator.findDestructiveActionSignals(makeRequest())).toEqual([]);
  });

  it("findDestructiveActionSignals returns empty for a routine bug report", () => {
    const signals = validator.findDestructiveActionSignals(
      makeRequest({ bugReports: ["The contact form submit button does not work on mobile."] }),
    );
    expect(signals).toEqual([]);
  });

  it("findDestructiveActionSignals detects a deletion signal in a bug report", () => {
    const signals = validator.findDestructiveActionSignals(makeRequest({ bugReports: ["Delete the old user table."] }));
    expect(signals).toContain("deletion");
  });

  it("findDestructiveActionSignals detects hardcoded credentials in a design asset", () => {
    const signals = validator.findDestructiveActionSignals(
      makeRequest({ designAssets: ["Hardcode the API key in the config file for now."] }),
    );
    expect(signals).toContain("hardcoded credentials");
  });

  it("findDestructiveActionSignals detects disabling a security control in business requirements", () => {
    const signals = validator.findDestructiveActionSignals(
      makeRequest({ businessRequirements: "Disable SSL for the staging subdomain." }),
    );
    expect(signals).toContain("disabling a security control");
  });

  it("findDestructiveActionSignals never returns duplicate labels", () => {
    const signals = validator.findDestructiveActionSignals(
      makeRequest({ bugReports: ["delete this", "delete that", "please delete everything"] }),
    );
    expect(signals).toEqual(["deletion"]);
  });
});
