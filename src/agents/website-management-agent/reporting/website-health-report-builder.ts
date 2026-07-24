// Builds a WebsiteHealthReport from a real WebsiteHealthSnapshot. Status is
// "unknown" when no snapshot was supplied -- never guessed. Otherwise
// status is a deterministic rollup: any real security threats or downtime
// is "critical"; any real pending update is "needs-attention"; otherwise
// "healthy".

import type { WebsiteHealthSnapshot } from "../types/website-management-provider.types.js";
import type { WebsiteHealthReport, WebsiteHealthStatus } from "../types/website-management-request.types.js";

function statusFor(snapshot: WebsiteHealthSnapshot): WebsiteHealthStatus {
  if (snapshot.securityScan && snapshot.securityScan.threatsFound > 0) {
    return "critical";
  }
  if (snapshot.uptime && !snapshot.uptime.isUp) {
    return "critical";
  }
  if (snapshot.availableUpdates.length > 0) {
    return "needs-attention";
  }
  return "healthy";
}

export class WebsiteHealthReportBuilder {
  build(snapshot: WebsiteHealthSnapshot | null): WebsiteHealthReport {
    if (!snapshot) {
      return { status: "unknown", isUp: null, uptimePercentage: null, availableUpdateCount: 0, securityUpdateCount: 0 };
    }
    return {
      status: statusFor(snapshot),
      isUp: snapshot.uptime?.isUp ?? null,
      uptimePercentage: snapshot.uptime?.uptimePercentage ?? null,
      availableUpdateCount: snapshot.availableUpdates.length,
      securityUpdateCount: snapshot.availableUpdates.filter((update) => update.isSecurityUpdate).length,
    };
  }
}
