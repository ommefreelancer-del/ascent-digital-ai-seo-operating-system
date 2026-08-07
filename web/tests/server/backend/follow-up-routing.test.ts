import { describe, expect, it } from "vitest";
import { isWebsiteAuditFollowUp, matchWebsiteAuditFollowUpTerm, shouldRouteBackToWebsiteAuditAgent, WEBSITE_AUDIT_AGENT_ID } from "../../../src/server/backend/follow-up-routing";

// REGRESSION: after Website Audit Agent completes a task, a follow-up
// referencing "the previous audit" was being answered by the Boss Agent
// instead of routed back to Website Audit Agent. These tests lock in the
// exact required behavior: only fires when the previous task really was
// Website Audit Agent AND the message really contains one of the required
// follow-up terms -- never a guess, never a false positive on unrelated
// follow-ups or unrelated previous agents.

describe("matchWebsiteAuditFollowUpTerm / isWebsiteAuditFollowUp", () => {
  const REQUIRED_TERMS = [
    "previous audit",
    "previous report",
    "findings",
    "evidence",
    "validation",
    "review",
    "audit quality",
    "duplicate findings",
    "contradictions",
  ];

  it.each(REQUIRED_TERMS)("detects the required term %j inside a real sentence", (term) => {
    const message = `Can you tell me more about the ${term} from that?`;
    expect(isWebsiteAuditFollowUp(message)).toBe(true);
    expect(matchWebsiteAuditFollowUpTerm(message)?.toLowerCase()).toBe(term);
  });

  it("is case-insensitive", () => {
    expect(isWebsiteAuditFollowUp("What were the FINDINGS?")).toBe(true);
    expect(isWebsiteAuditFollowUp("Any Contradictions in there?")).toBe(true);
  });

  it("does not match when none of the required terms are present", () => {
    expect(isWebsiteAuditFollowUp("Write a blog about Technical SEO.")).toBe(false);
    expect(isWebsiteAuditFollowUp("Research keywords for AI Automation.")).toBe(false);
  });

  it("matches on real word boundaries only, not as a substring of an unrelated word", () => {
    // "reviewing" and "previewed" contain "review" but are not the word "review".
    expect(isWebsiteAuditFollowUp("I'm reviewing the calendar for next week.")).toBe(false);
    expect(isWebsiteAuditFollowUp("The design was previewed yesterday.")).toBe(false);
  });

  it("returns the real matched term verbatim, not a fabricated one", () => {
    expect(matchWebsiteAuditFollowUpTerm("Any duplicate findings we should know about?")).toBe("duplicate findings");
    expect(matchWebsiteAuditFollowUpTerm("Can you validate the audit quality?")).toBe("audit quality");
  });
});

describe("shouldRouteBackToWebsiteAuditAgent", () => {
  it("fires when the previous task was Website Audit Agent and the message is a real follow-up", () => {
    expect(shouldRouteBackToWebsiteAuditAgent(WEBSITE_AUDIT_AGENT_ID, "What are the findings from that audit?")).toBe(true);
    expect(shouldRouteBackToWebsiteAuditAgent(WEBSITE_AUDIT_AGENT_ID, "Are there any contradictions in the report?")).toBe(true);
    expect(shouldRouteBackToWebsiteAuditAgent(WEBSITE_AUDIT_AGENT_ID, "Can you review the evidence again?")).toBe(true);
  });

  // REGRESSION: must not fire just because the message happens to contain a
  // follow-up term -- the previous task must genuinely have been Website
  // Audit Agent, or there is nothing to "route back" to.
  it("does not fire when the previous task was a different agent", () => {
    expect(shouldRouteBackToWebsiteAuditAgent("seo-content-agent", "What are the findings from that?")).toBe(false);
    expect(shouldRouteBackToWebsiteAuditAgent("keyword-research-agent", "Any contradictions in the review?")).toBe(false);
  });

  it("does not fire when there is no previous task at all (new session)", () => {
    expect(shouldRouteBackToWebsiteAuditAgent(null, "What are the findings?")).toBe(false);
  });

  // REGRESSION: must not fire on an unrelated follow-up even when the
  // previous task really was Website Audit Agent -- only the required terms
  // trigger the override, per the task's exact scope.
  it("does not fire when the message is unrelated to a follow-up, even after Website Audit Agent", () => {
    expect(shouldRouteBackToWebsiteAuditAgent(WEBSITE_AUDIT_AGENT_ID, "Write a blog about Technical SEO.")).toBe(false);
    expect(shouldRouteBackToWebsiteAuditAgent(WEBSITE_AUDIT_AGENT_ID, "Research keywords for AI Automation.")).toBe(false);
  });
});
