// Web Development Agent, per Agents/web-development-agent.md.
//
// Workflow:
//   1. Validate the request: websiteAudit and technicalSeo (when known)
//      must agree on which page they describe -- a genuine mismatch throws
//      rather than being silently reconciled.
//   2. Log "web_development_requested".
//   3. If any caller-supplied bug report, business requirement, or design
//      asset contains a destructive-action signal (deletion, disabling a
//      security control, hardcoded credentials, etc), escalate to a human
//      before turning it into a development task -- per this agent's own
//      rule, "write secure and maintainable code."
//   4. Build draft tasks from three real sources only: the Technical SEO
//      Agent's own already-computed recommendations (translated into
//      implementation-ready tickets), the caller's real bug reports, and
//      the caller's real design asset descriptions. Nothing is derived
//      independently from raw Website Audit findings, since those are
//      already owned by the On-Page SEO and Technical SEO Agents.
//   5. Draft each task's code through the injected CodeGenerationProvider
//      (a bracketed placeholder instruction when no provider is configured
//      or generation is unavailable). Every task is marked
//      `requiresApproval: true` -- this agent never deploys anything
//      itself, in this build or any future one.
//   6. Compile the result with an explicit `dataAvailable` flag and
//      limitations carried forward from every upstream result plus this
//      agent's own scope disclaimers.
//   7. Log "web_development_completed" and return.
//
// GLOBAL_RULES.md SS2 (Anti-Hallucination): this agent never invents a bug
// root cause, a design's real content, or working code. No external service
// (GitHub, WordPress, an LLM codegen provider) is called anywhere in this
// module -- see providers/null-code-generation-provider.ts. GLOBAL_RULES.md
// SS9: this agent never deploys, commits, or pushes code -- it only
// prepares tasks for a human to authorize and (once a real provider is
// approved and wired in) implement elsewhere.

import { randomUUID } from "node:crypto";
import type { ApprovalChannel } from "../../core/governance/approval-channel.js";
import { CliApprovalChannel } from "../../core/governance/cli-approval-channel.js";
import { AuditLogger } from "../../core/governance/audit-logger.js";
import type { ApprovalRequest } from "../../core/types/approval.types.js";
import type { WebDevelopmentAgentConfig } from "./config/web-development-agent.config.js";
import { WebDevelopmentRequestValidator } from "./validation/web-development-request-validator.js";
import type { CodeGenerationProvider } from "./types/code-generation-provider.types.js";
import { NullCodeGenerationProvider } from "./providers/null-code-generation-provider.js";
import { SeoImplementationTaskBuilder } from "./drafting/seo-implementation-task-builder.js";
import { BugFixTaskBuilder } from "./drafting/bug-fix-task-builder.js";
import { FeatureTaskBuilder } from "./drafting/feature-task-builder.js";
import { CodeSnippetDrafter } from "./drafting/code-snippet-drafter.js";
import type { WebDevelopmentRequest, WebDevelopmentResult } from "./types/web-development-request.types.js";

const PROCEED_CANDIDATE_ID = "proceed";

const OUT_OF_SCOPE_LIMITATION =
  "This agent never calls GitHub, WordPress, or any other external development or codegen service -- code, " +
  "if any, comes only from the injected CodeGenerationProvider, supplied by the caller. This agent never " +
  "deploys, commits, or pushes code itself; every task requires human authorization before implementation.";

export class WebDevelopmentAgent {
  constructor(
    private readonly validator: WebDevelopmentRequestValidator,
    private readonly codeGenerationProvider: CodeGenerationProvider,
    private readonly seoImplementationTaskBuilder: SeoImplementationTaskBuilder,
    private readonly bugFixTaskBuilder: BugFixTaskBuilder,
    private readonly featureTaskBuilder: FeatureTaskBuilder,
    private readonly codeSnippetDrafter: CodeSnippetDrafter,
    private readonly approvalChannel: ApprovalChannel,
    private readonly auditLogger: AuditLogger,
  ) {}

  /**
   * Wires the production implementation. Defaults to NullCodeGenerationProvider
   * (no real generation source configured) and the interactive CLI approval
   * channel, matching how the other specialist agents are wired.
   */
  static async create(
    config: WebDevelopmentAgentConfig,
    codeGenerationProvider: CodeGenerationProvider = new NullCodeGenerationProvider(),
    approvalChannel: ApprovalChannel = new CliApprovalChannel(),
  ): Promise<WebDevelopmentAgent> {
    return new WebDevelopmentAgent(
      new WebDevelopmentRequestValidator(),
      codeGenerationProvider,
      new SeoImplementationTaskBuilder(),
      new BugFixTaskBuilder(),
      new FeatureTaskBuilder(),
      new CodeSnippetDrafter(),
      approvalChannel,
      new AuditLogger(config.auditLogPath),
    );
  }

  async developWebsite(request: WebDevelopmentRequest): Promise<WebDevelopmentResult> {
    try {
      this.validator.validate(request);
    } catch (error) {
      await this.auditLogger.logEvent({
        actor: "web-development-agent",
        eventType: "web_development_validation_failed",
        details: { requestId: request.id, reason: error instanceof Error ? error.message : String(error) },
      });
      throw error;
    }

    await this.auditLogger.logEvent({
      actor: "web-development-agent",
      eventType: "web_development_requested",
      details: {
        requestId: request.id,
        bugReportCount: request.bugReports?.length ?? 0,
        designAssetCount: request.designAssets?.length ?? 0,
      },
    });

    const destructiveActionSignals = this.validator.findDestructiveActionSignals(request);
    if (destructiveActionSignals.length > 0) {
      const approved = await this.escalateDestructiveAction(request, destructiveActionSignals);
      if (!approved) {
        await this.auditLogger.logEvent({
          actor: "web-development-agent",
          eventType: "web_development_rejected",
          details: {
            requestId: request.id,
            reason: "Human reviewer declined to proceed with a request containing destructive-action signals.",
            signals: destructiveActionSignals,
          },
        });
        throw new Error("Web development request was rejected by human review due to destructive-action signals.");
      }
    }

    const drafts = [
      ...this.seoImplementationTaskBuilder.build(request.technicalSeo),
      ...this.bugFixTaskBuilder.build(request.bugReports ?? []),
      ...this.featureTaskBuilder.build(request.designAssets ?? []),
    ];
    const developmentTasks = await Promise.all(
      drafts.map((draft) => this.codeSnippetDrafter.draftTask(this.codeGenerationProvider, draft)),
    );

    const dataAvailable = developmentTasks.some((task) => task.isCodeGenerated);
    const limitations = this.buildLimitations(request, dataAvailable);

    const result: WebDevelopmentResult = {
      requestId: request.id,
      dataAvailable,
      developmentTasks,
      limitations,
      decidedAt: new Date().toISOString(),
    };

    await this.auditLogger.logEvent({
      actor: "web-development-agent",
      eventType: "web_development_completed",
      details: { requestId: request.id, dataAvailable, developmentTaskCount: developmentTasks.length },
    });

    return result;
  }

  private buildLimitations(request: WebDevelopmentRequest, dataAvailable: boolean): string[] {
    const limitations: string[] = [
      ...request.websiteAudit.limitations,
      ...request.technicalSeo.limitations,
      ...(request.seoStrategy?.limitations ?? []),
      OUT_OF_SCOPE_LIMITATION,
    ];

    if (!request.seoStrategy) {
      limitations.push("seoStrategy was not supplied; task prioritization does not reflect the overall roadmap.");
    }
    if (!request.businessRequirements) {
      limitations.push("No business requirements were supplied; tasks reflect technical and caller-supplied signals only.");
    }
    if (!dataAvailable) {
      limitations.push(
        `No code generation provider is configured (using "${this.codeGenerationProvider.name}"); every ` +
          "task's code is a bracketed placeholder instruction, not real, deployable code.",
      );
    }

    return limitations;
  }

  private async escalateDestructiveAction(
    request: WebDevelopmentRequest,
    signals: readonly string[],
  ): Promise<boolean> {
    const approvalRequest: ApprovalRequest = {
      id: randomUUID(),
      reason: "destructive_action",
      summary:
        `Web development request "${request.id}" has real bug report(s), requirement(s), or design asset(s) ` +
        `containing destructive/unsafe signal(s): ${signals.join(", ")}. GLOBAL_RULES.md requires human ` +
        "approval before turning these into development tasks.",
      candidates: [
        {
          id: PROCEED_CANDIDATE_ID,
          label: "Proceed and surface these as development tasks pending implementation",
          score: 0,
          rationale:
            "Approving continues web development analysis and includes these items in the task list; this " +
            "agent still never implements or deploys them.",
        },
      ],
      createdAt: new Date().toISOString(),
    };

    await this.auditLogger.logEvent({
      actor: "web-development-agent",
      eventType: "web_development_escalated",
      details: { requestId: request.id, approvalRequestId: approvalRequest.id, signals },
    });

    const decision = await this.approvalChannel.requestDecision(approvalRequest);

    await this.auditLogger.logEvent({
      actor: "web-development-agent",
      eventType: "web_development_escalation_resolved",
      details: {
        requestId: request.id,
        approvalRequestId: approvalRequest.id,
        outcome: decision.outcome,
        notes: decision.notes,
      },
    });

    return decision.outcome === "candidate_selected" && decision.selectedCandidateId === PROCEED_CANDIDATE_ID;
  }
}
