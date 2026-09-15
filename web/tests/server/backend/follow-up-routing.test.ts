import { describe, expect, it } from "vitest";
import {
  hasFollowUpActionChanged,
  isWebsiteAuditFollowUp,
  matchWebsiteAuditFollowUpTerm,
  shouldRouteBackToWebsiteAuditAgent,
  isGoogleSheetsIntegrationFollowUp,
  matchGoogleSheetsIntegrationFollowUpTerm,
  shouldRouteBackToGoogleSheetsIntegration,
  resolveFollowUp,
  isCaseContinuationMessage,
  WEBSITE_AUDIT_AGENT_ID,
  type PreviousCaseSnapshot,
} from "../../../src/server/backend/follow-up-routing";

const GOOGLE_SHEETS_INTEGRATION_AGENT_ID = "google-sheets-integration-agent";

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

// REAL PRODUCTION REGRESSION (2026-08-14): "Audit my website." -> "Now fix
// the issues you found." was silently re-routed back to Website Audit Agent
// because it matched a context-continuity word, even though "fix" requests a
// completely different capability (real repo/file/CMS write access)
// website-audit-agent's own real Tools never claim. These tests exercise the
// REAL, compiled capability-classifier.ts via dynamic import from dist/ (the
// same frozen-backend boundary conversation.ts crosses) -- no mocks -- so
// they require the backend to already be built (`npm run build` at the repo
// root); the assertions below fail loudly, not silently, if dist/ is stale.
describe("hasFollowUpActionChanged (real capability-classifier.js from dist/, no mocks)", () => {
  it("TEST A: 'Now fix the issues you found.' is an action change (technical-remediation)", async () => {
    expect(await hasFollowUpActionChanged("Now fix the issues you found.")).toBe(true);
  });

  it("TEST B: 'Now optimize the existing page titles and meta descriptions.' is an action change (on-page-seo)", async () => {
    expect(await hasFollowUpActionChanged("Now optimize the existing page titles and meta descriptions.")).toBe(true);
  });

  it("TEST C: 'Now research keywords for the content gaps.' is an action change (keyword-research)", async () => {
    expect(await hasFollowUpActionChanged("Now research keywords for the content gaps.")).toBe(true);
  });

  it("TEST D: 'Now write the article.' is an action change (content-authoring)", async () => {
    expect(await hasFollowUpActionChanged("Now write the article.")).toBe(true);
  });

  it("TEST E: 'Show me more evidence.' is NOT an action change (still the same audit execution class)", async () => {
    expect(await hasFollowUpActionChanged("Show me more evidence.")).toBe(false);
  });

  it("a follow-up that merely asks about audit findings is NOT an action change", async () => {
    expect(await hasFollowUpActionChanged("What were the findings from that audit?")).toBe(false);
    expect(await hasFollowUpActionChanged("Any contradictions in the report?")).toBe(false);
  });
});

describe("shouldRouteBackToWebsiteAuditAgent", () => {
  it("fires when the previous task was Website Audit Agent and the message is a real follow-up with NO action change", async () => {
    expect(await shouldRouteBackToWebsiteAuditAgent(WEBSITE_AUDIT_AGENT_ID, "What are the findings from that audit?")).toBe(true);
    expect(await shouldRouteBackToWebsiteAuditAgent(WEBSITE_AUDIT_AGENT_ID, "Are there any contradictions in the report?")).toBe(true);
    expect(await shouldRouteBackToWebsiteAuditAgent(WEBSITE_AUDIT_AGENT_ID, "Can you review the evidence again?")).toBe(true);
  });

  // REGRESSION: must not fire just because the message happens to contain a
  // follow-up term -- the previous task must genuinely have been Website
  // Audit Agent, or there is nothing to "route back" to.
  it("does not fire when the previous task was a different agent", async () => {
    expect(await shouldRouteBackToWebsiteAuditAgent("seo-content-agent", "What are the findings from that?")).toBe(false);
    expect(await shouldRouteBackToWebsiteAuditAgent("keyword-research-agent", "Any contradictions in the review?")).toBe(false);
  });

  it("does not fire when there is no previous task at all (new session)", async () => {
    expect(await shouldRouteBackToWebsiteAuditAgent(null, "What are the findings?")).toBe(false);
  });

  // REGRESSION: must not fire on an unrelated follow-up even when the
  // previous task really was Website Audit Agent -- only the required terms
  // trigger the override, per the task's exact scope.
  it("does not fire when the message is unrelated to a follow-up, even after Website Audit Agent", async () => {
    expect(await shouldRouteBackToWebsiteAuditAgent(WEBSITE_AUDIT_AGENT_ID, "Write a blog about Technical SEO.")).toBe(false);
    expect(await shouldRouteBackToWebsiteAuditAgent(WEBSITE_AUDIT_AGENT_ID, "Research keywords for AI Automation.")).toBe(false);
  });

  // THE CORE 2026-08-14 REGRESSION FIX: even when the message DOES match a
  // context-continuity term, if it ALSO requests a genuinely different
  // action, the override must not fire -- routing falls through to a fresh
  // Boss Agent decision instead. Each of these deliberately also contains a
  // real context-continuity word (review/findings/evidence) alongside the
  // action change, exactly reproducing the real incident's shape (the UI's
  // own "matched term: 'evidence'" justification).
  it("REGRESSION: does not fire for 'fix the issues' even when phrased as a follow-up referencing prior findings", async () => {
    expect(await shouldRouteBackToWebsiteAuditAgent(WEBSITE_AUDIT_AGENT_ID, "Now fix the issues you found in your review.")).toBe(false);
    expect(await shouldRouteBackToWebsiteAuditAgent(WEBSITE_AUDIT_AGENT_ID, "Based on the evidence, now fix the issues.")).toBe(false);
  });

  it("REGRESSION: does not fire for the exact literal mandatory-regression message", async () => {
    expect(await shouldRouteBackToWebsiteAuditAgent(WEBSITE_AUDIT_AGENT_ID, "Now fix the issues you found.")).toBe(false);
    expect(await shouldRouteBackToWebsiteAuditAgent(WEBSITE_AUDIT_AGENT_ID, "Now fix the robots.txt and sitemap.xml issues you found.")).toBe(false);
  });

  it("REGRESSION: does not fire for on-page/keyword/content follow-ups even if they reference prior findings", async () => {
    expect(await shouldRouteBackToWebsiteAuditAgent(WEBSITE_AUDIT_AGENT_ID, "Based on the findings, now optimize the existing page titles and meta descriptions.")).toBe(false);
    expect(await shouldRouteBackToWebsiteAuditAgent(WEBSITE_AUDIT_AGENT_ID, "Given that review, now research keywords for the content gaps.")).toBe(false);
    expect(await shouldRouteBackToWebsiteAuditAgent(WEBSITE_AUDIT_AGENT_ID, "Following those findings, now write the article.")).toBe(false);
  });

  // TEST E, exercised through the full override function: the execution
  // intent has NOT changed, so the override still correctly fires -- proves
  // the fix is not simply "always re-route follow-ups away."
  it("TEST E: still fires for a genuine same-context evidence request (no action change)", async () => {
    expect(await shouldRouteBackToWebsiteAuditAgent(WEBSITE_AUDIT_AGENT_ID, "Can you show me more evidence and review the findings again?")).toBe(true);
  });
});

// GOOGLE SHEETS RE-VALIDATION FOLLOW-UP FIX (2026-09-15): a real, live-reported production defect --
// PDF-documented ("Now validate this live -- run it again and confirm the result." after a completed
// Google Sheets Integration Agent cleaning task) -- was scored "Website Audit Agent" at 0.44 (below the
// 0.50 auto-assign threshold) and failed to route automatically at all, showing "Rejected" in the Task
// Progress UI even though route.ts's own dispatch bypass still produced a correct, fresh cleaning reply.
// These tests are the exact symmetric counterpart of the shouldRouteBackToWebsiteAuditAgent suite above.
describe("matchGoogleSheetsIntegrationFollowUpTerm / isGoogleSheetsIntegrationFollowUp", () => {
  it("detects a real spreadsheet-operation verb inside a genuine revalidation follow-up, without relying on one exact phrase", () => {
    for (const message of [
      "Now validate this live -- run it again and confirm the result.",
      "Please re-validate the sheet.",
      "Can you re-analyze it?",
      "Compare it against the last run.",
    ]) {
      expect(isGoogleSheetsIntegrationFollowUp(message)).toBe(true);
    }
  });

  it("returns the real matched term verbatim, not a fabricated one", () => {
    expect(matchGoogleSheetsIntegrationFollowUpTerm("Now validate this live -- run it again and confirm the result.")).toBe("validate");
  });

  it("does not match when the message has no recognizable spreadsheet-operation verb at all", () => {
    expect(isGoogleSheetsIntegrationFollowUp("What's the weather like today?")).toBe(false);
    expect(isGoogleSheetsIntegrationFollowUp("Thanks!")).toBe(false);
  });
});

describe("shouldRouteBackToGoogleSheetsIntegration", () => {
  it("fires when the previous task was Google Sheets Integration Agent and the message is a real spreadsheet-operation follow-up with NO action change", async () => {
    expect(await shouldRouteBackToGoogleSheetsIntegration(GOOGLE_SHEETS_INTEGRATION_AGENT_ID, "Now validate this live -- run it again and confirm the result.")).toBe(true);
    expect(await shouldRouteBackToGoogleSheetsIntegration(GOOGLE_SHEETS_INTEGRATION_AGENT_ID, "Please validate it again.")).toBe(true);
  });

  // REGRESSION: must not fire just because the message happens to contain a spreadsheet-operation verb --
  // the previous task must genuinely have been Google Sheets Integration Agent.
  it("does not fire when the previous task was a different agent (including Website Audit Agent)", async () => {
    expect(await shouldRouteBackToGoogleSheetsIntegration(WEBSITE_AUDIT_AGENT_ID, "Now validate this live -- run it again and confirm the result.")).toBe(false);
    expect(await shouldRouteBackToGoogleSheetsIntegration("seo-content-agent", "Please re-validate the sheet.")).toBe(false);
  });

  it("does not fire when there is no previous task at all (new session)", async () => {
    expect(await shouldRouteBackToGoogleSheetsIntegration(null, "Now validate this live -- run it again and confirm the result.")).toBe(false);
  });

  it("does not fire when the message is unrelated to a spreadsheet operation, even after Google Sheets Integration Agent", async () => {
    expect(await shouldRouteBackToGoogleSheetsIntegration(GOOGLE_SHEETS_INTEGRATION_AGENT_ID, "Write a blog about Technical SEO.")).toBe(false);
    expect(await shouldRouteBackToGoogleSheetsIntegration(GOOGLE_SHEETS_INTEGRATION_AGENT_ID, "Research keywords for AI Automation.")).toBe(false);
  });

  // Mirrors the core Website Audit Agent regression fix: even when the message DOES match the broad
  // spreadsheet-operation pattern, if it ALSO requests a genuinely different action/domain, the override
  // must not fire. "validate" matches the spreadsheet pattern's own `valid\w*` term, but this message is
  // really an on-page-seo request, not a Google Sheets revalidation.
  it("REGRESSION: does not fire when the shared 'valid*' vocabulary is actually a different domain's request", async () => {
    expect(
      await shouldRouteBackToGoogleSheetsIntegration(GOOGLE_SHEETS_INTEGRATION_AGENT_ID, "Now validate and optimize the existing page titles and meta descriptions."),
    ).toBe(false);
  });
});

describe("isCaseContinuationMessage", () => {
  it("recognizes this task's own example follow-up phrases", () => {
    for (const message of ["Show me the findings.", "Please continue.", "What happens next?", "Approve it.", "Check again.", "Why did it fail?"]) {
      expect(isCaseContinuationMessage(message)).toBe(true);
    }
  });

  it("does not fire on an unrelated, fresh request", () => {
    expect(isCaseContinuationMessage("Write a 700-word SEO blog introduction about reducing stress.")).toBe(false);
  });
});

// PRODUCTION ROUTING FIX (2026-08-15, system-consistency pass) -- resolveFollowUp()
// is the single, unified decision this task's own "CASE CONTINUITY" section
// requires. CONFIRMED LIVE DEFECT this closes: a follow-up to an open,
// Boss-owned ("orchestrated") case -- e.g. "show me the findings" after a
// real end_to_end_seo request -- was being silently re-routed back to
// Website Audit Agent, discarding Boss's ownership of the case.
describe("resolveFollowUp (real dist/, no mocks -- the unified case-continuity decision)", () => {
  const openEndToEndCase: PreviousCaseSnapshot = { assignedAgentId: null, status: "orchestrated", taskIntent: "end_to_end_seo" };
  const completedAuditOnlyCase: PreviousCaseSnapshot = { assignedAgentId: WEBSITE_AUDIT_AGENT_ID, status: "assigned", taskIntent: "audit_only" };
  const noOpenCase: PreviousCaseSnapshot = { assignedAgentId: null, status: null, taskIntent: null };

  // Regression 11/12/13: the exact confirmed defect -- each of this task's
  // own example follow-ups to an open end_to_end_seo case must resume that
  // case, never fall back to Website Audit Agent (fresh classification for
  // each of these alone is typically "escalated"/low-confidence, never
  // "assigned" to a specific specialist).
  it.each(["Show me the findings.", "Please continue.", "Now fix the issues.", "What happens next?"])(
    "11/12/13: %j after an open end_to_end_seo case resumes that case, never routes back to website-audit-agent",
    async (message) => {
      const result = await resolveFollowUp(openEndToEndCase, "escalated", undefined, message, false);
      expect(result.kind).toBe("resume_orchestrated_case");
      if (result.kind === "resume_orchestrated_case") expect(result.taskIntent).toBe("end_to_end_seo");
    },
  );

  // Regression 14/15: approval/verification-resume style follow-ups also
  // resume the case (the real approve/check-again actions themselves are a
  // dedicated UI flow -- see route.ts's own in-flight-verification-resume
  // block -- but a stray chat message using this language must still never
  // discard Boss's ownership of the case).
  it("14/15: 'Approve it.' / 'Check again.' after an open case resume that case", async () => {
    for (const message of ["Approve it.", "Check again."]) {
      const result = await resolveFollowUp(openEndToEndCase, "escalated", undefined, message, false);
      expect(result.kind).toBe("resume_orchestrated_case");
    }
  });

  // Rule 1: a FRESH, confident orchestrated classification always wins --
  // never second-guessed by the continuation heuristic, even for an open
  // previous case.
  it("a fresh, confidently orchestrated classification is used as-is, never overridden", async () => {
    const result = await resolveFollowUp(openEndToEndCase, "orchestrated", undefined, "Audit this different concern and fix everything you can.", false);
    expect(result.kind).toBe("use_fresh_decision");
  });

  // Regression 16: unchanged, pre-existing behavior -- a follow-up to a
  // COMPLETED audit_only case (not an open orchestrated one) still routes
  // back to Website Audit Agent exactly as before.
  it("16: a findings follow-up after a completed audit_only case still routes back to website-audit-agent", async () => {
    const result = await resolveFollowUp(completedAuditOnlyCase, "escalated", undefined, "What were the findings?", false);
    expect(result.kind).toBe("route_back_to_website_audit");
  });

  // GOOGLE SHEETS RE-VALIDATION FOLLOW-UP FIX (2026-09-15): the exact PDF-documented, live-reported
  // defect -- reproduces the real fresh classification outcome observed live ("Best match Website Audit
  // Agent scored 0.44, below the auto-assign threshold of 0.50" -- i.e. `freshStatus` is NOT "assigned",
  // not "orchestrated", and carries no explicit-agent-match rationale). Without this fix, resolveFollowUp
  // fell through every rule to "use_fresh_decision", leaving the Boss Agent's failed, unrelated
  // low-confidence guess as the displayed/persisted routing decision even though a fresh Google Sheets
  // read still happened underneath.
  const completedGoogleSheetsCase: PreviousCaseSnapshot = { assignedAgentId: GOOGLE_SHEETS_INTEGRATION_AGENT_ID, status: "assigned", taskIntent: null };
  it("PDF-DOCUMENTED REGRESSION: 'Now validate this live -- run it again and confirm the result.' after a completed Google Sheets Integration Agent task routes back to it, never left as a failed low-confidence guess", async () => {
    const result = await resolveFollowUp(
      completedGoogleSheetsCase,
      undefined,
      "Best match \"Website Audit Agent\" scored 0.44, below the auto-assign threshold of 0.50.",
      "Now validate this live — run it again and confirm the result.",
      false,
    );
    expect(result.kind).toBe("route_back_to_google_sheets_integration");
    if (result.kind === "route_back_to_google_sheets_integration") expect(result.matchedTerm).toBe("validate");
  });

  it("a spreadsheet-operation follow-up after a completed audit_only case (a DIFFERENT previous agent) does not route to Google Sheets Integration Agent", async () => {
    const result = await resolveFollowUp(completedAuditOnlyCase, "escalated", undefined, "Now validate this live -- run it again and confirm the result.", false);
    expect(result.kind).not.toBe("route_back_to_google_sheets_integration");
  });

  it("a website-audit follow-up term after a completed Google Sheets Integration Agent case does not route to Website Audit Agent", async () => {
    const result = await resolveFollowUp(completedGoogleSheetsCase, "escalated", undefined, "What were the findings?", false);
    expect(result.kind).not.toBe("route_back_to_website_audit");
  });

  it("a clearly new task after a completed Google Sheets Integration Agent case is not resumed as a revalidation", async () => {
    const result = await resolveFollowUp(completedGoogleSheetsCase, "escalated", undefined, "Now validate this live -- run it again and confirm the result.", true);
    expect(result.kind).toBe("use_fresh_decision");
  });

  // Regression 17: a clearly NEW, unrelated task (different site) after an
  // open case does NOT resume the old case.
  it("17: a message naming a different site after an open case is treated as a new task, not resumed", async () => {
    const result = await resolveFollowUp(openEndToEndCase, "assigned", undefined, "Audit https://a-completely-different-site.example instead.", true);
    expect(result.kind).toBe("use_fresh_decision");
  });

  // A confident, high-scoring assignment to a genuinely different
  // specialist (no continuation language, no shared vocabulary with the
  // open case) is respected as a new task even without a new URL --
  // otherwise every subsequent message would be trapped inside the first
  // open case forever.
  it("a confident fresh specialist assignment with no continuation language is treated as a new task", async () => {
    const result = await resolveFollowUp(openEndToEndCase, "assigned", undefined, "Write a 700-word SEO blog introduction about reducing stress.", false);
    expect(result.kind).toBe("use_fresh_decision");
  });

  it("no open case and no previous Website Audit Agent task -- always uses the fresh decision", async () => {
    const result = await resolveFollowUp(noOpenCase, "escalated", undefined, "Show me the findings.", false);
    expect(result.kind).toBe("use_fresh_decision");
  });

  it("an open case is not resumed when looksLikeNewTask is true, even for continuation language", async () => {
    const result = await resolveFollowUp(openEndToEndCase, "escalated", undefined, "Continue.", true);
    expect(result.kind).toBe("use_fresh_decision");
  });
});
