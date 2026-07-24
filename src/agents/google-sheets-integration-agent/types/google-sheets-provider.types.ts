// The seam between "the agent needs to read the real, existing state of a
// Google Sheet" and "where that data actually comes from". GLOBAL_RULES.md
// SS2 (Anti-Hallucination Policy) forbids fabricating which client or
// publisher rows already exist in a real spreadsheet. No concrete provider
// backed by a real Google Sheets/Drive API connection ships in this build --
// only the interface and a NullGoogleSheetsProvider that honestly reports
// "unavailable" (see providers/null-google-sheets-provider.ts). A real
// provider can be plugged in later, once explicitly approved per
// GLOBAL_RULES.md SS9 ("connecting external services" requires human
// approval), without changing GoogleSheetsIntegrationAgent.

export interface GoogleSheetsFetchRequest {
  readonly spreadsheetId: string;
}

export type SheetRecordType = "client" | "publisher";

/** One real, existing row, as reported by the provider. Never inferred locally. */
export interface ExistingSheetRecord {
  readonly recordType: SheetRecordType;
  readonly identifier: string;
}

export interface GoogleSheetsSnapshot {
  readonly spreadsheetId: string;
  readonly existingRecords: readonly ExistingSheetRecord[];
  /** Which provider supplied this value, for traceability in the audit trail. */
  readonly source: string;
  readonly retrievedAt: string;
}

export interface GoogleSheetsProvider {
  readonly name: string;
  /**
   * Resolves to the real, current state of `request.spreadsheetId`, or
   * `null` if no data is available (no provider configured, spreadsheet not
   * found, etc). Implementations must never invent a value here -- `null`
   * is always the correct response when genuine data cannot be obtained.
   */
  fetchSheetSnapshot(request: GoogleSheetsFetchRequest): Promise<GoogleSheetsSnapshot | null>;
}
