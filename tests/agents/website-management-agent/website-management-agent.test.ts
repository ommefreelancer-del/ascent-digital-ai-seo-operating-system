import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WebsiteManagementAgent } from "../../../src/agents/website-management-agent/website-management-agent.js";
import { WebsiteManagementRequestValidator } from "../../../src/agents/website-management-agent/validation/website-management-request-validator.js";
import { NullWebsiteManagementProvider } from "../../../src/agents/website-management-agent/providers/null-website-management-provider.js";
import { WebsiteHealthReportBuilder } from "../../../src/agents/website-management-agent/reporting/website-health-report-builder.js";
import { BackupReportBuilder } from "../../../src/agents/website-management-agent/reporting/backup-report-builder.js";
import { SecurityStatusReportBuilder } from "../../../src/agents/website-management-agent/reporting/security-status-report-builder.js";
import { MaintenanceRecommendationBuilder } from "../../../src/agents/website-management-agent/reporting/maintenance-recommendation-builder.js";
import { AuditLogger } from "../../../src/core/governance/audit-logger.js";
import type { ApprovalChannel } from "../../../src/core/governance/approval-channel.js";
import type { ApprovalDecision } from "../../../src/core/types/approval.types.js";
import type { WebsiteManagementRequest } from "../../../src/agents/website-management-agent/types/website-management-request.types.js";
import type {
  WebsiteHealthRequest,
  WebsiteHealthSnapshot,
  WebsiteManagementProvider,
} from "../../../src/agents/website-management-agent/types/website-management-provider.types.js";
import type { WebsiteAuditResult } from "../../../src/agents/website-audit-agent/types/website-audit-request.types.js";
import type { TechnicalSeoResult } from "../../../src/agents/technical-seo-agent/types/technical-seo-request.types.js";

function makeApprovalChannel(decision: ApprovalDecision): ApprovalChannel {
  return { requestDecision: async () => decision };
}

const REJECTING_DECISION: ApprovalDecision = {
  requestId: "unused",
  outcome: "rejected",
  notes: "should not be called",
  decidedAt: new Date().toISOString(),
};

class FixedWebsiteManagementProvider implements WebsiteManagementProvider {
  readonly name = "fixed-test-provider";
  constructor(private readonly snapshot: WebsiteHealthSnapshot | null) {}
  async fetchWebsiteHealth(_request: WebsiteHealthRequest): Promise<WebsiteHealthSnapshot | null> {
    return this.snapshot;
  }
}

function makeWebsiteAudit(): WebsiteAuditResult {
  return {
    requestId: "wa-1",
    url: "https://oursite.com",
    findings: [],
    summary: { criticalCount: 0, warningCount: 0, infoCount: 0 },
    limitations: ["Website audit limitation."],
    decidedAt: new Date().toISOString(),
  };
}

function makeTechnicalSeo(recommendations: TechnicalSeoResult["recommendations"] = []): TechnicalSeoResult {
  return {
    requestId: "ts-1",
    url: "https://oursite.com",
    recommendations,
    limitations: ["Technical SEO limitation."],
    decidedAt: new Date().toISOString(),
  };
}

function makeRequest(overrides: Partial<WebsiteManagementRequest> = {}): WebsiteManagementRequest {
  return {
    id: "req-1",
    url: "https://oursite.com",
    websiteAudit: makeWebsiteAudit(),
    technicalSeo: makeTechnicalSeo(),
    ...overrides,
  };
}

describe("WebsiteManagementAgent", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "website-management-agent-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  function buildAgent(provider: WebsiteManagementProvider, approvalDecision: ApprovalDecision = REJECTING_DECISION) {
    const auditLogPath = join(dir, "audit-log.jsonl");
    const agent = new WebsiteManagementAgent(
      new WebsiteManagementRequestValidator(),
      provider,
      new WebsiteHealthReportBuilder(),
      new BackupReportBuilder(),
      new SecurityStatusReportBuilder(),
      new MaintenanceRecommendationBuilder(),
      makeApprovalChannel(approvalDecision),
      new AuditLogger(auditLogPath),
    );
    return { agent, auditLogPath };
  }

  async function readEventTypes(auditLogPath: string): Promise<string[]> {
    const lines = (await readFile(auditLogPath, "utf8")).trim().split("\n");
    return lines.map((line) => JSON.parse(line).eventType);
  }

  it("reports data unavailable and status unknown with the default NullWebsiteManagementProvider", async () => {
    const { agent, auditLogPath } = buildAgent(new NullWebsiteManagementProvider());

    const result = await agent.manageWebsite(makeRequest());

    expect(result.dataAvailable).toBe(false);
    expect(result.healthReport.status).toBe("unknown");
    expect(result.backupReport.isCurrent).toBeNull();
    expect(result.securityStatusReport.status).toBe("no-data");
    expect(result.limitations.some((l) => l.includes('using "none-configured"'))).toBe(true);
    expect(await readEventTypes(auditLogPath)).toEqual(["website_management_requested", "website_management_completed"]);
  });

  it("carries forward every upstream limitation", async () => {
    const { agent } = buildAgent(new NullWebsiteManagementProvider());
    const result = await agent.manageWebsite(makeRequest());

    expect(result.limitations).toEqual(
      expect.arrayContaining(["Website audit limitation.", "Technical SEO limitation."]),
    );
  });

  it("produces real reports and recommendations when the provider supplies real data", async () => {
    const snapshot: WebsiteHealthSnapshot = {
      url: "https://oursite.com",
      uptime: { isUp: true, uptimePercentage: 99.9, lastCheckedAt: new Date().toISOString() },
      availableUpdates: [
        { component: "WordPress Core", currentVersion: "6.0", availableVersion: "6.1", isSecurityUpdate: true },
      ],
      backupStatus: { lastBackupAt: new Date().toISOString(), isRestorable: true },
      securityScan: { threatsFound: 0, lastScannedAt: new Date().toISOString() },
      source: "fixed-test-provider",
      retrievedAt: new Date().toISOString(),
    };
    const { agent, auditLogPath } = buildAgent(new FixedWebsiteManagementProvider(snapshot));

    const result = await agent.manageWebsite(makeRequest());

    expect(result.dataAvailable).toBe(true);
    expect(result.healthReport.status).toBe("needs-attention");
    expect(result.backupReport.isCurrent).toBe(true);
    expect(result.securityStatusReport.status).toBe("clean");
    expect(result.maintenanceRecommendations.some((r) => r.category === "update")).toBe(true);
    expect(await readEventTypes(auditLogPath)).toEqual(["website_management_requested", "website_management_completed"]);
  });

  it("throws and audit-logs validation failures without producing a result", async () => {
    const { agent, auditLogPath } = buildAgent(new NullWebsiteManagementProvider());

    await expect(agent.manageWebsite(makeRequest({ url: "   " }))).rejects.toThrow();

    expect(await readEventTypes(auditLogPath)).toEqual(["website_management_validation_failed"]);
  });

  it("escalates a destructive-action signal and proceeds when a human approves", async () => {
    const approvingDecision: ApprovalDecision = {
      requestId: "unused",
      outcome: "candidate_selected",
      selectedCandidateId: "proceed",
      notes: "Proceed anyway.",
      decidedAt: new Date().toISOString(),
    };
    const { agent, auditLogPath } = buildAgent(new NullWebsiteManagementProvider(), approvingDecision);

    const result = await agent.manageWebsite(makeRequest({ updateRequests: ["Restore last week's backup"] }));

    expect(result.maintenanceRecommendations.some((r) => r.recommendation.includes("Restore last week's backup"))).toBe(true);
    expect(await readEventTypes(auditLogPath)).toEqual([
      "website_management_requested",
      "website_management_escalated",
      "website_management_escalation_resolved",
      "website_management_completed",
    ]);
  });

  it("rejects when a human declines the destructive-action escalation", async () => {
    const { agent, auditLogPath } = buildAgent(new NullWebsiteManagementProvider(), REJECTING_DECISION);

    await expect(
      agent.manageWebsite(makeRequest({ updateRequests: ["Restore last week's backup"] })),
    ).rejects.toThrow(/destructive-action signals/);

    expect(await readEventTypes(auditLogPath)).toEqual([
      "website_management_requested",
      "website_management_escalated",
      "website_management_escalation_resolved",
      "website_management_rejected",
    ]);
  });

  it("does not escalate for a routine, non-destructive update request", async () => {
    const { agent, auditLogPath } = buildAgent(new NullWebsiteManagementProvider());

    const result = await agent.manageWebsite(makeRequest({ updateRequests: ["Update the homepage banner text"] }));

    expect(result.maintenanceRecommendations.some((r) => r.category === "content-update")).toBe(true);
    expect(await readEventTypes(auditLogPath)).toEqual(["website_management_requested", "website_management_completed"]);
  });
});
