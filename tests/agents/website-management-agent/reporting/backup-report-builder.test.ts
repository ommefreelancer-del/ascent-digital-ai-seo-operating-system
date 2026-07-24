import { describe, expect, it } from "vitest";
import { BackupReportBuilder } from "../../../../src/agents/website-management-agent/reporting/backup-report-builder.js";

describe("BackupReportBuilder", () => {
  const builder = new BackupReportBuilder();
  const now = new Date("2026-07-22T00:00:00.000Z");

  it("reports null fields when no backup status was supplied", () => {
    const report = builder.build(null, now);
    expect(report.lastBackupAt).toBeNull();
    expect(report.isCurrent).toBeNull();
  });

  it("reports null fields when the backup status has no real lastBackupAt", () => {
    const report = builder.build({ lastBackupAt: null, isRestorable: null }, now);
    expect(report.lastBackupAt).toBeNull();
    expect(report.isCurrent).toBeNull();
  });

  it("reports current when the backup is within the 7-day freshness window and restorable", () => {
    const report = builder.build({ lastBackupAt: "2026-07-18T00:00:00.000Z", isRestorable: true }, now);
    expect(report.isCurrent).toBe(true);
  });

  it("reports not current when the backup is older than the 7-day freshness window", () => {
    const report = builder.build({ lastBackupAt: "2026-07-01T00:00:00.000Z", isRestorable: true }, now);
    expect(report.isCurrent).toBe(false);
  });

  it("reports not current when the backup is fresh but explicitly not restorable", () => {
    const report = builder.build({ lastBackupAt: "2026-07-21T00:00:00.000Z", isRestorable: false }, now);
    expect(report.isCurrent).toBe(false);
  });

  it("treats an unknown restorable flag as acceptable when the backup is fresh", () => {
    const report = builder.build({ lastBackupAt: "2026-07-21T00:00:00.000Z", isRestorable: null }, now);
    expect(report.isCurrent).toBe(true);
  });
});
