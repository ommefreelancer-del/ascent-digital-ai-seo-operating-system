// The default GoogleSheetsProvider: honestly reports that no real
// spreadsheet data is available, rather than fabricating any. This is what
// GoogleSheetsIntegrationAgent.create() uses until a real provider (backed
// by the Google Sheets/Drive API) is deliberately wired in and approved per
// GLOBAL_RULES.md SS9 ("connecting external services" requires human
// approval).

import type {
  GoogleSheetsFetchRequest,
  GoogleSheetsProvider,
  GoogleSheetsSnapshot,
} from "../types/google-sheets-provider.types.js";

export class NullGoogleSheetsProvider implements GoogleSheetsProvider {
  readonly name = "none-configured";

  async fetchSheetSnapshot(_request: GoogleSheetsFetchRequest): Promise<GoogleSheetsSnapshot | null> {
    return null;
  }
}
