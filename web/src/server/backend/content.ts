import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createWebApprovalChannel } from "./approval";
import { attachSupportingImages } from "./content-images";
import { stripSupportingMetadataFromBody } from "@/lib/markdown-lite";
import type { ContentQaSummary, KeywordResearchResult, ContentStrategyResult, SeoContentResult } from "./types";

const here = path.dirname(fileURLToPath(import.meta.url));
const backendDist = path.resolve(here, "../../../../dist/src");
const backendRoot = path.resolve(here, "../../../..");

async function importBackend(relativeToSrc: string) {
  return import(/* webpackIgnore: true */ `file://${path.join(backendDist, relativeToSrc)}`);
}

let agentsPromise: Promise<{ keywordAgent: any; strategyAgent: any; contentAgent: any }> | null = null;

async function getAgents() {
  if (!agentsPromise) {
    agentsPromise = (async () => {
      const [
        { KeywordResearchAgent },
        { loadKeywordResearchAgentConfig },
        { DataForSeoKeywordDataProvider },
        { ContentStrategyAgent },
        { loadContentStrategyAgentConfig },
        { AnthropicOutlineGenerationProvider },
        { GeminiOutlineGenerationProvider },
        { FallbackOutlineGenerationProvider },
        { SeoContentAgent },
        { loadSeoContentAgentConfig },
        { AnthropicContentGenerationProvider },
        { GeminiContentGenerationProvider },
        { FallbackContentGenerationProvider },
        { GeminiRateLimiter },
        { selfTestArticlePurityValidator },
      ] = await Promise.all([
        importBackend("agents/keyword-research-agent/keyword-research-agent.js"),
        importBackend("agents/keyword-research-agent/config/keyword-research-agent.config.js"),
        importBackend("agents/keyword-research-agent/providers/dataforseo-keyword-data-provider.js"),
        importBackend("agents/content-strategy-agent/content-strategy-agent.js"),
        importBackend("agents/content-strategy-agent/config/content-strategy-agent.config.js"),
        importBackend("agents/content-strategy-agent/providers/anthropic-outline-generation-provider.js"),
        importBackend("agents/content-strategy-agent/providers/gemini-outline-generation-provider.js"),
        importBackend("agents/content-strategy-agent/providers/fallback-outline-generation-provider.js"),
        importBackend("agents/seo-content-agent/seo-content-agent.js"),
        importBackend("agents/seo-content-agent/config/seo-content-agent.config.js"),
        importBackend("agents/seo-content-agent/providers/anthropic-content-generation-provider.js"),
        importBackend("agents/seo-content-agent/providers/gemini-content-generation-provider.js"),
        importBackend("agents/seo-content-agent/providers/fallback-content-generation-provider.js"),
        importBackend("agents/seo-content-agent/providers/gemini-rate-limiter.js"),
        importBackend("agents/seo-content-agent/validation/article-purity-validator.js"),
      ]);

      // PRE-GENERATION SAFETY GATE (2026-09-06): confirms the permanent structural gate itself is actually
      // working -- entirely local, zero-cost, zero-network -- BEFORE this function goes on to construct the
      // real, billed AnthropicContentGenerationProvider/GeminiContentGenerationProvider below. If the
      // validator's own logic is broken (can no longer tell contaminated prose from clean prose), every
      // future real generation would be structurally unprotected; refusing to wire up a real, paid provider
      // in that case is strictly better than spending a real API credit on a request this pipeline can no
      // longer honestly validate.
      if (!selfTestArticlePurityValidator()) {
        throw new Error(
          "Content generation pipeline self-check failed: the permanent article-purity structural gate did not correctly distinguish clean from contaminated content. Refusing to configure a real content-generation provider until this is fixed.",
        );
      }

      // Shared by BOTH Gemini providers below (outline + content) so the whole pipeline paces itself
      // against ONE real free-tier quota instead of each provider guessing independently -- see
      // gemini-rate-limiter.ts.
      const geminiRateLimiter = new GeminiRateLimiter();

      // Wires the real, already-tested DataForSeoKeywordDataProvider (the
      // same DATAFORSEO_LOGIN/DATAFORSEO_PASSWORD/DATAFORSEO_SANDBOX
      // credential mechanism web/src/server/dataforseo.ts already uses for
      // backlinks/health-checks) instead of the previous `undefined` ->
      // NullKeywordDataProvider default -- mirrors off-page-seo.ts's own
      // getDataForSeoBacklinkDataProvider() convention: instantiate with no
      // constructor args and let the provider read its own credentials from
      // process.env. The provider itself returns `null` (never a fabricated
      // metric) when credentials aren't configured, a production call isn't
      // explicitly allowed, or the real DataForSEO API call fails for any
      // reason -- this wiring changes nothing about that contract.
      const keywordAgent = await KeywordResearchAgent.create(
        loadKeywordResearchAgentConfig({ auditLogPath: path.join(backendRoot, "var", "web", "keyword-research-agent", "audit-log.jsonl") }, backendRoot),
        new DataForSeoKeywordDataProvider(),
        createWebApprovalChannel(),
      );
      // CONTENT FRAMEWORK HARDENING (2026-08-28): wires the real, already-
      // approved Anthropic-backed outline provider (same ANTHROPIC_API_KEY
      // as every other Anthropic use in this app) instead of the previous
      // `undefined` -> NullOutlineGenerationProvider default, which made
      // every single content brief use the identical fixed six-heading
      // template regardless of topic. See
      // src/agents/content-strategy-agent/providers/anthropic-outline-generation-provider.ts
      // and content-brief-builder.ts's own header for the real defect this closes.
      //
      // GEMINI BILLING FALLBACK (2026-08-28): same fallback contract as the content-generation provider
      // below -- Anthropic remains first choice; only a genuine billing/credit/access failure retries
      // the SAME outline request against Gemini, which asks for the identical genuine, topic-specific
      // outline (never the old deterministic six-heading template unless BOTH real providers are
      // unavailable). See fallback-outline-generation-provider.ts.
      const strategyAgent = await ContentStrategyAgent.create(
        loadContentStrategyAgentConfig({ auditLogPath: path.join(backendRoot, "var", "web", "content-strategy-agent", "audit-log.jsonl") }, backendRoot),
        new FallbackOutlineGenerationProvider(
          new AnthropicOutlineGenerationProvider({ throwOnBillingFailure: true }),
          new GeminiOutlineGenerationProvider({ rateLimiter: geminiRateLimiter }),
        ),
        createWebApprovalChannel(),
      );
      // Wires the real, already-approved Anthropic-backed provider (the
      // same ANTHROPIC_API_KEY already used by specialist-ai.ts elsewhere
      // in this web layer) instead of the previous `undefined` -> Null
      // default, which silently produced bracketed placeholder prose for
      // every request through this route. See
      // src/agents/seo-content-agent/providers/anthropic-content-generation-provider.ts
      // for why this is the explicit-opt-in point, not a new default inside
      // the agent itself.
      //
      // GEMINI BILLING FALLBACK (2026-08-28): Anthropic remains the first-choice provider. Wrapped in
      // FallbackContentGenerationProvider so that if -- and only if -- an Anthropic call fails
      // specifically because the account's own credit balance/billing/access is exhausted (not a rate
      // limit or any other unrelated failure), the SAME call is retried against the real, already-
      // approved Gemini provider (reusing GOOGLE_GEMINI_API_KEY, already configured for the
      // integration health check in ./gemini-provider.ts) instead of silently degrading to placeholder
      // prose. See fallback-content-generation-provider.ts and provider-billing-unavailable-error.ts
      // for the exact classification and fallback contract.
      const contentAgent = await SeoContentAgent.create(
        loadSeoContentAgentConfig({ auditLogPath: path.join(backendRoot, "var", "web", "seo-content-agent", "audit-log.jsonl") }, backendRoot),
        new FallbackContentGenerationProvider(
          new AnthropicContentGenerationProvider({ throwOnBillingFailure: true }),
          new GeminiContentGenerationProvider({ rateLimiter: geminiRateLimiter }),
        ),
        createWebApprovalChannel(),
      );
      return { keywordAgent, strategyAgent, contentAgent };
    })();
  }
  return agentsPromise;
}

export type ContentGeneratorType = "blog" | "landing-page" | "meta" | "social";

export interface GenerateContentInput {
  readonly type: ContentGeneratorType;
  readonly topic: string;
  readonly businessObjective: string;
  readonly brandGuidelines?: string;
}

/**
 * Runs the real, full pipeline (Keyword Research -> Content Strategy -> SEO
 * Content) from a single topic. Every field in the result traces to one of
 * these three real agents -- nothing here is templated or fabricated by the
 * web layer itself.
 */
export async function generateContent(input: GenerateContentInput): Promise<SeoContentResult> {
  const { keywordAgent, strategyAgent, contentAgent } = await getAgents();

  const keywordResearch = await keywordAgent.researchKeywords({
    id: randomUUID(),
    businessObjective: input.businessObjective,
    seedKeywords: [input.topic],
  });

  const contentStrategy = await strategyAgent.developStrategy({
    id: randomUUID(),
    businessObjective: input.businessObjective,
    keywordResearch,
    articlesPerWeek: 1,
  });

  const content: SeoContentResult = await contentAgent.developContent({
    id: randomUUID(),
    businessObjective: input.businessObjective,
    contentStrategy,
    keywordResearch,
    ...(input.brandGuidelines ? { brandGuidelines: input.brandGuidelines } : {}),
  });

  // Attaches real, genuinely relevant Pixabay images (same shared service the
  // Graphic Design Agent's routes use) to qualifying sections -- see
  // content-images.ts. Never fabricates: sections with no suitable real
  // result are left with no image.
  return attachSupportingImages(content);
}

export interface ChatKeywordResearchAndContentResult {
  readonly keywordResearch: KeywordResearchResult;
  readonly contentStrategy: ContentStrategyResult;
  readonly content: SeoContentResult;
}

/**
 * The same real Keyword Research -> Content Strategy -> SEO Content chain
 * generateContent() runs for the dedicated /api/content form, reused here so
 * the chat-triggered pipeline (specialist-orchestrator.ts) reaches the exact
 * same real agents -- via the SAME cached getAgents() instances, not a
 * second bootstrap -- instead of an LLM role-playing those specialists.
 * `userMessage` doubles as both the business objective and the sole seed
 * keyword, mirroring generateContent()'s own `seedKeywords: [input.topic]`
 * convention for its free-text "topic" field; chat has no separate
 * structured topic/objective fields to draw from.
 */
export async function researchKeywordsAndGenerateContentFromMessage(userMessage: string): Promise<ChatKeywordResearchAndContentResult> {
  const { keywordAgent, strategyAgent, contentAgent } = await getAgents();

  const keywordResearch: KeywordResearchResult = await keywordAgent.researchKeywords({
    id: randomUUID(),
    businessObjective: userMessage,
    seedKeywords: [userMessage],
  });

  const contentStrategy: ContentStrategyResult = await strategyAgent.developStrategy({
    id: randomUUID(),
    businessObjective: userMessage,
    keywordResearch,
    articlesPerWeek: 1,
  });

  const generatedContent: SeoContentResult = await contentAgent.developContent({
    id: randomUUID(),
    businessObjective: userMessage,
    contentStrategy,
    keywordResearch,
  });
  const content = await attachSupportingImages(generatedContent);

  return { keywordResearch, contentStrategy, content };
}

function formatKeywordMetric(metrics: KeywordResearchResult["classifiedKeywords"][number]["metrics"]): string {
  return metrics ? `search volume ${metrics.searchVolume}, difficulty ${metrics.difficulty}` : "metrics unavailable";
}

/**
 * Real, non-fabricated chat-facing summary of a real KeywordResearchResult --
 * no LLM, every line traced directly to the result's own real fields.
 * Mirrors doctor-flow.ts's summarizeDoctorFlowForChat() convention. Never
 * invents a search-volume/difficulty number: when `metricsAvailable` is
 * false, that is stated plainly instead of a number being substituted.
 */
export function summarizeKeywordResearchForChat(result: KeywordResearchResult): string {
  const lines: string[] = ["**Real keyword research (Keyword Research & Search Intent Agent):**"];

  if (!result.metricsAvailable) {
    lines.push("_No keyword data provider is configured -- search volume and difficulty are honestly unavailable below, never estimated._");
  }

  lines.push("", "Classified keywords:");
  for (const kw of result.classifiedKeywords) {
    lines.push(`- "${kw.keyword}" -- ${kw.intent} intent (${kw.intentRationale}); ${formatKeywordMetric(kw.metrics)}`);
  }

  if (result.topicClusters.length > 0) {
    lines.push("", "Topic clusters:");
    for (const cluster of result.topicClusters) {
      lines.push(`- ${cluster.label}: ${cluster.keywords.join(", ")}`);
    }
  }

  if (result.limitations.length > 0) {
    lines.push("", `Limitations: ${result.limitations.join(" ")}`);
  }

  lines.push("", result.rankingDisclaimer);
  return lines.join("\n");
}

/**
 * Real, non-fabricated chat-facing summary of a real SeoContentResult -- no
 * LLM, every section traced directly to the result's own real content
 * drafts (real Anthropic-generated body text, or the real agent's own
 * honest bracketed placeholder when no content-generation provider was
 * configured for a given section -- never silently upgraded to look
 * generated).
 */
export function summarizeSeoContentForChat(result: SeoContentResult): string {
  const lines: string[] = ["**Real content draft (SEO Content Agent), written from the real keyword research and content strategy above:**"];

  for (const draft of result.contentDrafts) {
    lines.push(
      "",
      `### ${draft.title} (${draft.contentType})`,
      `Target keyword: "${draft.targetKeyword}"`,
      `Meta title: ${draft.metaTitle}`,
      `Meta description: ${draft.metaDescription}`,
    );
    // PERMANENT PIPELINE FIX (2026-09-06): the real, independent structural gate's own status -- shown
    // BEFORE the section-by-section content, never after, so a contaminated draft's failure is the FIRST
    // thing anyone sees, not something buried at the end. See article-purity-validator.ts's own header.
    if (draft.generationStatus === "failed_validation") {
      lines.push(
        "",
        "**FAILED VALIDATION -- not publication-ready.** Real structural contamination was found in this article's own generated content:",
        ...draft.purityIssues.map((issue) => `- ${issue.detail}`),
        "This draft must be regenerated or manually corrected before it can be published.",
      );
    } else if (!draft.publicationReady) {
      lines.push("", "_Not yet publication-ready -- no real content has been generated for this draft, or the editorial QA check has not passed._");
    }
    for (const section of draft.sections) {
      // A section with an empty body (the FAQ heading -- its real content is the Q&A list below, never a
      // separate generated lead-in, see content-section-drafter.ts) renders as a bare heading, not a heading
      // followed by a blank line.
      lines.push("", `#### ${section.heading}`);
      if (section.body) {
        // BLOG CONTENT GENERATOR DEFECT FIX (2026-09-04): defensive render-time strip of any embedded
        // supporting-metadata leakage (see markdown-lite.ts's own header) -- covers content persisted
        // before section-body-sanitizer.ts existed (e.g. Blog #1), never re-generates it.
        lines.push(stripSupportingMetadataFromBody(section.body));
      }
      if (section.image) {
        lines.push(`_Image: ${section.image.altText} (source: ${section.image.sourceUrl}, credit: ${section.image.creatorName} via Pixabay) -- ${section.image.placement}._`);
      }
    }
    // IMAGE PIPELINE FIX (2026-09-05): image recommendations are a suggestion, never a claim that an
    // asset exists -- kept in their own labeled block, separate from the real, already-attached
    // `_Image: ...` lines above (each of which traces to a real, downloaded Pexels photo).
    if (draft.imageRecommendations.length > 0) {
      lines.push("", "Image recommendations (not yet sourced -- suggestions only):");
      for (const rec of draft.imageRecommendations) {
        lines.push(`- ${rec.concept} (${rec.placement}) -- alt: "${rec.altText}"; suggested filename: ${rec.filename}. ${rec.purpose}`);
      }
    }
    if (draft.faqs.length > 0) {
      for (const faq of draft.faqs) {
        lines.push("", `**${faq.question}**`, faq.answerPlaceholder);
      }
    }
    // BLOG CONTENT GENERATOR DEFECT FIX (2026-09-04): a real, live-observed defect -- Blog #1's own
    // qaVerdict was `null` (the final re-check after the one automatic revision attempt didn't complete),
    // even though qaHistory[0] held a real, already-computed FAILED verdict explaining exactly what was
    // wrong ("The article body consists entirely of unrendered system placeholder text..."). The old
    // `if (draft.qaVerdict)` check skipped this ENTIRE block whenever qaVerdict was null, so that real,
    // already-known evidence that the draft failed review never reached the user -- a broken draft was
    // shown with no failure indication at all. Falling back to the last qaHistory entry when qaVerdict is
    // null means a real, computed failure is never silently hidden just because the final re-check happened
    // not to complete.
    const effectiveQa: ContentQaSummary | null = draft.qaVerdict ?? draft.qaHistory[draft.qaHistory.length - 1] ?? null;
    if (effectiveQa) {
      const attemptNote = draft.revisionAttempts > 0 ? ` (after ${draft.revisionAttempts} automatic revision attempt(s))` : "";
      const finalCheckIncomplete = !draft.qaVerdict && draft.qaHistory.length > 0;
      lines.push(
        "",
        effectiveQa.passed
          ? `_Real editorial QA self-check: passed${attemptNote}. ${effectiveQa.notes}_`
          : `_Real editorial QA self-check: FLAGGED${attemptNote}${finalCheckIncomplete ? " (showing the last real verdict obtained -- the final re-check did not complete)" : ""} (${effectiveQa.failedChecks.join(", ") || "unspecified"}) -- ${effectiveQa.notes} Review before publishing._`,
      );
      if (draft.qaHistory.length > 1) {
        lines.push("", "QA audit trail (each pass, in order):");
        draft.qaHistory.forEach((verdict, i) => {
          lines.push(`${i + 1}. ${verdict.passed ? "passed" : `FLAGGED (${verdict.failedChecks.join(", ") || "unspecified"})`} -- ${verdict.notes}`);
        });
      }
    }
  }

  if (result.limitations.length > 0) {
    lines.push("", `Limitations: ${result.limitations.join(" ")}`);
  }

  return lines.join("\n");
}
