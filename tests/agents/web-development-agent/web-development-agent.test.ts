import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WebDevelopmentAgent } from "../../../src/agents/web-development-agent/web-development-agent.js";
import {
  WebDevelopmentRequestValidator,
  WebDevelopmentValidationError,
} from "../../../src/agents/web-development-agent/validation/web-development-request-validator.js";
import { NullCodeGenerationProvider } from "../../../src/agents/web-development-agent/providers/null-code-generation-provider.js";
import { SeoImplementationTaskBuilder } from "../../../src/agents/web-development-agent/drafting/seo-implementation-task-builder.js";
import { BugFixTaskBuilder } from "../../../src/agents/web-development-agent/drafting/bug-fix-task-builder.js";
import { FeatureTaskBuilder } from "../../../src/agents/web-development-agent/drafting/feature-task-builder.js";
import { CodeSnippetDrafter } from "../../../src/agents/web-development-agent/drafting/code-snippet-drafter.js";
import { AuditLogger } from "../../../src/core/governance/audit-logger.js";
import type { ApprovalChannel } from "../../../src/core/governance/approval-channel.js";
import type { ApprovalDecision } from "../../../src/core/types/approval.types.js";
import type { WebDevelopmentRequest } from "../../../src/agents/web-development-agent/types/web-development-request.types.js";
import type {
  CodeGenerationProvider,
  CodeGenerationRequest,
  GeneratedCodeSnippet,
} from "../../../src/agents/web-development-agent/types/code-generation-provider.types.js";
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

class FixedCodeGenerationProvider implements CodeGenerationProvider {
  readonly name = "fixed-test-provider";
  async generateCodeSnippet(request: CodeGenerationRequest): Promise<GeneratedCodeSnippet | null> {
    return { code: `/* real code for ${request.taskTitle} */`, language: request.language };
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

function makeRequest(overrides: Partial<WebDevelopmentRequest> = {}): WebDevelopmentRequest {
  return {
    id: "req-1",
    websiteAudit: makeWebsiteAudit(),
    technicalSeo: makeTechnicalSeo(),
    ...overrides,
  };
}

describe("WebDevelopmentAgent", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "web-development-agent-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  function buildAgent(provider: CodeGenerationProvider, approvalDecision: ApprovalDecision = REJECTING_DECISION) {
    const auditLogPath = join(dir, "audit-log.jsonl");
    const agent = new WebDevelopmentAgent(
      new WebDevelopmentRequestValidator(),
      provider,
      new SeoImplementationTaskBuilder(),
      new BugFixTaskBuilder(),
      new FeatureTaskBuilder(),
      new CodeSnippetDrafter(),
      makeApprovalChannel(approvalDecision),
      new AuditLogger(auditLogPath),
    );
    return { agent, auditLogPath };
  }

  async function readEventTypes(auditLogPath: string): Promise<string[]> {
    const lines = (await readFile(auditLogPath, "utf8")).trim().split("\n");
    return lines.map((line) => JSON.parse(line).eventType);
  }

  it("produces placeholder-code tasks with the default NullCodeGenerationProvider", async () => {
    const technicalSeo = makeTechnicalSeo([
      { category: "https", priority: "high", recommendation: "Migrate to HTTPS.", rationale: "x", confirmedByCrossFunctionalNote: false },
    ]);
    const { agent, auditLogPath } = buildAgent(new NullCodeGenerationProvider());

    const result = await agent.developWebsite(makeRequest({ technicalSeo, bugReports: ["Broken link"], designAssets: ["New pricing page"] }));

    expect(result.dataAvailable).toBe(false);
    expect(result.developmentTasks).toHaveLength(3);
    expect(result.developmentTasks.every((t) => !t.isCodeGenerated)).toBe(true);
    expect(result.developmentTasks.every((t) => t.requiresApproval)).toBe(true);
    expect(result.limitations.some((l) => l.includes('using "none-configured"'))).toBe(true);
    expect(await readEventTypes(auditLogPath)).toEqual(["web_development_requested", "web_development_completed"]);
  });

  it("carries forward every upstream limitation and notes missing optional inputs", async () => {
    const { agent } = buildAgent(new NullCodeGenerationProvider());
    const result = await agent.developWebsite(makeRequest());

    expect(result.limitations).toEqual(
      expect.arrayContaining([
        "Website audit limitation.",
        "Technical SEO limitation.",
        "seoStrategy was not supplied; task prioritization does not reflect the overall roadmap.",
        "No business requirements were supplied; tasks reflect technical and caller-supplied signals only.",
      ]),
    );
  });

  it("marks dataAvailable true and uses real code when a real CodeGenerationProvider is configured", async () => {
    const { agent } = buildAgent(new FixedCodeGenerationProvider());

    const result = await agent.developWebsite(makeRequest({ bugReports: ["Broken link"] }));

    expect(result.dataAvailable).toBe(true);
    expect(result.developmentTasks[0]?.isCodeGenerated).toBe(true);
    expect(result.developmentTasks[0]?.codeSnippet).toContain("real code for");
  });

  it("throws and audit-logs validation failures without producing a result", async () => {
    const { agent, auditLogPath } = buildAgent(new NullCodeGenerationProvider());

    await expect(
      agent.developWebsite(
        makeRequest({
          websiteAudit: { ...makeWebsiteAudit(), url: "https://oursite.com/a" },
          technicalSeo: { ...makeTechnicalSeo(), url: "https://oursite.com/b" },
        }),
      ),
    ).rejects.toThrow(WebDevelopmentValidationError);

    expect(await readEventTypes(auditLogPath)).toEqual(["web_development_validation_failed"]);
  });

  it("escalates a destructive-action signal and proceeds when a human approves", async () => {
    const approvingDecision: ApprovalDecision = {
      requestId: "unused",
      outcome: "candidate_selected",
      selectedCandidateId: "proceed",
      notes: "Proceed anyway.",
      decidedAt: new Date().toISOString(),
    };
    const { agent, auditLogPath } = buildAgent(new NullCodeGenerationProvider(), approvingDecision);

    const result = await agent.developWebsite(makeRequest({ bugReports: ["Delete the old user table."] }));

    expect(result.developmentTasks.some((t) => t.description.includes("Delete the old user table."))).toBe(true);
    expect(await readEventTypes(auditLogPath)).toEqual([
      "web_development_requested",
      "web_development_escalated",
      "web_development_escalation_resolved",
      "web_development_completed",
    ]);
  });

  it("rejects when a human declines the destructive-action escalation", async () => {
    const { agent, auditLogPath } = buildAgent(new NullCodeGenerationProvider(), REJECTING_DECISION);

    await expect(
      agent.developWebsite(makeRequest({ bugReports: ["Delete the old user table."] })),
    ).rejects.toThrow(/destructive-action signals/);

    expect(await readEventTypes(auditLogPath)).toEqual([
      "web_development_requested",
      "web_development_escalated",
      "web_development_escalation_resolved",
      "web_development_rejected",
    ]);
  });

  it("does not escalate for a routine bug report or design asset", async () => {
    const { agent, auditLogPath } = buildAgent(new NullCodeGenerationProvider());

    const result = await agent.developWebsite(makeRequest({ bugReports: ["Broken contact link"] }));

    expect(result.developmentTasks.some((t) => t.category === "bug-fix")).toBe(true);
    expect(await readEventTypes(auditLogPath)).toEqual(["web_development_requested", "web_development_completed"]);
  });
});
