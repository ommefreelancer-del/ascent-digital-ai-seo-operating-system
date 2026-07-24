// Compares the caller's real, authoritative NAP (Name/Address/Phone)
// against the real, live listing reported by the GbpDataProvider. `null`
// when no real listing data is available -- never assumed consistent or
// inconsistent without a real comparison.

import type { NapInfo } from "../types/gbp-data-provider.types.js";
import type { NapConsistencyCheck } from "../types/google-business-profile-request.types.js";

export class NapConsistencyBuilder {
  build(expectedNap: NapInfo, actualNap: NapInfo | null): NapConsistencyCheck {
    if (!actualNap) {
      return { isConsistent: null, discrepancies: [] };
    }

    const discrepancies: string[] = [];
    if (expectedNap.name !== actualNap.name) {
      discrepancies.push(`name: expected "${expectedNap.name}", listed "${actualNap.name}"`);
    }
    if (expectedNap.address !== actualNap.address) {
      discrepancies.push(`address: expected "${expectedNap.address}", listed "${actualNap.address}"`);
    }
    if (expectedNap.phone !== actualNap.phone) {
      discrepancies.push(`phone: expected "${expectedNap.phone}", listed "${actualNap.phone}"`);
    }

    return { isConsistent: discrepancies.length === 0, discrepancies };
  }
}
