// EXISTING-OUTPUT-TAB SELF-CLEANUP DISPATCH WIRING (2026-09-21): real source-level coverage proving
// route.ts's dispatch reaches proposeExistingOutputTabCleanupForChat() -- the new capability that reads
// back ADASOS's OWN already-written output tab (e.g. "Admin - Vendor"), self-dedupes it, and proposes a
// clear-and-replace write -- for a request that explicitly names that tab and a dedup action, and that
// this branch is checked BEFORE (and is mutually exclusive with) the existing
// processSelectedGoogleSheet() "clean a source sheet into the destination" branch. Same convention as
// workspace-messages-google-sheets-live-cleaning-dispatch.test.ts: route.ts is a Next.js Route Handler
// with no direct unit-test harness in this codebase, so these are real regex assertions against the raw
// source text, not a fabricated HTTP-mock harness.

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROUTE_SOURCE_PATH = path.resolve(__dirname, "../../src/app/api/workspace/messages/route.ts");
const routeSource = readFileSync(ROUTE_SOURCE_PATH, "utf8");

describe("workspace messages route -- dispatch reaches proposeExistingOutputTabCleanupForChat() for an existing-output-tab self-dedup request", () => {
  it("imports detectExistingOutputTabSelfCleanupRequest and proposeExistingOutputTabCleanupForChat from the real, already-committed module", () => {
    expect(routeSource).toMatch(
      /import \{ detectExistingOutputTabSelfCleanupRequest, proposeExistingOutputTabCleanupForChat \} from "@\/server\/backend\/spreadsheet-existing-output-cleanup";/,
    );
  });

  it("dispatches to proposeExistingOutputTabCleanupForChat() when assigned to google-sheets-integration-agent, no spreadsheet attachment is present, and the message matches the self-cleanup detector", () => {
    expect(routeSource).toMatch(
      /decision\.assignedAgentId === GOOGLE_SHEETS_INTEGRATION_AGENT_ID &&[\s\S]{0,80}!\(attachmentMeta &&[\s\S]{0,80}detectExistingOutputTabSelfCleanupRequest\(message\)[\s\S]{0,1000}await proposeExistingOutputTabCleanupForChat\(userId, targets\)/,
    );
  });

  it("this branch is checked BEFORE the existing processSelectedGoogleSheet() branch, so a self-cleanup request is never intercepted by the source-into-destination flow", () => {
    const selfCleanupIdx = routeSource.indexOf("await proposeExistingOutputTabCleanupForChat(userId, targets)");
    const sourceIntoDestinationIdx = routeSource.indexOf("await processSelectedGoogleSheet(userId)");
    expect(selfCleanupIdx).toBeGreaterThan(-1);
    expect(sourceIntoDestinationIdx).toBeGreaterThan(-1);
    expect(selfCleanupIdx).toBeLessThan(sourceIntoDestinationIdx);
  });

  it("the self-cleanup branch never calls processSpreadsheetAttachment or processSelectedGoogleSheet -- mutually exclusive with both, not layered on top of either", () => {
    const selfCleanupIdx = routeSource.indexOf("await proposeExistingOutputTabCleanupForChat(userId, targets)");
    const branchStart = routeSource.lastIndexOf("} else if (", selfCleanupIdx);
    const branchEnd = routeSource.indexOf("await processSelectedGoogleSheet(userId)", selfCleanupIdx);
    expect(branchStart).toBeGreaterThan(-1);
    expect(branchEnd).toBeGreaterThan(branchStart);
    const selfCleanupBranchBody = routeSource.slice(branchStart, branchEnd);
    expect(selfCleanupBranchBody).not.toContain("processSpreadsheetAttachment(");
    expect(selfCleanupBranchBody).not.toContain("await processSelectedGoogleSheet(userId)");
  });

  it("never sends spreadsheet rows through the LLM -- the self-cleanup branch's only model-adjacent variable is the compact chat reply text, never a raw-rows blob", () => {
    const selfCleanupIdx = routeSource.indexOf("await proposeExistingOutputTabCleanupForChat(userId, targets)");
    const branchStart = routeSource.lastIndexOf("} else if (", selfCleanupIdx);
    const branchEnd = routeSource.indexOf("await processSelectedGoogleSheet(userId)", selfCleanupIdx);
    const selfCleanupBranchBody = routeSource.slice(branchStart, branchEnd);
    expect(selfCleanupBranchBody).not.toMatch(/generateSpecialistReply|Anthropic|Gemini/i);
  });
});
