import { describe, expect, it } from "vitest";
import { DuplicateRecordFlagBuilder } from "../../../../src/agents/google-sheets-integration-agent/synthesis/duplicate-record-flag-builder.js";
import type { GoogleSheetsSnapshot } from "../../../../src/agents/google-sheets-integration-agent/types/google-sheets-provider.types.js";

function makeSnapshot(overrides: Partial<GoogleSheetsSnapshot> = {}): GoogleSheetsSnapshot {
  return { spreadsheetId: "sheet-1", existingRecords: [], source: "test-provider", retrievedAt: new Date().toISOString(), ...overrides };
}

describe("DuplicateRecordFlagBuilder", () => {
  const builder = new DuplicateRecordFlagBuilder();

  it("returns no flags when no snapshot is available", () => {
    expect(builder.build(null)).toEqual([]);
  });

  it("returns no flags when every real record is unique", () => {
    const snapshot = makeSnapshot({
      existingRecords: [
        { recordType: "client", identifier: "acme.com" },
        { recordType: "publisher", identifier: "acme.com" },
      ],
    });
    expect(builder.build(snapshot)).toEqual([]);
  });

  it("flags a real record type/identifier pair that appears more than once", () => {
    const snapshot = makeSnapshot({
      existingRecords: [
        { recordType: "client", identifier: "acme.com" },
        { recordType: "client", identifier: "acme.com" },
      ],
    });
    const flags = builder.build(snapshot);
    expect(flags).toHaveLength(1);
    expect(flags[0]).toEqual({ recordType: "client", identifier: "acme.com", note: "2 real rows found for this client in the spreadsheet." });
  });

  it("flags each duplicated pair only once even with three or more occurrences", () => {
    const snapshot = makeSnapshot({
      existingRecords: [
        { recordType: "publisher", identifier: "dup.com" },
        { recordType: "publisher", identifier: "dup.com" },
        { recordType: "publisher", identifier: "dup.com" },
      ],
    });
    const flags = builder.build(snapshot);
    expect(flags).toHaveLength(1);
    expect(flags[0]?.note).toContain("3 real rows");
  });
});
