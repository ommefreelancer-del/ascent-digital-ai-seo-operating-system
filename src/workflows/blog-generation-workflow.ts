// The blog-generation workflow requested for Phase 4: Research -> Outline ->
// Article -> SEO Optimization -> Schema generation -> Metadata generation ->
// Internal link generation -> Publishing checklist -> ask for approval
// before publishing. Built on the same WorkflowEngine as
// seo-audit-workflow.ts, reusing the same real agents (KeywordResearchAgent,
// ContentStrategyAgent, SeoContentAgent) -- no new content-generation logic
// is duplicated here.
//
// GLOBAL_RULES.md SS9 explicitly requires human approval before "Publishing
// website content." This workflow NEVER writes to a live site itself -- it
// has no publish action at all, only a final step that calls the real
// ApprovalChannel (the same interface every other agent's escalation uses)
// and reports `publishable: true` in its output only if a human approved.
// A declined or pending approval halts the run with `publishable: false`;
// no draft this workflow produces is ever treated as ready without that
// explicit signal.

import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type { ApprovalChannel } from "../core/governance/approval-channel.js";
import { CliApprovalChannel } from "../core/governance/cli-approval-channel.js";
import { AuditLogger } from "../core/governance/audit-logger.js";
import { WorkflowEngine } from "../core/workflow/workflow-engine.js";
import type { WorkflowContext, WorkflowRunResult, WorkflowStep } from "../core/workflow/workflow-step.types.js";
import type { ApprovalRequest } from "../core/types/approval.types.js";
import { generateArticleSchema } from "./schema-generation.js";

import { KeywordResearchAgent } from "../agents/keyword-research-agent/keyword-research-agent.js";
import { loadKeywordResearchAgentConfig } from "../agents/keyword-research-agent/config/keyword-research-agent.config.js";
import type { KeywordDataProvider } from "../agents/keyword-research-agent/types/keyword-data-provider.types.js";
import { NullKeywordDataProvider } from "../agents/keyword-research-agent/providers/null-keyword-data-provider.js";
import type { KeywordResearchResult } from "../agents/keyword-research-agent/types/keyword-request.types.js";

import { ContentStrategyAgent } from "../agents/content-strategy-agent/content-strategy-agent.js";
import { loadContentStrategyAgentConfig } from "../agents/content-strategy-agent/config/content-strategy-agent.config.js";
import type { ContentStrategyResult } from "../agents/content-strategy-agent/types/content-strategy-request.types.js";

import { SeoContentAgent } from "../agents/seo-content-agent/seo-content-agent.js";
import { loadSeoContentAgentConfig } from "../agents/seo-content-agent/config/seo-content-agent.config.js";
import type { ContentGenerationProvider } from "../agents/seo-content-agent/types/content-generation-provider.types.js";
import { NullContentGenerationProvider } from "../agents/seo-content-agent/providers/null-content-generation-provider.js";
import type { ContentPieceDraft, SeoContentResult } from "../agents/seo-content-agent/types/seo-content-request.types.js";

const PROCEED_CANDIDATE_ID = "publish";
const TITLE_MIN = 10;
const TITLE_MAX = 60;
const DESCRIPTION_MIN = 50;
const DESCRIPTION_MAX = 160;

export interface BlogGenerationWorkflowInput {
  readonly businessObjective: string;
  readonly seedKeywords: readonly string[];
  readonly targetAudience?: string;
  readonly brandGuidelines?: string;
}

export interface BlogGenerationWorkflowProviders {
  readonly keywordDataProvider?: KeywordDataProvider;
  readonly contentGenerationProvider?: ContentGenerationProvider;
}

/** Deterministic, non-fabricated on-draft SEO checks -- there is no live page to audit for an unpublished draft. */
function checkDraftSeo(draft: ContentPieceDraft): string[] {
  const findings: string[] = [];
  if (draft.metaTitle.length < TITLE_MIN || draft.metaTitle.length > TITLE_MAX) {
    findings.push(`Meta title is ${draft.metaTitle.length} characters (recommended ${TITLE_MIN}-${TITLE_MAX}).`);
  }
  if (draft.metaDescription.length < DESCRIPTION_MIN || draft.metaDescription.length > DESCRIPTION_MAX) {
    findings.push(`Meta description is ${draft.metaDescription.length} characters (recommended ${DESCRIPTION_MIN}-${DESCRIPTION_MAX}).`);
  }
  if (!draft.metaTitle.toLowerCase().includes(draft.targetKeyword.toLowerCase())) {
    findings.push(`Meta title does not include the target keyword "${draft.targetKeyword}".`);
  }
  return findings;
}

export function buildBlogGenerationWorkflowSteps(
  input: BlogGenerationWorkflowInput,
  agents: {
    readonly keywordResearchAgent: KeywordResearchAgent;
    readonly contentStrategyAgent: ContentStrategyAgent;
    readonly seoContentAgent: SeoContentAgent;
  },
  approvalChannel: ApprovalChannel,
  auditLogger: AuditLogger,
): WorkflowStep[] {
  const runId = randomUUID();

  return [
    {
      id: "research",
      name: "Research",
      async run(ctx: WorkflowContext) {
        if (input.seedKeywords.length === 0) {
          return { outcome: "halt", reason: "No seedKeywords were supplied; a blog post cannot be researched from nothing." };
        }
        const keywordResearch = await agents.keywordResearchAgent.researchKeywords({
          id: `${runId}:research`,
          businessObjective: input.businessObjective,
          seedKeywords: input.seedKeywords,
          ...(input.targetAudience !== undefined && { targetAudience: input.targetAudience }),
        });
        ctx.set("keywordResearch", keywordResearch);
        return { outcome: "completed" };
      },
    },
    {
      id: "outline",
      name: "Generate outline",
      async run(ctx: WorkflowContext) {
        const keywordResearch = ctx.get("keywordResearch") as KeywordResearchResult;
        const contentStrategy = await agents.contentStrategyAgent.developStrategy({
          id: `${runId}:outline`,
          businessObjective: input.businessObjective,
          keywordResearch,
          ...(input.targetAudience !== undefined && { targetAudience: input.targetAudience }),
          articlesPerWeek: 1,
        });
        if (contentStrategy.contentBriefs.length === 0) {
          return { outcome: "halt", reason: "No content brief (outline) could be produced from the researched keywords." };
        }
        ctx.set("contentStrategy", contentStrategy);
        return { outcome: "completed" };
      },
    },
    {
      id: "article",
      name: "Generate article",
      async run(ctx: WorkflowContext) {
        const contentStrategy = ctx.get("contentStrategy") as ContentStrategyResult;
        const keywordResearch = ctx.get("keywordResearch") as KeywordResearchResult;
        const seoContent = await agents.seoContentAgent.developContent({
          id: `${runId}:article`,
          businessObjective: input.businessObjective,
          contentStrategy,
          keywordResearch,
          ...(input.brandGuidelines !== undefined && { brandGuidelines: input.brandGuidelines }),
        });
        const draft = seoContent.contentDrafts[0];
        if (!draft) {
          return { outcome: "halt", reason: "No content draft was produced." };
        }
        ctx.set("seoContent", seoContent);
        ctx.set("draft", draft);
        return { outcome: "completed" };
      },
    },
    {
      id: "seo-optimization",
      name: "SEO Optimization",
      async run(ctx: WorkflowContext) {
        const draft = ctx.get("draft") as ContentPieceDraft;
        ctx.set("seoOptimizationFindings", checkDraftSeo(draft));
        return { outcome: "completed" };
      },
    },
    {
      id: "schema-generation",
      name: "Generate schema",
      async run(ctx: WorkflowContext) {
        const draft = ctx.get("draft") as ContentPieceDraft;
        ctx.set("schema", generateArticleSchema(draft));
        return { outcome: "completed" };
      },
    },
    {
      id: "metadata-generation",
      name: "Generate metadata",
      async run(ctx: WorkflowContext) {
        const draft = ctx.get("draft") as ContentPieceDraft;
        ctx.set("metadata", { metaTitle: draft.metaTitle, metaDescription: draft.metaDescription });
        return { outcome: "completed" };
      },
    },
    {
      id: "internal-link-generation",
      name: "Generate internal links",
      async run(ctx: WorkflowContext) {
        const contentStrategy = ctx.get("contentStrategy") as ContentStrategyResult;
        const draft = ctx.get("draft") as ContentPieceDraft;
        const relevant = contentStrategy.internalLinkingRecommendations.filter(
          (rec) => rec.fromTitle === draft.title || rec.toTitle === draft.title,
        );
        ctx.set("internalLinks", relevant);
        return { outcome: "completed" };
      },
    },
    {
      id: "publishing-checklist",
      name: "Generate publishing checklist",
      async run(ctx: WorkflowContext) {
        const seoContent = ctx.get("seoContent") as SeoContentResult;
        const seoOptimizationFindings = ctx.get("seoOptimizationFindings") as string[];
        ctx.set("publishingChecklist", {
          realProseGenerated: seoContent.dataAvailable,
          seoIssueCount: seoOptimizationFindings.length,
          readyForReview: true,
        });
        return { outcome: "completed" };
      },
    },
    {
      id: "publish-approval",
      name: "Ask for approval before publishing",
      async run(ctx: WorkflowContext) {
        const draft = ctx.get("draft") as ContentPieceDraft;
        const seoOptimizationFindings = ctx.get("seoOptimizationFindings") as string[];

        const approvalRequest: ApprovalRequest = {
          id: randomUUID(),
          reason: "destructive_action",
          summary:
            `Blog draft "${draft.title}" is ready for review. GLOBAL_RULES.md SS9 requires human approval ` +
            `before publishing website content. ${seoOptimizationFindings.length > 0 ? `${seoOptimizationFindings.length} SEO issue(s) were flagged -- see seoOptimizationFindings.` : "No SEO issues were flagged."}`,
          candidates: [
            {
              id: PROCEED_CANDIDATE_ID,
              label: `Approve "${draft.title}" for publishing`,
              score: 0,
              rationale: "Approving marks this draft publishable=true; this workflow never publishes it itself.",
            },
          ],
          createdAt: new Date().toISOString(),
        };

        await auditLogger.logEvent({
          actor: "blog-generation-workflow",
          eventType: "blog_publish_escalated",
          details: { runId, approvalRequestId: approvalRequest.id, title: draft.title },
        });

        const decision = await approvalChannel.requestDecision(approvalRequest);

        await auditLogger.logEvent({
          actor: "blog-generation-workflow",
          eventType: "blog_publish_escalation_resolved",
          details: { runId, approvalRequestId: approvalRequest.id, outcome: decision.outcome, notes: decision.notes },
        });

        const approved = decision.outcome === "candidate_selected" && decision.selectedCandidateId === PROCEED_CANDIDATE_ID;
        ctx.set("publishable", approved);
        ctx.set("approvalDecision", decision);

        if (!approved) {
          return { outcome: "halt", reason: `Human reviewer did not approve publishing: ${decision.notes}` };
        }
        return { outcome: "completed" };
      },
    },
  ];
}

export class BlogGenerationWorkflow {
  private constructor(
    private readonly engine: WorkflowEngine,
    private readonly agents: Parameters<typeof buildBlogGenerationWorkflowSteps>[1],
    private readonly approvalChannel: ApprovalChannel,
    private readonly auditLogger: AuditLogger,
  ) {}

  static async create(
    baseDirectory: string = process.cwd(),
    approvalChannel: ApprovalChannel = new CliApprovalChannel(),
    providers: BlogGenerationWorkflowProviders = {},
  ): Promise<BlogGenerationWorkflow> {
    const keywordResearchAgent = await KeywordResearchAgent.create(
      loadKeywordResearchAgentConfig({}, baseDirectory),
      providers.keywordDataProvider ?? new NullKeywordDataProvider(),
      approvalChannel,
    );
    const contentStrategyAgent = await ContentStrategyAgent.create(loadContentStrategyAgentConfig({}, baseDirectory), approvalChannel);
    const seoContentAgent = await SeoContentAgent.create(
      loadSeoContentAgentConfig({}, baseDirectory),
      providers.contentGenerationProvider ?? new NullContentGenerationProvider(),
      approvalChannel,
    );

    const workflowAuditLogPath =
      process.env["BLOG_GENERATION_WORKFLOW_AUDIT_LOG"] ??
      join(baseDirectory, "var", "workflows", "blog-generation-workflow", "audit-log.jsonl");
    const auditLogger = new AuditLogger(workflowAuditLogPath);
    const engine = new WorkflowEngine(auditLogger);

    return new BlogGenerationWorkflow(engine, { keywordResearchAgent, contentStrategyAgent, seoContentAgent }, approvalChannel, auditLogger);
  }

  async run(input: BlogGenerationWorkflowInput): Promise<WorkflowRunResult> {
    const steps = buildBlogGenerationWorkflowSteps(input, this.agents, this.approvalChannel, this.auditLogger);
    return this.engine.run("blog-generation-workflow", steps, { input });
  }
}
