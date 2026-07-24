import { describe, expect, it } from "vitest";
import { CrossFunctionalNotesBuilder } from "../../../../src/agents/on-page-seo-agent/recommendations/cross-functional-notes-builder.js";
import type { OnPageRecommendationContext } from "../../../../src/agents/on-page-seo-agent/recommendations/on-page-recommender.js";
import type { AuditFinding, WebsiteAuditResult } from "../../../../src/agents/website-audit-agent/types/website-audit-request.types.js";

function makeContext(findings: AuditFinding[]): OnPageRecommendationContext {
  const websiteAudit: WebsiteAuditResult = {
    requestId: "wa-1",
    url: "https://example.com/page",
    findings,
    summary: { criticalCount: 0, warningCount: 0, infoCount: 0 },
    limitations: [],
    decidedAt: new Date().toISOString(),
  };
  return { websiteAudit, targetKeyword: "plumber near me", intent: "informational" };
}

describe("CrossFunctionalNotesBuilder", () => {
  const builder = new CrossFunctionalNotesBuilder();

  it("surfaces a critical crawlability finding as a cross-functional note", () => {
    const findings: AuditFinding[] = [
      { category: "crawlability", severity: "critical", message: 'noindex found.', recommendation: "x" },
    ];
    const notes = builder.build(makeContext(findings));
    expect(notes.some((n) => n.includes("Technical SEO Agent"))).toBe(true);
  });

  it("surfaces a critical technical-seo (HTTPS) finding", () => {
    const findings: AuditFinding[] = [
      { category: "technical-seo", severity: "critical", message: "Uses http.", recommendation: "x" },
    ];
    expect(builder.build(makeContext(findings))).toHaveLength(1);
  });

  it("surfaces a robots-txt Disallow finding", () => {
    const findings: AuditFinding[] = [
      { category: "robots-txt", severity: "critical", message: "Disallow blocks this path.", recommendation: "x" },
    ];
    expect(builder.build(makeContext(findings))).toHaveLength(1);
  });

  it("does not surface an on-page-owned category (metadata, headings, etc.)", () => {
    const findings: AuditFinding[] = [
      { category: "metadata", severity: "critical", message: "No title.", recommendation: "x" },
    ];
    expect(builder.build(makeContext(findings))).toEqual([]);
  });

  it("does not surface a structured-data page-structure finding (handled by StructuredDataRecommender)", () => {
    const findings: AuditFinding[] = [
      { category: "page-structure", severity: "warning", message: "No structured data was found.", recommendation: "x" },
    ];
    expect(builder.build(makeContext(findings))).toEqual([]);
  });

  it("surfaces a non-structured-data page-structure finding (doctype/lang/viewport)", () => {
    const findings: AuditFinding[] = [
      { category: "page-structure", severity: "warning", message: "No <!DOCTYPE html> declaration was found.", recommendation: "x" },
    ];
    expect(builder.build(makeContext(findings))).toHaveLength(1);
  });

  it("does not surface an info-severity finding", () => {
    const findings: AuditFinding[] = [
      { category: "crawlability", severity: "info", message: "No robots meta tag.", recommendation: "x" },
    ];
    expect(builder.build(makeContext(findings))).toEqual([]);
  });
});
