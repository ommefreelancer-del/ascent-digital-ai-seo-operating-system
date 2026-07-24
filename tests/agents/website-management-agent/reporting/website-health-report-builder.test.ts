import { describe, expect, it } from "vitest";
import { WebsiteHealthReportBuilder } from "../../../../src/agents/website-management-agent/reporting/website-health-report-builder.js";
import type { WebsiteHealthSnapshot } from "../../../../src/agents/website-management-agent/types/website-management-provider.types.js";

function makeSnapshot(overrides: Partial<WebsiteHealthSnapshot> = {}): WebsiteHealthSnapshot {
  return {
    url: "https://oursite.com",
    uptime: { isUp: true, uptimePercentage: 99.98, lastCheckedAt: new Date().toISOString() },
    availableUpdates: [],
    backupStatus: null,
    securityScan: null,
    source: "test-provider",
    retrievedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("WebsiteHealthReportBuilder", () => {
  const builder = new WebsiteHealthReportBuilder();

  it("reports status unknown with null fields when no snapshot was supplied", () => {
    const report = builder.build(null);
    expect(report).toEqual({ status: "unknown", isUp: null, uptimePercentage: null, availableUpdateCount: 0, securityUpdateCount: 0 });
  });

  it("reports healthy when up, no updates pending, and no security threats", () => {
    const report = builder.build(makeSnapshot());
    expect(report.status).toBe("healthy");
  });

  it("reports needs-attention when updates are pending but nothing critical", () => {
    const report = builder.build(
      makeSnapshot({
        availableUpdates: [{ component: "Plugin: Yoast SEO", currentVersion: "1.0", availableVersion: "1.1", isSecurityUpdate: false }],
      }),
    );
    expect(report.status).toBe("needs-attention");
    expect(report.availableUpdateCount).toBe(1);
    expect(report.securityUpdateCount).toBe(0);
  });

  it("reports critical when the site is down, regardless of updates", () => {
    const report = builder.build(makeSnapshot({ uptime: { isUp: false, uptimePercentage: 95, lastCheckedAt: new Date().toISOString() } }));
    expect(report.status).toBe("critical");
    expect(report.isUp).toBe(false);
  });

  it("reports critical when real security threats are found, even if the site is up", () => {
    const report = builder.build(makeSnapshot({ securityScan: { threatsFound: 2, lastScannedAt: new Date().toISOString() } }));
    expect(report.status).toBe("critical");
  });

  it("counts security updates separately from the total available update count", () => {
    const report = builder.build(
      makeSnapshot({
        availableUpdates: [
          { component: "WordPress Core", currentVersion: "6.0", availableVersion: "6.1", isSecurityUpdate: true },
          { component: "Plugin: Contact Form", currentVersion: "2.0", availableVersion: "2.1", isSecurityUpdate: false },
        ],
      }),
    );
    expect(report.availableUpdateCount).toBe(2);
    expect(report.securityUpdateCount).toBe(1);
  });
});
