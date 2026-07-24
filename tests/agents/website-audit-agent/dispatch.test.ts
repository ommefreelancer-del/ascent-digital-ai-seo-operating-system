import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  WEBSITE_AUDIT_AGENT_ID,
  isWebsiteAuditAssignment,
} from "../../../src/agents/website-audit-agent/dispatch.js";
import { WebsiteAuditAgent } from "../../../src/agents/website-audit-agent/website-audit-agent.js";
import { WebsiteAuditRequestValidator } from "../../../src/agents/website-audit-agent/validation/website-audit-request-validator.js";
import { CrawlabilityChecker } from "../../../src/agents/website-audit-agent/checks/crawlability-checker.js";
import { MetadataChecker } from "../../../src/agents/website-audit-agent/checks/metadata-checker.js";
import { HeadingStructureChecker } from "../../../src/agents/website-audit-agent/checks/heading-structure-checker.js";
import { AuditLogger } from "../../../src/core/governance/audit-logger.js";
import type { ApprovalChannel } from "../../../src/core/governance/approval-channel.js";
import type { RoutingDecision } from "../../../src/boss-agent/types/routing.types.js";

function makeDecision(overrides: Partial<RoutingDecision> = {}): RoutingDecision {
  return {
    taskId: "task-1",
    status: "assigned",
    assignedAgentId: WEBSITE_AUDIT_AGENT_ID,
    candidates: [],
    rationale: "Matched.",
    decidedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("isWebsiteAuditAssignment", () => {
  it("is true when the decision is assigned to the website audit agent", () => {
    expect(isWebsiteAuditAssignment(makeDecision())).toBe(true);
  });

  it("is false when assigned to a different agent", () => {
    expect(isWebsiteAuditAssignment(makeDecision({ assignedAgentId: "keyword-research-agent" }))).toBe(false);
  });

  it("is false when the decision was rejected", () => {
    expect(
      isWebsiteAuditAssignment({
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
    dir = await mkdtemp(join(tmpdir(), "website-audit-dispatch-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("carries the same id from RoutingDecision.taskId through to WebsiteAuditResult.requestId", async () => {
    const decision = makeDecision({ taskId: "boss-agent-task-7" });
    expect(isWebsiteAuditAssignment(decision)).toBe(true);

    const approvalChannel: ApprovalChannel = {
      requestDecision: async () => {
        throw new Error("should not be called for a clean request");
      },
    };
    const agent = new WebsiteAuditAgent(
      new WebsiteAuditRequestValidator(),
      [new CrawlabilityChecker(), new MetadataChecker(), new HeadingStructureChecker()],
      approvalChannel,
      new AuditLogger(join(dir, "audit-log.jsonl")),
    );

    const result = await agent.auditWebsite({
      id: decision.taskId,
      html: "<html><head><title>A Complete Guide to Local Plumbing Services</title></head><body><h1>Hi</h1></body></html>",
    });

    expect(result.requestId).toBe("boss-agent-task-7");
  });
});
