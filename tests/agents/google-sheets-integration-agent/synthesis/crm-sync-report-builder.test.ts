import { describe, expect, it } from "vitest";
import { CrmSyncReportBuilder } from "../../../../src/agents/google-sheets-integration-agent/synthesis/crm-sync-report-builder.js";
import type { CrmRecordUpdate } from "../../../../src/agents/ai-crm-agent/types/ai-crm-request.types.js";

function makeUpdate(overrides: Partial<CrmRecordUpdate> = {}): CrmRecordUpdate {
  return { recordType: "client", action: "update", identifier: "acme.com", summary: "Real summary.", requiresApproval: true, ...overrides };
}

describe("CrmSyncReportBuilder", () => {
  const builder = new CrmSyncReportBuilder();

  it("returns an empty report for no CRM record updates", () => {
    expect(builder.build([])).toEqual([]);
  });

  it("echoes every real CRM record update as a sync report entry", () => {
    const [entry] = builder.build([makeUpdate({ recordType: "prospect", action: "create", identifier: "new.com", summary: "New prospect." })]);
    expect(entry).toEqual({ identifier: "new.com", summary: "create prospect: New prospect." });
  });

  it("builds one entry per real CRM record update", () => {
    const updates = [makeUpdate({ identifier: "a.com" }), makeUpdate({ identifier: "b.com" })];
    expect(builder.build(updates)).toHaveLength(2);
  });
});
