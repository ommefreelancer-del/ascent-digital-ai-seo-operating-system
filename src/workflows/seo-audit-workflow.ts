// The 23-step SEO workflow requested for ADASOS, built entirely from
// EXISTING, already-tested agents (Phase 1's crawler/site-audit-orchestrator,
// plus the technical-seo/keyword-research/content-strategy/competitor-
// intelligence/seo-content/on-page-seo/performance-analytics agents that
// already shipped) -- no agent's own logic is duplicated or bypassed here.
// See workflows/seo-workflow.md for the step-by-step contract in prose.
//
// EXECUTION ORDER vs REQUESTED NUMBERING: the 23 steps are numbered exactly
// as requested (Website Crawl=1 ... Publishing Checklist=23), and every
// step's `id`/`name` carries its requested number. But a few steps have a
// genuine data dependency that the requested numbering doesn't reflect --
// most notably, "Keyword Gap Analysis" (10) needs real competitor content-
// cluster coverage, which only exists after "Competitor Analysis" (11), and
// several steps need real Keyword Research (12) before they can produce
// anything. Rather than force literal 1-23 execution order (which would
// require fabricating placeholder keyword/competitor data to satisfy a step
// that runs "too early" -- a direct GLOBAL_RULES.md SS2 violation), this
// workflow executes steps 1-9 and then 12(keyword research)->11(competitor,
// optional)->10(gap analysis)->13-23 in real dependency order, while keeping
// each step's requested number as its identity. This is documented, not
// hidden: workflows/seo-workflow.md explains it, and every WorkflowStep's
// `name` states its requested number explicitly.
//
// Steps 17-21 (Meta Title/Description/FAQ/Internal-Link-Suggestions/Image-
// Suggestions Generation) deliberately do NOT make a second agent call --
// they extract and re-present fields the Content Strategy Agent (14) and
// SEO Content Agent (15) already computed, or filter findings the site audit
// (2-9) already produced. Calling an agent a second time for data it already
// produced would not be "more real" -- it would just be redundant work
// computing the exact same real values twice.

import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type { ApprovalChannel } from "../core/governance/approval-channel.js";
import { CliApprovalChannel } from "../core/governance/cli-approval-channel.js";
import { AuditLogger } from "../core/governance/audit-logger.js";
import { WorkflowEngine } from "../core/workflow/workflow-engine.js";
import type { WorkflowContext, WorkflowRunResult, WorkflowStep } from "../core/workflow/workflow-step.types.js";
import type { WebsiteCrawlerOptions } from "../core/crawling/website-crawler.js";
import { crawlWebsite } from "../core/crawling/website-crawler.js";
import { generateArticleSchema } from "./schema-generation.js";

import { WebsiteAuditAgent } from "../agents/website-audit-agent/website-audit-agent.js";
import { loadWebsiteAuditAgentConfig } from "../agents/website-audit-agent/config/website-audit-agent.config.js";
import { SiteAuditOrchestrator, type SiteAuditResult } from "../agents/website-audit-agent/site-audit-orchestrator.js";
import type { AuditFinding, WebsiteAuditResult } from "../agents/website-audit-agent/types/website-audit-request.types.js";

import { TechnicalSeoAgent } from "../agents/technical-seo-agent/technical-seo-agent.js";
import { loadTechnicalSeoAgentConfig } from "../agents/technical-seo-agent/config/technical-seo-agent.config.js";
import type { TechnicalSeoResult } from "../agents/technical-seo-agent/types/technical-seo-request.types.js";

import { KeywordResearchAgent } from "../agents/keyword-research-agent/keyword-research-agent.js";
import { loadKeywordResearchAgentConfig } from "../agents/keyword-research-agent/config/keyword-research-agent.config.js";
import type { KeywordDataProvider } from "../agents/keyword-research-agent/types/keyword-data-provider.types.js";
import { NullKeywordDataProvider } from "../agents/keyword-research-agent/providers/null-keyword-data-provider.js";
import type { KeywordResearchResult } from "../agents/keyword-research-agent/types/keyword-request.types.js";

import { ContentStrategyAgent } from "../agents/content-strategy-agent/content-strategy-agent.js";
import { loadContentStrategyAgentConfig } from "../agents/content-strategy-agent/config/content-strategy-agent.config.js";
import type { ContentStrategyResult } from "../agents/content-strategy-agent/types/content-strategy-request.types.js";

import { CompetitorIntelligenceAgent } from "../agents/competitor-intelligence-agent/competitor-intelligence-agent.js";
import { loadCompetitorIntelligenceAgentConfig } from "../agents/competitor-intelligence-agent/config/competitor-intelligence-agent.config.js";
import type {
  CompetitorIntelligenceResult,
  CompetitorSnapshot,
} from "../agents/competitor-intelligence-agent/types/competitor-intelligence-request.types.js";

import { SeoContentAgent } from "../agents/seo-content-agent/seo-content-agent.js";
import { loadSeoContentAgentConfig } from "../agents/seo-content-agent/config/seo-content-agent.config.js";
import type { ContentGenerationProvider } from "../agents/seo-content-agent/types/content-generation-provider.types.js";
import { NullContentGenerationProvider } from "../agents/seo-content-agent/providers/null-content-generation-provider.js";
import type { SeoContentResult } from "../agents/seo-content-agent/types/seo-content-request.types.js";

import { OnPageSeoAgent } from "../agents/on-page-seo-agent/on-page-seo-agent.js";
import { loadOnPageSeoAgentConfig } from "../agents/on-page-seo-agent/config/on-page-seo-agent.config.js";

import { PerformanceAnalyticsAgent } from "../agents/performance-analytics-agent/performance-analytics-agent.js";
import { loadPerformanceAnalyticsAgentConfig } from "../agents/performance-analytics-agent/config/performance-analytics-agent.config.js";
import type { PerformanceDataProvider } from "../agents/performance-analytics-agent/types/performance-data-provider.types.js";
import { NullPerformanceDataProvider } from "../agents/performance-analytics-agent/providers/null-performance-data-provider.js";

export interface SeoAuditWorkflowInput {
  readonly startUrl: string;
  readonly businessObjective: string;
  readonly seedKeywords: readonly string[];
  readonly targetAudience?: string;
  /** Real competitor HTML snapshots, if the caller has them. Never fetched automatically -- see CompetitorIntelligenceAgent. */
  readonly competitors?: readonly CompetitorSnapshot[];
  readonly brandGuidelines?: string;
  readonly crawlOptions?: WebsiteCrawlerOptions;
  /** Opt-in: runs a real Lighthouse pass (launches local headless Chrome, slow). Off by default. */
  readonly includePerformanceAudit?: boolean;
}

export interface SeoAuditWorkflowProviders {
  readonly keywordDataProvider?: KeywordDataProvider;
  readonly contentGenerationProvider?: ContentGenerationProvider;
  readonly performanceDataProvider?: PerformanceDataProvider;
}

function findingsByCategory(findings: readonly AuditFinding[], categories: readonly string[]): AuditFinding[] {
  const set = new Set(categories);
  return findings.filter((f) => set.has(f.category));
}

function homePageAudit(siteAudit: SiteAuditResult): WebsiteAuditResult | null {
  return siteAudit.pageAudits.find((p) => p.url === siteAudit.startUrl)?.audit ?? siteAudit.pageAudits[0]?.audit ?? null;
}

/**
 * Assembles the 23 real steps, in genuine dependency order, against
 * already-constructed agent instances. Exported separately from
 * SeoAuditWorkflow so tests can inject fakes/stubs for individual agents
 * without spinning up the full factory.
 */
export function buildSeoAuditWorkflowSteps(
  input: SeoAuditWorkflowInput,
  agents: {
    readonly websiteAuditAgent: WebsiteAuditAgent;
    readonly siteAuditOrchestrator: SiteAuditOrchestrator;
    readonly technicalSeoAgent: TechnicalSeoAgent;
    readonly keywordResearchAgent: KeywordResearchAgent;
    readonly contentStrategyAgent: ContentStrategyAgent;
    readonly competitorIntelligenceAgent: CompetitorIntelligenceAgent;
    readonly seoContentAgent: SeoContentAgent;
    readonly onPageSeoAgent: OnPageSeoAgent;
    readonly performanceAnalyticsAgent: PerformanceAnalyticsAgent;
  },
): WorkflowStep[] {
  const runId = randomUUID();

  return [
    {
      id: "step-01-website-crawl",
      name: "1. Website Crawl",
      async run(ctx: WorkflowContext) {
        const crawl = await crawlWebsite(input.startUrl, input.crawlOptions ?? {});
        ctx.set("crawl", crawl);
        return { outcome: "completed" };
      },
    },
    {
      id: "step-02-technical-seo-audit",
      name: "2. Technical SEO Audit",
      async run(ctx: WorkflowContext) {
        const crawl = ctx.get("crawl") as Awaited<ReturnType<typeof crawlWebsite>>;
        const siteAudit = await agents.siteAuditOrchestrator.auditCrawl(crawl);
        ctx.set("siteAudit", siteAudit);
        const home = homePageAudit(siteAudit);
        if (!home) {
          return { outcome: "skipped", reason: "The start page could not be audited (fetch failure or rejection); technical recommendations require it." };
        }
        ctx.set("homePageAudit", home);
        const technicalSeo = await agents.technicalSeoAgent.generateRecommendations({
          id: `${runId}:technical-seo`,
          websiteAudit: home,
          crossFunctionalNotes: [],
        });
        ctx.set("technicalSeo", technicalSeo);
        return { outcome: "completed" };
      },
    },
    {
      id: "step-03-on-page-seo-audit",
      name: "3. On-Page SEO Audit (structural findings)",
      async run(ctx: WorkflowContext) {
        const home = ctx.get("homePageAudit") as WebsiteAuditResult | undefined;
        if (!home) return { outcome: "skipped", reason: "No home page audit available (see step 2)." };
        ctx.set(
          "onPageAuditFindings",
          findingsByCategory(home.findings, ["metadata", "canonical", "image-alt", "open-graph", "twitter-card"]),
        );
        return { outcome: "completed" };
      },
    },
    {
      id: "step-04-schema-audit",
      name: "4. Schema Audit",
      async run(ctx: WorkflowContext) {
        const home = ctx.get("homePageAudit") as WebsiteAuditResult | undefined;
        if (!home) return { outcome: "skipped", reason: "No home page audit available (see step 2)." };
        ctx.set("schemaFindings", findingsByCategory(home.findings, ["structured-data-validation", "schema-type-validation", "page-structure"]));
        return { outcome: "completed" };
      },
    },
    {
      id: "step-05-accessibility-audit",
      name: "5. Accessibility Audit",
      async run(ctx: WorkflowContext) {
        const home = ctx.get("homePageAudit") as WebsiteAuditResult | undefined;
        if (!home) return { outcome: "skipped", reason: "No home page audit available (see step 2)." };
        ctx.set("accessibilityFindings", findingsByCategory(home.findings, ["accessibility", "image-alt"]));
        return { outcome: "completed" };
      },
    },
    {
      id: "step-06-performance-audit",
      name: "6. Performance Audit",
      async run(ctx: WorkflowContext) {
        if (!input.includePerformanceAudit) {
          return { outcome: "skipped", reason: "includePerformanceAudit was not requested for this run." };
        }
        const home = ctx.get("homePageAudit") as WebsiteAuditResult | undefined;
        const technicalSeo = ctx.get("technicalSeo") as TechnicalSeoResult | undefined;
        if (!home || !technicalSeo) return { outcome: "skipped", reason: "Technical SEO audit (step 2) did not complete." };

        const emptyKeywordResearch: KeywordResearchResult = {
          requestId: `${runId}:performance-placeholder-keywords`,
          classifiedKeywords: [],
          topicClusters: [],
          metricsAvailable: false,
          limitations: ["Keyword research (step 12) has not run yet at this point in the workflow; ranking insights are unavailable for this step."],
          rankingDisclaimer: "This report does not guarantee search rankings or traffic outcomes.",
          decidedAt: new Date().toISOString(),
        };
        const performance = await agents.performanceAnalyticsAgent.analyzePerformance({
          id: `${runId}:performance`,
          url: input.startUrl,
          keywordResearch: emptyKeywordResearch,
          websiteAudit: home,
          technicalSeo,
        });
        ctx.set("performance", performance);
        return { outcome: "completed" };
      },
    },
    {
      id: "step-07-mobile-audit",
      name: "7. Mobile Audit",
      async run(ctx: WorkflowContext) {
        const home = ctx.get("homePageAudit") as WebsiteAuditResult | undefined;
        if (!home) return { outcome: "skipped", reason: "No home page audit available (see step 2)." };
        ctx.set("mobileFindings", findingsByCategory(home.findings, ["mobile-friendliness"]));
        return { outcome: "completed" };
      },
    },
    {
      id: "step-08-internal-linking-audit",
      name: "8. Internal Linking Audit",
      async run(ctx: WorkflowContext) {
        const siteAudit = ctx.get("siteAudit") as SiteAuditResult | undefined;
        const home = ctx.get("homePageAudit") as WebsiteAuditResult | undefined;
        if (!siteAudit) return { outcome: "skipped", reason: "No site audit available (see step 2)." };
        const siteWide = findingsByCategory(siteAudit.siteFindings, ["site-wide-internal-linking", "broken-links", "redirect-chains"]);
        const perPage = home ? findingsByCategory(home.findings, ["internal-links"]) : [];
        ctx.set("internalLinkingFindings", [...siteWide, ...perPage]);
        return { outcome: "completed" };
      },
    },
    {
      id: "step-09-content-audit",
      name: "9. Content Audit",
      async run(ctx: WorkflowContext) {
        const home = ctx.get("homePageAudit") as WebsiteAuditResult | undefined;
        if (!home) return { outcome: "skipped", reason: "No home page audit available (see step 2)." };
        ctx.set("contentFindings", findingsByCategory(home.findings, ["headings", "crawlability"]));
        return { outcome: "completed" };
      },
    },
    {
      id: "step-12-keyword-research",
      name: "12. Keyword Research (runs here; steps 10-11 and 13+ depend on it)",
      async run(ctx: WorkflowContext) {
        if (input.seedKeywords.length === 0) {
          return { outcome: "skipped", reason: "No seedKeywords were supplied." };
        }
        const keywordResearch = await agents.keywordResearchAgent.researchKeywords({
          id: `${runId}:keyword-research`,
          businessObjective: input.businessObjective,
          seedKeywords: input.seedKeywords,
          ...(input.targetAudience !== undefined && { targetAudience: input.targetAudience }),
        });
        ctx.set("keywordResearch", keywordResearch);
        return { outcome: "completed" };
      },
    },
    {
      id: "step-13-search-intent-analysis",
      name: "13. Search Intent Analysis",
      async run(ctx: WorkflowContext) {
        const keywordResearch = ctx.get("keywordResearch") as KeywordResearchResult | undefined;
        if (!keywordResearch) return { outcome: "skipped", reason: "Keyword research (step 12) did not run." };
        // Real data already computed by step 12 -- this step reports the
        // intent breakdown rather than re-classifying anything.
        const byIntent: Record<string, number> = {};
        for (const kw of keywordResearch.classifiedKeywords) {
          byIntent[kw.intent] = (byIntent[kw.intent] ?? 0) + 1;
        }
        ctx.set("searchIntentBreakdown", byIntent);
        return { outcome: "completed" };
      },
    },
    {
      id: "step-11-competitor-analysis",
      name: "11. Competitor Analysis",
      async run(ctx: WorkflowContext) {
        const competitors = input.competitors ?? [];
        if (competitors.length === 0) {
          return { outcome: "skipped", reason: "No competitor HTML snapshots were supplied -- competitors are never fetched automatically." };
        }
        const home = ctx.get("homePageAudit") as WebsiteAuditResult | undefined;
        const technicalSeo = ctx.get("technicalSeo") as TechnicalSeoResult | undefined;
        const keywordResearch = ctx.get("keywordResearch") as KeywordResearchResult | undefined;
        if (!home || !technicalSeo || !keywordResearch) {
          return { outcome: "skipped", reason: "Technical SEO audit and/or keyword research did not complete." };
        }
        const competitorIntelligence = await agents.competitorIntelligenceAgent.analyzeCompetitors({
          id: `${runId}:competitor-intelligence`,
          ourWebsiteAudit: home,
          ourTechnicalSeo: technicalSeo,
          ourKeywordResearch: keywordResearch,
          competitors,
        });
        ctx.set("competitorIntelligence", competitorIntelligence);
        return { outcome: "completed" };
      },
    },
    {
      id: "step-10-keyword-gap-analysis",
      name: "10. Keyword Gap Analysis",
      async run(ctx: WorkflowContext) {
        const competitorIntelligence = ctx.get("competitorIntelligence") as CompetitorIntelligenceResult | undefined;
        if (!competitorIntelligence) {
          return { outcome: "skipped", reason: "No competitor analysis available (see step 11) -- keyword gaps cannot be identified without real competitor content-cluster coverage." };
        }
        // Real data: clusters our own keyword research produced that at
        // least one competitor's title/heading text appears to cover but we
        // have no content brief for yet.
        const gaps = competitorIntelligence.contentGapAnalysis.filter((c) => c.coveredByCompetitors.length > 0);
        ctx.set("keywordGaps", gaps);
        return { outcome: "completed" };
      },
    },
    {
      id: "step-14-content-brief-generation",
      name: "14. Content Brief Generation",
      async run(ctx: WorkflowContext) {
        const keywordResearch = ctx.get("keywordResearch") as KeywordResearchResult | undefined;
        if (!keywordResearch) return { outcome: "skipped", reason: "Keyword research (step 12) did not run." };
        const contentStrategy = await agents.contentStrategyAgent.developStrategy({
          id: `${runId}:content-strategy`,
          businessObjective: input.businessObjective,
          keywordResearch,
          ...(input.targetAudience !== undefined && { targetAudience: input.targetAudience }),
        });
        ctx.set("contentStrategy", contentStrategy);
        return { outcome: "completed" };
      },
    },
    {
      id: "step-15-ai-article-generation",
      name: "15. AI Article Generation",
      async run(ctx: WorkflowContext) {
        const contentStrategy = ctx.get("contentStrategy") as ContentStrategyResult | undefined;
        const keywordResearch = ctx.get("keywordResearch") as KeywordResearchResult | undefined;
        if (!contentStrategy || !keywordResearch) return { outcome: "skipped", reason: "Content brief generation (step 14) did not run." };
        if (contentStrategy.contentBriefs.length === 0) {
          return { outcome: "skipped", reason: "No content briefs were produced to draft." };
        }
        const seoContent = await agents.seoContentAgent.developContent({
          id: `${runId}:seo-content`,
          businessObjective: input.businessObjective,
          contentStrategy,
          keywordResearch,
          ...(input.brandGuidelines !== undefined && { brandGuidelines: input.brandGuidelines }),
        });
        ctx.set("seoContent", seoContent);
        return { outcome: "completed" };
      },
    },
    {
      id: "step-16-seo-optimization",
      name: "16. SEO Optimization",
      async run(ctx: WorkflowContext) {
        const home = ctx.get("homePageAudit") as WebsiteAuditResult | undefined;
        const keywordResearch = ctx.get("keywordResearch") as KeywordResearchResult | undefined;
        if (!home || !keywordResearch || keywordResearch.classifiedKeywords.length === 0) {
          return { outcome: "skipped", reason: "No home page audit and/or classified keyword available to target." };
        }
        const targetKeyword = keywordResearch.classifiedKeywords[0]?.keyword;
        if (!targetKeyword) return { outcome: "skipped", reason: "No target keyword available." };
        const onPageSeo = await agents.onPageSeoAgent.generateRecommendations({
          id: `${runId}:on-page-seo`,
          websiteAudit: home,
          keywordResearch,
          targetKeyword,
        });
        ctx.set("onPageSeo", onPageSeo);
        return { outcome: "completed" };
      },
    },
    {
      id: "step-17-meta-title-generation",
      name: "17. Meta Title Generation",
      async run(ctx: WorkflowContext) {
        const seoContent = ctx.get("seoContent") as SeoContentResult | undefined;
        if (!seoContent) return { outcome: "skipped", reason: "No generated content available (see step 15)." };
        ctx.set("metaTitles", seoContent.contentDrafts.map((d) => ({ title: d.title, metaTitle: d.metaTitle })));
        return { outcome: "completed" };
      },
    },
    {
      id: "step-18-meta-description-generation",
      name: "18. Meta Description Generation",
      async run(ctx: WorkflowContext) {
        const seoContent = ctx.get("seoContent") as SeoContentResult | undefined;
        if (!seoContent) return { outcome: "skipped", reason: "No generated content available (see step 15)." };
        ctx.set("metaDescriptions", seoContent.contentDrafts.map((d) => ({ title: d.title, metaDescription: d.metaDescription })));
        return { outcome: "completed" };
      },
    },
    {
      id: "step-19-faq-generation",
      name: "19. FAQ Generation",
      async run(ctx: WorkflowContext) {
        const seoContent = ctx.get("seoContent") as SeoContentResult | undefined;
        if (!seoContent) return { outcome: "skipped", reason: "No generated content available (see step 15)." };
        ctx.set("faqs", seoContent.contentDrafts.map((d) => ({ title: d.title, faqs: d.faqs })));
        return { outcome: "completed" };
      },
    },
    {
      id: "step-20-internal-link-suggestions",
      name: "20. Internal Link Suggestions",
      async run(ctx: WorkflowContext) {
        const contentStrategy = ctx.get("contentStrategy") as ContentStrategyResult | undefined;
        if (!contentStrategy) return { outcome: "skipped", reason: "Content brief generation (step 14) did not run." };
        ctx.set("internalLinkSuggestions", contentStrategy.internalLinkingRecommendations);
        return { outcome: "completed" };
      },
    },
    {
      id: "step-21-image-suggestions",
      name: "21. Image Suggestions",
      async run(ctx: WorkflowContext) {
        const home = ctx.get("homePageAudit") as WebsiteAuditResult | undefined;
        if (!home) return { outcome: "skipped", reason: "No home page audit available (see step 2)." };
        const missingAlt = home.findings.filter((f) => f.category === "image-alt" && f.severity === "warning");
        ctx.set("imageSuggestions", missingAlt);
        return { outcome: "completed" };
      },
    },
    {
      id: "step-22-schema-generation",
      name: "22. Schema Generation",
      async run(ctx: WorkflowContext) {
        const contentStrategy = ctx.get("contentStrategy") as ContentStrategyResult | undefined;
        if (!contentStrategy || contentStrategy.contentBriefs.length === 0) {
          return { outcome: "skipped", reason: "No content briefs available to generate schema for (see step 14)." };
        }
        ctx.set("generatedSchema", contentStrategy.contentBriefs.map((brief) => generateArticleSchema(brief)));
        return { outcome: "completed" };
      },
    },
    {
      id: "step-23-publishing-checklist",
      name: "23. Publishing Checklist",
      async run(ctx: WorkflowContext) {
        const siteAudit = ctx.get("siteAudit") as SiteAuditResult | undefined;
        const seoContent = ctx.get("seoContent") as SeoContentResult | undefined;
        const generatedSchema = ctx.get("generatedSchema") as unknown[] | undefined;

        const criticalFindingsRemaining =
          (siteAudit?.pageAudits ?? []).reduce((sum, p) => sum + (p.audit?.summary.criticalCount ?? 0), 0) +
          (siteAudit?.siteFindings.filter((f) => f.severity === "critical").length ?? 0);

        ctx.set("publishingChecklist", {
          criticalFindingsRemaining,
          readyToPublish: criticalFindingsRemaining === 0,
          realProseGenerated: seoContent?.dataAvailable ?? false,
          schemaGenerated: (generatedSchema?.length ?? 0) > 0,
          note:
            criticalFindingsRemaining > 0
              ? `${criticalFindingsRemaining} critical finding(s) remain unresolved -- resolve before publishing.`
              : "No critical findings remain from this audit run.",
        });
        return { outcome: "completed" };
      },
    },
  ];
}

export class SeoAuditWorkflow {
  private constructor(
    private readonly engine: WorkflowEngine,
    private readonly agents: Parameters<typeof buildSeoAuditWorkflowSteps>[1],
  ) {}

  static async create(
    baseDirectory: string = process.cwd(),
    approvalChannel: ApprovalChannel = new CliApprovalChannel(),
    providers: SeoAuditWorkflowProviders = {},
  ): Promise<SeoAuditWorkflow> {
    const websiteAuditAgent = await WebsiteAuditAgent.create(loadWebsiteAuditAgentConfig({}, baseDirectory), approvalChannel);
    const siteAuditOrchestrator = await SiteAuditOrchestrator.create(loadWebsiteAuditAgentConfig({}, baseDirectory), approvalChannel);
    const technicalSeoAgent = await TechnicalSeoAgent.create(loadTechnicalSeoAgentConfig({}, baseDirectory), approvalChannel);
    const keywordResearchAgent = await KeywordResearchAgent.create(
      loadKeywordResearchAgentConfig({}, baseDirectory),
      providers.keywordDataProvider ?? new NullKeywordDataProvider(),
      approvalChannel,
    );
    const contentStrategyAgent = await ContentStrategyAgent.create(loadContentStrategyAgentConfig({}, baseDirectory), approvalChannel);
    const competitorIntelligenceAgent = await CompetitorIntelligenceAgent.create(
      loadCompetitorIntelligenceAgentConfig({}, baseDirectory),
      websiteAuditAgent,
      approvalChannel,
    );
    const seoContentAgent = await SeoContentAgent.create(
      loadSeoContentAgentConfig({}, baseDirectory),
      providers.contentGenerationProvider ?? new NullContentGenerationProvider(),
      approvalChannel,
    );
    const onPageSeoAgent = await OnPageSeoAgent.create(loadOnPageSeoAgentConfig({}, baseDirectory), approvalChannel);
    const performanceAnalyticsAgent = await PerformanceAnalyticsAgent.create(
      loadPerformanceAnalyticsAgentConfig({}, baseDirectory),
      providers.performanceDataProvider ?? new NullPerformanceDataProvider(),
      approvalChannel,
    );

    const agents = {
      websiteAuditAgent,
      siteAuditOrchestrator,
      technicalSeoAgent,
      keywordResearchAgent,
      contentStrategyAgent,
      competitorIntelligenceAgent,
      seoContentAgent,
      onPageSeoAgent,
      performanceAnalyticsAgent,
    };

    const workflowAuditLogPath =
      process.env["SEO_AUDIT_WORKFLOW_AUDIT_LOG"] ?? join(baseDirectory, "var", "workflows", "seo-audit-workflow", "audit-log.jsonl");
    const engine = new WorkflowEngine(new AuditLogger(workflowAuditLogPath));

    return new SeoAuditWorkflow(engine, agents);
  }

  async run(input: SeoAuditWorkflowInput): Promise<WorkflowRunResult> {
    const steps = buildSeoAuditWorkflowSteps(input, this.agents);
    return this.engine.run("seo-audit-workflow", steps, { input });
  }
}
