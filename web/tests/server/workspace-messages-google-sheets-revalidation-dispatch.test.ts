// GOOGLE SHEETS RE-VALIDATION STRUCTURAL BYPASS (2026-09-15): real source-level coverage proving
// route.ts's forceGoogleSheetsRevalidation bypass exists and is wired ahead of every decision-based
// branch (human_approval_gate, boss_retained, auditUrl, the generic specialist-reply branch, etc.) -- the
// real, live-reported defect this closes: a follow-up "validate this"/"run this again" message, with no
// spreadsheet attachment, was answered from stale conversation history (reusing the PREVIOUS turn's real
// Google Sheets cleaning result) instead of re-executing the read-only cleaning pipeline, because the
// chat-only dispatch further below depends entirely on TagWeightedRoutingStrategy freshly re-assigning
// google-sheets-integration-agent for THIS message -- but hasSpreadsheetProcessingIntent() only boosts
// that agent's score when a spreadsheet ATTACHMENT is present (tag-weighted-routing-strategy.ts), so a
// short, attachment-free follow-up using generic verbs can score higher for an unrelated specialist (or
// fail to assign at all) and never reach the real cleaning dispatch. Same convention as this session's
// other workspace-messages-*.test.ts files: route.ts is a Next.js Route Handler with no direct
// unit-test harness in this codebase, so these are real regex/substring assertions against the raw
// source text, not a fabricated HTTP-mock harness.

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROUTE_SOURCE_PATH = path.resolve(__dirname, "../../src/app/api/workspace/messages/route.ts");
const routeSource = readFileSync(ROUTE_SOURCE_PATH, "utf8");

describe("workspace messages route -- forceGoogleSheetsRevalidation structural bypass", () => {
  it("defines forceGoogleSheetsRevalidation, anchored on this session's own last REAL agent assignment being google-sheets-integration-agent", () => {
    expect(routeSource).toMatch(
      /const forceGoogleSheetsRevalidation =[\s\S]{0,400}lastRealAgentAssignment\?\.agentId === GOOGLE_SHEETS_INTEGRATION_AGENT_ID/,
    );
  });

  it("never fires for a genuinely new task, an attachment-bearing message, or a message that doesn't look like a spreadsheet operation", () => {
    const defStart = routeSource.indexOf("const forceGoogleSheetsRevalidation =");
    const defEnd = routeSource.indexOf(";", defStart);
    const definition = routeSource.slice(defStart, defEnd);
    expect(definition).toContain("!looksLikeNewTask");
    expect(definition).toContain("looksLikeSpreadsheetOperationRequest(message)");
    expect(definition).toMatch(/!\(attachmentMeta && SPREADSHEET_FILE_TYPES\.has\(attachmentMeta\.fileType\)\)/);
    expect(definition).toContain("!cleaningApprovalReply.handled");
    expect(definition).toContain("!forceSpreadsheetProcessing");
  });

  it("is checked as its own branch, choosing between proposeExistingOutputTabCleanupForChat and processSelectedGoogleSheet the same way the decision-gated branches further below do", () => {
    const branchIdx = routeSource.indexOf("} else if (forceGoogleSheetsRevalidation) {");
    expect(branchIdx).toBeGreaterThan(-1);
    const branchEnd = routeSource.indexOf("} else if (decision?.status === \"human_approval_gate\") {", branchIdx);
    expect(branchEnd).toBeGreaterThan(branchIdx);
    const branchBody = routeSource.slice(branchIdx, branchEnd);
    expect(branchBody).toContain("detectExistingOutputTabSelfCleanupRequest(message)");
    expect(branchBody).toContain("await proposeExistingOutputTabCleanupForChat(userId, existingOutputTargets)");
    expect(branchBody).toContain("await processSelectedGoogleSheet(userId, message)");
  });

  it("is checked BEFORE human_approval_gate, boss_retained, and the auditUrl branch -- so a misrouted 'validate' follow-up can never be answered by a stale SEO audit or the generic role-play branch first", () => {
    const revalidationIdx = routeSource.indexOf("} else if (forceGoogleSheetsRevalidation) {");
    const humanApprovalGateIdx = routeSource.indexOf('} else if (decision?.status === "human_approval_gate") {');
    const bossRetainedIdx = routeSource.indexOf('} else if (decision?.status === "boss_retained"');
    const auditUrlIdx = routeSource.indexOf("} else if (auditUrl) {");
    expect(revalidationIdx).toBeGreaterThan(-1);
    expect(revalidationIdx).toBeLessThan(humanApprovalGateIdx);
    expect(revalidationIdx).toBeLessThan(bossRetainedIdx);
    expect(revalidationIdx).toBeLessThan(auditUrlIdx);
  });

  it("is checked AFTER cleaningApprovalReply/forceSpreadsheetProcessing -- an approve/reject reply or a real attachment upload still take priority, unchanged", () => {
    const forceSpreadsheetProcessingIdx = routeSource.indexOf("} else if (forceSpreadsheetProcessing) {");
    const revalidationIdx = routeSource.indexOf("} else if (forceGoogleSheetsRevalidation) {");
    expect(forceSpreadsheetProcessingIdx).toBeGreaterThan(-1);
    expect(revalidationIdx).toBeGreaterThan(forceSpreadsheetProcessingIdx);
  });

  it("never sends spreadsheet rows through the LLM -- the bypass branch's only model-adjacent variable is the compact chat reply text, never a raw-rows blob", () => {
    const branchIdx = routeSource.indexOf("} else if (forceGoogleSheetsRevalidation) {");
    const branchEnd = routeSource.indexOf("} else if (decision?.status === \"human_approval_gate\") {", branchIdx);
    const branchBody = routeSource.slice(branchIdx, branchEnd);
    expect(branchBody).not.toMatch(/generateSpecialistReply|Anthropic|Gemini/i);
  });
});
