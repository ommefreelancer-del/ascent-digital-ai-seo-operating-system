import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createWebApprovalChannel } from "./approval";
import type { SeoContentResult } from "./types";

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
        { ContentStrategyAgent },
        { loadContentStrategyAgentConfig },
        { SeoContentAgent },
        { loadSeoContentAgentConfig },
        { AnthropicContentGenerationProvider },
      ] = await Promise.all([
        importBackend("agents/keyword-research-agent/keyword-research-agent.js"),
        importBackend("agents/keyword-research-agent/config/keyword-research-agent.config.js"),
        importBackend("agents/content-strategy-agent/content-strategy-agent.js"),
        importBackend("agents/content-strategy-agent/config/content-strategy-agent.config.js"),
        importBackend("agents/seo-content-agent/seo-content-agent.js"),
        importBackend("agents/seo-content-agent/config/seo-content-agent.config.js"),
        importBackend("agents/seo-content-agent/providers/anthropic-content-generation-provider.js"),
      ]);

      const keywordAgent = await KeywordResearchAgent.create(
        loadKeywordResearchAgentConfig({ auditLogPath: path.join(backendRoot, "var", "web", "keyword-research-agent", "audit-log.jsonl") }, backendRoot),
        undefined,
        createWebApprovalChannel(),
      );
      const strategyAgent = await ContentStrategyAgent.create(
        loadContentStrategyAgentConfig({ auditLogPath: path.join(backendRoot, "var", "web", "content-strategy-agent", "audit-log.jsonl") }, backendRoot),
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
      const contentAgent = await SeoContentAgent.create(
        loadSeoContentAgentConfig({ auditLogPath: path.join(backendRoot, "var", "web", "seo-content-agent", "audit-log.jsonl") }, backendRoot),
        new AnthropicContentGenerationProvider(),
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

  return contentAgent.developContent({
    id: randomUUID(),
    businessObjective: input.businessObjective,
    contentStrategy,
    keywordResearch,
    ...(input.brandGuidelines ? { brandGuidelines: input.brandGuidelines } : {}),
  });
}
