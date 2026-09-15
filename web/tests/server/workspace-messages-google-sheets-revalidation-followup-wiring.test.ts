// GOOGLE SHEETS RE-VALIDATION FOLLOW-UP FIX (2026-09-15): real source-level coverage proving route.ts
// actually WIRES resolveFollowUp()'s "route_back_to_google_sheets_integration" decision (see
// follow-up-routing.ts's own header for the real, PDF-documented, live-reported defect this closes -- a
// follow-up like "Now validate this live -- run it again and confirm the result." was scored "Website
// Audit Agent" at 0.44, below the 0.50 auto-assign threshold, leaving the Task Progress UI showing
// "Rejected" even though a fresh Google Sheets cleaning reply was still produced underneath) into a real
// "assigned to google-sheets-integration-agent" RoutingDecision, the same way it already wires
// "route_back_to_website_audit". Same convention as this session's other workspace-messages-*.test.ts
// files: route.ts is a Next.js Route Handler with no direct unit-test harness in this codebase, so these
// are real regex/substring assertions against the raw source text -- the decision LOGIC itself
// (resolveFollowUp/shouldRouteBackToGoogleSheetsIntegration) is fully covered, with no mocks, in
// tests/server/backend/follow-up-routing.test.ts.

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROUTE_SOURCE_PATH = path.resolve(__dirname, "../../src/app/api/workspace/messages/route.ts");
const routeSource = readFileSync(ROUTE_SOURCE_PATH, "utf8");

describe("workspace messages route -- wires resolveFollowUp()'s route_back_to_google_sheets_integration decision", () => {
  it("handles followUp.kind === \"route_back_to_google_sheets_integration\" as its own branch, immediately after route_back_to_website_audit", () => {
    const websiteAuditBranchIdx = routeSource.indexOf('} else if (followUp.kind === "route_back_to_website_audit") {');
    const googleSheetsBranchIdx = routeSource.indexOf('} else if (followUp.kind === "route_back_to_google_sheets_integration") {');
    expect(websiteAuditBranchIdx).toBeGreaterThan(-1);
    expect(googleSheetsBranchIdx).toBeGreaterThan(websiteAuditBranchIdx);
  });

  it("constructs a genuine 'assigned' RoutingDecision naming google-sheets-integration-agent -- never left as the failed fresh classification", () => {
    const branchIdx = routeSource.indexOf('} else if (followUp.kind === "route_back_to_google_sheets_integration") {');
    const branchEnd = routeSource.indexOf("// The Boss Agent's RoutingDecision above is untouched.", branchIdx);
    expect(branchEnd).toBeGreaterThan(branchIdx);
    const branchBody = routeSource.slice(branchIdx, branchEnd);
    expect(branchBody).toMatch(/status:\s*"assigned"\s*as const/);
    expect(branchBody).toContain("assignedAgentId: GOOGLE_SHEETS_INTEGRATION_AGENT_ID");
    expect(branchBody).toContain("decision = overrideDecision;");
  });

  it("this override decision then falls through to the EXISTING, unchanged dispatch branches further below -- never a second, parallel dispatch mechanism", () => {
    const branchIdx = routeSource.indexOf('} else if (followUp.kind === "route_back_to_google_sheets_integration") {');
    const branchEnd = routeSource.indexOf("// The Boss Agent's RoutingDecision above is untouched.", branchIdx);
    const branchBody = routeSource.slice(branchIdx, branchEnd);
    // Checks the real CALL form (never a bare mention in this branch's own explanatory comment, which
    // does reference these function names by design).
    expect(branchBody).not.toContain("await processSelectedGoogleSheet(");
    expect(branchBody).not.toContain("await proposeExistingOutputTabCleanupForChat(");
    // The real dispatch still happens later, gated on decision.assignedAgentId === GOOGLE_SHEETS_INTEGRATION_AGENT_ID -- unchanged.
    expect(routeSource).toContain("await processSelectedGoogleSheet(userId, message)");
  });

  it("imports resolveFollowUp from the real, already-committed follow-up-routing module (no second routing system)", () => {
    expect(routeSource).toMatch(/import \{ resolveFollowUp, type PreviousCaseSnapshot \} from "@\/server\/backend\/follow-up-routing";/);
  });
});
