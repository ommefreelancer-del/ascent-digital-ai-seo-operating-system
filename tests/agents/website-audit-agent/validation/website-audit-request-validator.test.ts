import { describe, expect, it } from "vitest";
import {
  WebsiteAuditRequestValidator,
  WebsiteAuditValidationError,
} from "../../../../src/agents/website-audit-agent/validation/website-audit-request-validator.js";
import { extractHtmlFacts } from "../../../../src/agents/website-audit-agent/parsing/html-fact-extractor.js";
import type { WebsiteAuditRequest } from "../../../../src/agents/website-audit-agent/types/website-audit-request.types.js";

function makeRequest(overrides: Partial<WebsiteAuditRequest> = {}): WebsiteAuditRequest {
  return {
    id: "req-1",
    html: "<html><body><h1>Hi</h1></body></html>",
    ...overrides,
  };
}

describe("WebsiteAuditRequestValidator.validate", () => {
  const validator = new WebsiteAuditRequestValidator();

  it("accepts a well-formed request", () => {
    expect(() => validator.validate(makeRequest())).not.toThrow();
  });

  it("throws when html is empty", () => {
    expect(() => validator.validate(makeRequest({ html: "   " }))).toThrow(WebsiteAuditValidationError);
  });

  it("throws when url is not a valid absolute URL", () => {
    expect(() => validator.validate(makeRequest({ url: "not a url" }))).toThrow(WebsiteAuditValidationError);
  });

  it("throws when url uses a non-http(s) scheme", () => {
    expect(() => validator.validate(makeRequest({ url: "ftp://example.com/page" }))).toThrow(
      WebsiteAuditValidationError,
    );
  });

  it("accepts a valid https url", () => {
    expect(() => validator.validate(makeRequest({ url: "https://example.com/page" }))).not.toThrow();
  });
});

describe("WebsiteAuditRequestValidator.looksAmbiguous", () => {
  const validator = new WebsiteAuditRequestValidator();

  it("is false for a real-looking page", () => {
    const facts = extractHtmlFacts("<html><body><h1>Hi</h1></body></html>");
    expect(validator.looksAmbiguous(facts)).toBe(false);
  });

  it("is true when both <html> and <body> are missing", () => {
    const facts = extractHtmlFacts("just some plain text, not a page");
    expect(validator.looksAmbiguous(facts)).toBe(true);
  });

  it("is false when only <body> is present without <html> (still looks like real markup)", () => {
    const facts = extractHtmlFacts("<body><h1>Fragment</h1></body>");
    expect(validator.looksAmbiguous(facts)).toBe(false);
  });
});
