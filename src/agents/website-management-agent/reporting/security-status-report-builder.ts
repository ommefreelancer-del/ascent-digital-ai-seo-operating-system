// Builds a SecurityStatusReport from a real SecurityScanResult. "no-data"
// when no scan was supplied -- never presented as "clean" without a real
// scan behind it.

import type { SecurityScanResult } from "../types/website-management-provider.types.js";
import type { SecurityStatusReport } from "../types/website-management-request.types.js";

export class SecurityStatusReportBuilder {
  build(securityScan: SecurityScanResult | null): SecurityStatusReport {
    if (!securityScan) {
      return { status: "no-data", threatsFound: null, lastScannedAt: null };
    }
    return {
      status: securityScan.threatsFound > 0 ? "threats-detected" : "clean",
      threatsFound: securityScan.threatsFound,
      lastScannedAt: securityScan.lastScannedAt,
    };
  }
}
