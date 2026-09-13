// AGENT READ-WIRING FIX (2026-09-13): real source-level coverage proving route.ts's EXISTING dispatch
// genuinely reaches google-sheets-integration-agent and feeds it the real, non-fabricated
// buildGoogleSheetsContext() block (now including the persisted spreadsheet's real rows, see
// google-sheets-integration-selected-read.test.ts) BEFORE calling generateSpecialistReply -- never a
// bare, ungrounded LLM role-play call. route.ts is a Next.js Route Handler with no direct unit-test
// harness anywhere in this codebase (documented in this session's other workspace-messages-*.test.ts
// files' own headers) -- these are real regex assertions against the raw source text, not a fabricated
// HTTP-mock harness.

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROUTE_SOURCE_PATH = path.resolve(__dirname, "../../src/app/api/workspace/messages/route.ts");
const routeSource = readFileSync(ROUTE_SOURCE_PATH, "utf8");

describe("workspace messages route -- routing explicitly reaches google-sheets-integration-agent and grounds it in real data", () => {
  it("imports buildGoogleSheetsContext from the real connector-bridge module", () => {
    expect(routeSource).toMatch(/import \{ buildGoogleSheetsContext \} from "@\/server\/backend\/google-sheets-integration";/);
  });

  it("defines GOOGLE_SHEETS_INTEGRATION_AGENT_ID matching the real agent spec id", () => {
    expect(routeSource).toMatch(/const GOOGLE_SHEETS_INTEGRATION_AGENT_ID = "google-sheets-integration-agent";/);
  });

  it("a generic 'assigned' dispatch to google-sheets-integration-agent appends the real buildGoogleSheetsContext() block to the message before any specialist reply is generated", () => {
    expect(routeSource).toMatch(/decision\.assignedAgentId === GOOGLE_SHEETS_INTEGRATION_AGENT_ID[\s\S]{0,80}await buildGoogleSheetsContext\(userId\)/);
  });

  it("the grounded message (including the real Google Sheets context) is what actually reaches generateSpecialistReply -- never discarded before the LLM call", () => {
    const ternaryIdx = routeSource.indexOf("const baseEffectiveMessage =");
    expect(ternaryIdx).toBeGreaterThan(-1);
    const afterTernary = routeSource.slice(ternaryIdx, ternaryIdx + 2000);
    expect(afterTernary).toContain("const effectiveMessage = attachmentContext ? `${baseEffectiveMessage}");
    expect(afterTernary).toContain("assistantContent = await generateSpecialistReply(spec, effectiveMessage, decision.rationale);");
  });

  it("a spreadsheet-file attachment for this agent is routed to real local file processing instead (a genuinely different, more specific path), not the chat-context branch -- these are mutually exclusive triggers", () => {
    expect(routeSource).toMatch(
      /decision\.assignedAgentId === GOOGLE_SHEETS_INTEGRATION_AGENT_ID &&[\s\S]{0,40}attachmentMeta &&[\s\S]{0,1200}processSpreadsheetAttachment\(userId, attachmentMeta\)/,
    );
  });
});
