import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SeoContentAgent } from "../../../src/agents/seo-content-agent/seo-content-agent.js";
import { SeoContentRequestValidator } from "../../../src/agents/seo-content-agent/validation/seo-content-request-validator.js";
import { NullContentGenerationProvider } from "../../../src/agents/seo-content-agent/providers/null-content-generation-provider.js";
import { MetaContentBuilder } from "../../../src/agents/seo-content-agent/drafting/meta-content-builder.js";
import { FaqBuilder } from "../../../src/agents/seo-content-agent/drafting/faq-builder.js";
import { ContentSectionDrafter } from "../../../src/agents/seo-content-agent/drafting/content-section-drafter.js";
import { ContentPieceAssembler } from "../../../src/agents/seo-content-agent/drafting/content-piece-assembler.js";
import { AuditLogger } from "../../../src/core/governance/audit-logger.js";
import type { ApprovalChannel } from "../../../src/core/governance/approval-channel.js";
import type { ApprovalDecision } from "../../../src/core/types/approval.types.js";
import type { SeoContentRequest } from "../../../src/agents/seo-content-agent/types/seo-content-request.types.js";
import type {
  ContentGenerationProvider,
  ContentGenerationRequest,
  GeneratedSection,
} from "../../../src/agents/seo-content-agent/types/content-generation-provider.types.js";
import type { ContentBrief, ContentStrategyResult } from "../../../src/agents/content-strategy-agent/types/content-strategy-request.types.js";
import type { KeywordResearchResult } from "../../../src/agents/keyword-research-agent/types/keyword-request.types.js";

function makeApprovalChannel(decision: ApprovalDecision): ApprovalChannel {
  return { requestDecision: async () => decision };
}

const REJECTING_DECISION: ApprovalDecision = {
  requestId: "unused",
  outcome: "rejected",
  notes: "should not be called",
  decidedAt: new Date().toISOString(),
};

class FixedContentGenerationProvider implements ContentGenerationProvider {
  readonly name = "fixed-test-provider";
  async generateSection(request: ContentGenerationRequest): Promise<GeneratedSection | null> {
    return { heading: request.heading, body: `Real generated prose about ${request.targetKeyword}.` };
  }
}

function makeBrief(overrides: Partial<ContentBrief> = {}): ContentBrief {
  return {
    title: "Emergency Plumbing Guide",
    contentType: "pillar",
    targetKeyword: "emergency plumber",
    intent: "informational",
    clusterLabel: "emergency plumber",
    relatedKeywords: ["24/7 plumber"],
    recommendedSections: ["Introduction", "Frequently Asked Questions"],
    wordCountGuidance: "1,800-3,000 words.",
    internalLinks: [],
    ...overrides,
  };
}

function makeContentStrategy(contentBriefs: ContentBrief[] = [makeBrief()]): ContentStrategyResult {
  return {
    requestId: "cs-1",
    topicClusters: [],
    pillarPageStrategy: [],
    internalLinkingRecommendations: [],
    editorialCalendar: [],
    contentGaps: [],
    contentBriefs,
    limitations: ["Content strategy limitation."],
    decidedAt: new Date().toISOString(),
  };
}

function makeKeywordResearch(): KeywordResearchResult {
  return {
    requestId: "kw-1",
    classifiedKeywords: [],
    topicClusters: [],
    metricsAvailable: false,
    limitations: ["Keyword research limitation."],
    rankingDisclaimer: "No guarantee.",
    decidedAt: new Date().toISOString(),
  };
}

function makeRequest(overrides: Partial<SeoContentRequest> = {}): SeoContentRequest {
  return {
    id: "req-1",
    businessObjective: "Grow emergency plumbing leads.",
    contentStrategy: makeContentStrategy(),
    keywordResearch: makeKeywordResearch(),
    ...overrides,
  };
}

describe("SeoContentAgent", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "seo-content-agent-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  function buildAgent(provider: ContentGenerationProvider, approvalDecision: ApprovalDecision = REJECTING_DECISION) {
    const auditLogPath = join(dir, "audit-log.jsonl");
    const agent = new SeoContentAgent(
      new SeoContentRequestValidator(),
      provider,
      new MetaContentBuilder(),
      new FaqBuilder(),
      new ContentSectionDrafter(),
      new ContentPieceAssembler(),
      makeApprovalChannel(approvalDecision),
      new AuditLogger(auditLogPath),
    );
    return { agent, auditLogPath };
  }

  async function readEventTypes(auditLogPath: string): Promise<string[]> {
    const lines = (await readFile(auditLogPath, "utf8")).trim().split("\n");
    return lines.map((line) => JSON.parse(line).eventType);
  }

  it("drafts real, structured content with placeholder bodies using the default NullContentGenerationProvider", async () => {
    const { agent, auditLogPath } = buildAgent(new NullContentGenerationProvider());

    const result = await agent.developContent(makeRequest());

    expect(result.dataAvailable).toBe(false);
    expect(result.contentDrafts).toHaveLength(1);
    const [draft] = result.contentDrafts;
    expect(draft?.contentType).toBe("website-page");
    expect(draft?.sections.every((s) => !s.isGenerated)).toBe(true);
    expect(draft?.faqs.length).toBeGreaterThan(0);
    expect(result.limitations.some((l) => l.includes('using "none-configured"'))).toBe(true);
    expect(await readEventTypes(auditLogPath)).toEqual(["seo_content_requested", "seo_content_completed"]);
  });

  it("carries forward every upstream limitation and notes missing optional inputs", async () => {
    const { agent } = buildAgent(new NullContentGenerationProvider());
    const result = await agent.developContent(makeRequest());

    expect(result.limitations).toEqual(
      expect.arrayContaining([
        "Content strategy limitation.",
        "Keyword research limitation.",
        "seoStrategy was not supplied; content drafting order is not prioritized by the roadmap.",
        "No brand guidelines were supplied; brand voice placeholders are generic, not tailored.",
      ]),
    );
  });

  it("marks dataAvailable true and uses real prose when a real ContentGenerationProvider is configured", async () => {
    const { agent } = buildAgent(new FixedContentGenerationProvider());

    const result = await agent.developContent(makeRequest());

    expect(result.dataAvailable).toBe(true);
    expect(result.contentDrafts[0]?.sections.every((s) => s.isGenerated)).toBe(true);
    expect(result.contentDrafts[0]?.sections[0]?.body).toContain("emergency plumber");
  });

  it("throws and audit-logs validation failures without producing a result", async () => {
    const { agent, auditLogPath } = buildAgent(new NullContentGenerationProvider());

    await expect(agent.developContent(makeRequest({ businessObjective: "   " }))).rejects.toThrow();

    expect(await readEventTypes(auditLogPath)).toEqual(["seo_content_validation_failed"]);
  });

  it("escalates a policy-risk signal and proceeds when a human approves", async () => {
    const approvingDecision: ApprovalDecision = {
      requestId: "unused",
      outcome: "candidate_selected",
      selectedCandidateId: "proceed",
      notes: "Proceed anyway.",
      decidedAt: new Date().toISOString(),
    };
    const { agent, auditLogPath } = buildAgent(new NullContentGenerationProvider(), approvingDecision);

    const result = await agent.developContent(makeRequest({ businessObjective: "Use keyword stuffing to rank." }));

    expect(result.contentDrafts).toHaveLength(1);
    expect(await readEventTypes(auditLogPath)).toEqual([
      "seo_content_requested",
      "seo_content_escalated",
      "seo_content_escalation_resolved",
      "seo_content_completed",
    ]);
  });

  it("rejects when a human declines the policy-risk escalation", async () => {
    const { agent, auditLogPath } = buildAgent(new NullContentGenerationProvider(), REJECTING_DECISION);

    await expect(
      agent.developContent(makeRequest({ businessObjective: "Use keyword stuffing to rank." })),
    ).rejects.toThrow(/Google-policy-risk signals/);

    expect(await readEventTypes(auditLogPath)).toEqual([
      "seo_content_requested",
      "seo_content_escalated",
      "seo_content_escalation_resolved",
      "seo_content_rejected",
    ]);
  });
});
