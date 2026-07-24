import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WEB_DEVELOPMENT_AGENT_ID, isWebDevelopmentAssignment } from "../../../src/agents/web-development-agent/dispatch.js";
import { WebDevelopmentAgent } from "../../../src/agents/web-development-agent/web-development-agent.js";
import { WebDevelopmentRequestValidator } from "../../../src/agents/web-development-agent/validation/web-development-request-validator.js";
import { NullCodeGenerationProvider } from "../../../src/agents/web-development-agent/providers/null-code-generation-provider.js";
import { SeoImplementationTaskBuilder } from "../../../src/agents/web-development-agent/drafting/seo-implementation-task-builder.js";
import { BugFixTaskBuilder } from "../../../src/agents/web-development-agent/drafting/bug-fix-task-builder.js";
import { FeatureTaskBuilder } from "../../../src/agents/web-development-agent/drafting/feature-task-builder.js";
import { CodeSnippetDrafter } from "../../../src/agents/web-development-agent/drafting/code-snippet-drafter.js";
import { AuditLogger } from "../../../src/core/governance/audit-logger.js";
import type { ApprovalChannel } from "../../../src/core/governance/approval-channel.js";
import type { RoutingDecision } from "../../../src/boss-agent/types/routing.types.js";
import type { WebsiteAuditResult } from "../../../src/agents/website-audit-agent/types/website-audit-request.types.js";
import type { TechnicalSeoResult } from "../../../src/agents/technical-seo-agent/types/technical-seo-request.types.js";

function makeDecision(overrides: Partial<RoutingDecision> = {}): RoutingDecision {
  return {
    taskId: "task-1",
    status: "assigned",
    assignedAgentId: WEB_DEVELOPMENT_AGENT_ID,
    candidates: [],
    rationale: "Matched.",
    decidedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("isWebDevelopmentAssignment", () => {
  it("is true when the decision is assigned to the web development agent", () => {
    expect(isWebDevelopmentAssignment(makeDecision())).toBe(true);
  });

  it("is false when assigned to a different agent", () => {
    expect(isWebDevelopmentAssignment(makeDecision({ assignedAgentId: "website-management-agent" }))).toBe(false);
  });

  it("is false when the decision was rejected", () => {
    expect(
      isWebDevelopmentAssignment({
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
    dir = await mkdtemp(join(tmpdir(), "web-development-dispatch-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("carries the same id from RoutingDecision.taskId through to WebDevelopmentResult.requestId", async () => {
    const decision = makeDecision({ taskId: "boss-agent-task-17" });
    expect(isWebDevelopmentAssignment(decision)).toBe(true);

    const approvalChannel: ApprovalChannel = {
      requestDecision: async () => {
        throw new Error("should not be called for a clean request with no destructive-action signals");
      },
    };
    const agent = new WebDevelopmentAgent(
      new WebDevelopmentRequestValidator(),
      new NullCodeGenerationProvider(),
      new SeoImplementationTaskBuilder(),
      new BugFixTaskBuilder(),
      new FeatureTaskBuilder(),
      new CodeSnippetDrafter(),
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

    const result = await agent.developWebsite({
      id: decision.taskId,
      websiteAudit,
      technicalSeo,
    });

    expect(result.requestId).toBe("boss-agent-task-17");
  });
});
