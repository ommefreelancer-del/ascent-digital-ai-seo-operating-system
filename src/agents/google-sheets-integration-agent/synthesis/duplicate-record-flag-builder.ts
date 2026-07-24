// Builds a real duplicate-record report -- per the spec's "Detect and
// prevent duplicate entries" responsibility. Flags only identifiers that
// the real GoogleSheetsProvider snapshot itself reports more than once for
// the same record type; with no snapshot (no provider configured), this
// agent cannot determine whether any real duplicates exist and returns no
// flags -- see GoogleSheetsIntegrationAgent's own limitation for this.

import type { GoogleSheetsSnapshot } from "../types/google-sheets-provider.types.js";
import type { DuplicateRecordFlag } from "../types/google-sheets-integration-request.types.js";

export class DuplicateRecordFlagBuilder {
  build(snapshot: GoogleSheetsSnapshot | null): DuplicateRecordFlag[] {
    if (snapshot === null) {
      return [];
    }

    const counts = new Map<string, number>();
    for (const record of snapshot.existingRecords) {
      const key = `${record.recordType}:${record.identifier}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }

    const flags: DuplicateRecordFlag[] = [];
    const flagged = new Set<string>();
    for (const record of snapshot.existingRecords) {
      const key = `${record.recordType}:${record.identifier}`;
      if ((counts.get(key) ?? 0) > 1 && !flagged.has(key)) {
        flagged.add(key);
        flags.push({
          recordType: record.recordType,
          identifier: record.identifier,
          note: `${counts.get(key)} real rows found for this ${record.recordType} in the spreadsheet.`,
        });
      }
    }
    return flags;
  }
}
