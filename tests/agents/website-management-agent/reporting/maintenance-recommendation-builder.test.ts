import { describe, expect, it } from "vitest";
import { MaintenanceRecommendationBuilder } from "../../../../src/agents/website-management-agent/reporting/maintenance-recommendation-builder.js";
import type { WebsiteHealthSnapshot } from "../../../../src/agents/website-management-agent/types/website-management-provider.types.js";
import type { BackupReport, SecurityStatusReport } from "../../../../src/agents/website-management-agent/types/website-management-request.types.js";
import type { TechnicalSeoResult } from "../../../../src/agents/technical-seo-agent/types/technical-seo-request.types.js";

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

const CURRENT_BACKUP: BackupReport = { lastBackupAt: new Date().toISOString(), isCurrent: true, recommendation: "Fine." };
const STALE_BACKUP: BackupReport = { lastBackupAt: null, isCurrent: null, recommendation: "Create a fresh backup." };
const CLEAN_SECURITY: SecurityStatusReport = { status: "clean", threatsFound: 0, lastScannedAt: new Date().toISOString() };
const THREAT_SECURITY: SecurityStatusReport = { status: "threats-detected", threatsFound: 2, lastScannedAt: new Date().toISOString() };

function makeTechnicalSeo(recommendations: TechnicalSeoResult["recommendations"] = []): TechnicalSeoResult {
  return { requestId: "ts-1", url: "https://oursite.com", recommendations, limitations: [], decidedAt: new Date().toISOString() };
}

describe("MaintenanceRecommendationBuilder", () => {
  const builder = new MaintenanceRecommendationBuilder();

  it("returns no recommendations when everything is healthy, current, and clean", () => {
    const recommendations = builder.build(makeSnapshot(), CURRENT_BACKUP, CLEAN_SECURITY, makeTechnicalSeo(), [], []);
    expect(recommendations).toHaveLength(0);
  });

  it("recommends applying a real pending update, high priority for security updates", () => {
    const snapshot = makeSnapshot({
      availableUpdates: [{ component: "WordPress Core", currentVersion: "6.0", availableVersion: "6.1", isSecurityUpdate: true }],
    });
    const [recommendation] = builder.build(snapshot, CURRENT_BACKUP, CLEAN_SECURITY, makeTechnicalSeo(), [], []);
    expect(recommendation).toMatchObject({ category: "update", priority: "high", requiresApproval: true });
  });

  it("recommends applying a real pending non-security update at medium priority", () => {
    const snapshot = makeSnapshot({
      availableUpdates: [{ component: "Plugin: Contact Form", currentVersion: "2.0", availableVersion: "2.1", isSecurityUpdate: false }],
    });
    const [recommendation] = builder.build(snapshot, CURRENT_BACKUP, CLEAN_SECURITY, makeTechnicalSeo(), [], []);
    expect(recommendation).toMatchObject({ category: "update", priority: "medium" });
  });

  it("recommends investigating downtime without requiring approval", () => {
    const snapshot = makeSnapshot({ uptime: { isUp: false, uptimePercentage: 90, lastCheckedAt: new Date().toISOString() } });
    const recommendations = builder.build(snapshot, CURRENT_BACKUP, CLEAN_SECURITY, makeTechnicalSeo(), [], []);
    const uptimeRecommendation = recommendations.find((r) => r.category === "uptime");
    expect(uptimeRecommendation).toMatchObject({ priority: "high", requiresApproval: false });
  });

  it("recommends a fresh backup when the backup is not current", () => {
    const recommendations = builder.build(makeSnapshot(), STALE_BACKUP, CLEAN_SECURITY, makeTechnicalSeo(), [], []);
    const backupRecommendation = recommendations.find((r) => r.category === "backup");
    expect(backupRecommendation).toMatchObject({ priority: "high", requiresApproval: true });
  });

  it("recommends remediation when real security threats are detected", () => {
    const recommendations = builder.build(makeSnapshot(), CURRENT_BACKUP, THREAT_SECURITY, makeTechnicalSeo(), [], []);
    const securityRecommendation = recommendations.find((r) => r.category === "security" && r.recommendation.includes("2 real threat"));
    expect(securityRecommendation).toMatchObject({ priority: "high", requiresApproval: true });
  });

  it("relays a real https recommendation from the Technical SEO Agent", () => {
    const technicalSeo = makeTechnicalSeo([
      { category: "https", priority: "high", recommendation: "Migrate to HTTPS.", rationale: "x", confirmedByCrossFunctionalNote: false },
    ]);
    const recommendations = builder.build(makeSnapshot(), CURRENT_BACKUP, CLEAN_SECURITY, technicalSeo, [], []);
    const relayed = recommendations.find((r) => r.recommendation.includes("Migrate to HTTPS."));
    expect(relayed).toMatchObject({ category: "security", priority: "high", requiresApproval: true });
  });

  it("does not relay non-https Technical SEO recommendations", () => {
    const technicalSeo = makeTechnicalSeo([
      { category: "crawlability", priority: "high", recommendation: "Remove noindex.", rationale: "x", confirmedByCrossFunctionalNote: false },
    ]);
    const recommendations = builder.build(makeSnapshot(), CURRENT_BACKUP, CLEAN_SECURITY, technicalSeo, [], []);
    expect(recommendations.some((r) => r.recommendation.includes("Remove noindex."))).toBe(false);
  });

  it("passes through a caller-supplied update request verbatim", () => {
    const recommendations = builder.build(makeSnapshot(), CURRENT_BACKUP, CLEAN_SECURITY, makeTechnicalSeo(), ["Update the homepage banner text"], []);
    const contentUpdate = recommendations.find((r) => r.category === "content-update");
    expect(contentUpdate?.recommendation).toContain("Update the homepage banner text");
    expect(contentUpdate?.requiresApproval).toBe(true);
  });

  it("passes through a caller-supplied security alert verbatim", () => {
    const recommendations = builder.build(makeSnapshot(), CURRENT_BACKUP, CLEAN_SECURITY, makeTechnicalSeo(), [], ["Suspicious login attempts detected"]);
    const alertRecommendation = recommendations.find((r) => r.recommendation.includes("Suspicious login attempts detected"));
    expect(alertRecommendation).toMatchObject({ category: "security", priority: "high", requiresApproval: true });
  });
});
