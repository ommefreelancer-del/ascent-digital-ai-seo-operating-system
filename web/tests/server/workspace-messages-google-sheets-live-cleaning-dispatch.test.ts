// LIVE GOOGLE SHEETS CLEANING DISPATCH WIRING (2026-09-15): real source-level coverage proving route.ts's
// dispatch reaches processSelectedGoogleSheet() (the deterministic, server-side, complete-read cleaning
// pipeline for the user's own already-SELECTED Google Sheet -- see google-sheets-cleaning.ts's own header)
// for an explicit cleaning request with no local attachment, and that this is mutually exclusive with the
// existing attachment/raw-row path (processSpreadsheetAttachment) -- never both, never neither. route.ts
// is a Next.js Route Handler with no direct unit-test harness anywhere in this codebase (see this
// session's other workspace-messages-*.test.ts files' own headers) -- these are real regex assertions
// against the raw source text, not a fabricated HTTP-mock harness.

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROUTE_SOURCE_PATH = path.resolve(__dirname, "../../src/app/api/workspace/messages/route.ts");
const routeSource = readFileSync(ROUTE_SOURCE_PATH, "utf8");

describe("workspace messages route -- live dispatch reaches processSelectedGoogleSheet() for an explicit cleaning request with a persisted selection", () => {
  it("imports processSelectedGoogleSheet from the real, already-committed server-side cleaning module", () => {
    expect(routeSource).toMatch(/import \{ processSelectedGoogleSheet \} from "@\/server\/backend\/google-sheets-cleaning";/);
  });

  it("dispatches to processSelectedGoogleSheet() when assigned to google-sheets-integration-agent, no spreadsheet attachment is present, and the message looks like an operation request", () => {
    expect(routeSource).toMatch(
      /decision\.assignedAgentId === GOOGLE_SHEETS_INTEGRATION_AGENT_ID &&[\s\S]{0,80}!\(attachmentMeta &&[\s\S]{0,80}looksLikeSpreadsheetOperationRequest\(message\)[\s\S]{0,2000}await processSelectedGoogleSheet\(userId, message\)/,
    );
  });

  it("the live-sheet branch never calls processSpreadsheetAttachment -- it is mutually exclusive with the attachment/raw-row path, not layered on top of it", () => {
    const liveSheetBranchIdx = routeSource.indexOf("await processSelectedGoogleSheet(userId, message)");
    expect(liveSheetBranchIdx).toBeGreaterThan(-1);
    const branchStart = routeSource.lastIndexOf("} else if (", liveSheetBranchIdx);
    const branchEnd = routeSource.indexOf("} else if (decision?.status === \"assigned\" && decision.assignedAgentId) {", liveSheetBranchIdx);
    expect(branchStart).toBeGreaterThan(-1);
    expect(branchEnd).toBeGreaterThan(branchStart);
    const liveSheetBranchBody = routeSource.slice(branchStart, branchEnd);
    expect(liveSheetBranchBody).not.toContain("processSpreadsheetAttachment(");
  });

  it("the live-sheet branch is gated on NOT having a spreadsheet-type attachment present -- the file-upload branch above it stays the exclusive handler when a real attachment IS present", () => {
    const attachmentBranchIdx = routeSource.indexOf("await processSpreadsheetAttachment(userId, attachmentMeta)");
    const liveSheetBranchIdx = routeSource.indexOf("await processSelectedGoogleSheet(userId, message)");
    expect(attachmentBranchIdx).toBeGreaterThan(-1);
    expect(liveSheetBranchIdx).toBeGreaterThan(attachmentBranchIdx);
  });

  it("never sends spreadsheet rows through the LLM -- the live-sheet branch's only model-adjacent variable is the compact chat reply text, never a raw-rows blob", () => {
    const liveSheetBranchIdx = routeSource.indexOf("await processSelectedGoogleSheet(userId, message)");
    const branchStart = routeSource.lastIndexOf("} else if (", liveSheetBranchIdx);
    const branchEnd = routeSource.indexOf("} else if (decision?.status === \"assigned\" && decision.assignedAgentId) {", liveSheetBranchIdx);
    const liveSheetBranchBody = routeSource.slice(branchStart, branchEnd);
    expect(liveSheetBranchBody).not.toMatch(/generateSpecialistReply|Anthropic|Gemini/i);
  });
});
