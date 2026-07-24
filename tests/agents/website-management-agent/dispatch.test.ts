import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  WEBSITE_MANAGEMENT_AGENT_ID,
  isWebsiteManagementAssignment,
} from "../../../src/agents/website-management-agent/dispatch.js";
import { WebsiteManagementAgent } from "../../../src/agents/website-management-agent/website-management-agent.js";
import { WebsiteManagementRequestValidator } from "../../../src/agents/website-management-agent/validation/website-management-request-validator.js";
import { NullWebsiteManagementProvider } from "../../../src/agents/website-management-agent/providers/null-website-management-provider.js";
import { WebsiteHealthReportBuilder } from "../../../src/agents/website-management-agent/reporting/website-health-report-builder.js";
import { BackupReportBuilder } from "../../../src/agents/website-management-agent/reporting/backup-report-builder.js";
import { SecurityStatusReportBuilder } from "../../../src/agents/website-management-agent/reporting/security-status-report-builder.js";
import { MaintenanceRecommendationBuilder } from "../../../src/agents/website-management-agent/reporting/maintenance-recommendation-builder.js";
import { AuditLogger } from "../../../src/core/governance/audit-logger.js";
import type { ApprovalChannel } from "../../../src/core/governance/approval-channel.js";
import type { RoutingDecision } from "../../../src/boss-agent/types/routing.types.js";
import type { WebsiteAuditResult } from "../../../src/agents/website-audit-agent/types/website-audit-request.types.js";
import type { TechnicalSeoResult } from "../../../src/agents/technical-seo-agent/types/technical-seo-request.types.js";

function makeDecision(overrides: Partial<RoutingDecision> = {}): RoutingDecision {
  return {
    taskId: "task-1",
    status: "assigned",
    assignedAgentId: WEBSITE_MANAGEMENT_AGENT_ID,
    candidates: [],
    rationale: "Matched.",
    decidedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("isWebsiteManagementAssignment", () => {
  it("is true when the decision is assigned to the website management agent", () => {
    expect(isWebsiteManagementAssignment(makeDecision())).toBe(true);
  });

  it("is false when assigned to a different agent", () => {
    expect(isWebsiteManagementAssignment(makeDecision({ assignedAgentId: "seo-content-agent" }))).toBe(false);
  });

  it("is false when the decision was rejected", () => {
    expect(
      isWebsiteManagementAssignment({
        taskId: "task-1",
        status: "rejected",
        candidates: [],
        rationale: "Declined.",
        decidedAt: new Date().toISOString(),
      }),
    ).toBe(false);
  });
});

describe("integration: a Boss Agent routing decision can be traced through to a real result", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "website-management-dispatch-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("carries the same id from RoutingDecision.taskId through to WebsiteManagementResult.requestId", async () => {
    const decision = makeDecision({ taskId: "boss-agent-task-15" });
    expect(isWebsiteManagementAssignment(decision)).toBe(true);

    const approvalChannel: ApprovalChannel = {
      requestDecision: async () => {
        throw new Error("should not be called for a clean request with no destructive-action signals");
      },
    };
    const agent = new WebsiteManagementAgent(
      new WebsiteManagementRequestValidator(),
      new NullWebsiteManagementProvider(),
      new WebsiteHealthReportBuilder(),
      new BackupReportBuilder(),
      new SecurityStatusReportBuilder(),
      new MaintenanceRecommendationBuilder(),
      approvalChannel,
      new AuditLogger(join(dir, "audit-log.jsonl")),
    );

    const websiteAudit: WebsiteAuditResult = {
      requestId: "wa-1",
      url: "https://oursite.com",
      findings: [],
      summary: { criticalCount: 0, warningCount: 0, infoCount: 0 },
      limitations: [],
      decidedAt: new Date().toISOString(),
    };
    const technicalSeo: TechnicalSeoResult = {
      requestId: "ts-1",
      url: "https://oursite.com",
      recommendations: [],
      limitations: [],
      decidedAt: new Date().toISOString(),
    };

    const result = await agent.manageWebsite({
      id: decision.taskId,
      url: "https://oursite.com",
      websiteAudit,
      technicalSeo,
    });

    expect(result.requestId).toBe("boss-agent-task-15");
  });
});
