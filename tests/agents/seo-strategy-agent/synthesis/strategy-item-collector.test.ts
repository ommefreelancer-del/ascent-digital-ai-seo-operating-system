import { describe, expect, it } from "vitest";
import { StrategyItemCollector } from "../../../../src/agents/seo-strategy-agent/synthesis/strategy-item-collector.js";
import type { SeoStrategyRequest } from "../../../../src/agents/seo-strategy-agent/types/seo-strategy-request.types.js";
import type { KeywordResearchResult } from "../../../../src/agents/keyword-research-agent/types/keyword-request.types.js";
import type { WebsiteAuditResult } from "../../../../src/agents/website-audit-agent/types/website-audit-request.types.js";
import type { TechnicalSeoResult } from "../../../../src/agents/technical-seo-agent/types/technical-seo-request.types.js";
import type { CompetitorIntelligenceResult } from "../../../../src/agents/competitor-intelligence-agent/types/competitor-intelligence-request.types.js";
import type { ContentStrategyResult } from "../../../../src/agents/content-strategy-agent/types/content-strategy-request.types.js";
import type { OnPageSeoResult } from "../../../../src/agents/on-page-seo-agent/types/on-page-seo-request.types.js";

function makeKeywordResearch(): KeywordResearchResult {
  return {
    requestId: "kw-1",
    classifiedKeywords: [],
    topicClusters: [],
    metricsAvailable: false,
    limitations: [],
    rankingDisclaimer: "No guarantee.",
    decidedAt: new Date().toISOString(),
  };
}

function makeWebsiteAudit(): WebsiteAuditResult {
  return {
    requestId: "wa-1",
    url: "https://oursite.com/plumbing",
    findings: [],
    summary: { criticalCount: 0, warningCount: 0, infoCount: 0 },
    limitations: [],
    decidedAt: new Date().toISOString(),
  };
}

function makeTechnicalSeo(
  recommendations: TechnicalSeoResult["recommendations"] = [],
): TechnicalSeoResult {
  return {
    requestId: "ts-1",
    url: "https://oursite.com/plumbing",
    recommendations,
    limitations: [],
    decidedAt: new Date().toISOString(),
  };
}

function makeCompetitorIntelligence(
  recommendations: CompetitorIntelligenceResult["recommendations"] = [],
): CompetitorIntelligenceResult {
  return {
    requestId: "ci-1",
    competitorGapAnalysis: [
      { competitorId: "competitor-a", competitorUrl: null, ourTotalIssues: 1, competitorTotalIssues: 0, assessment: "we_are_behind" },
    ],
    technicalComparison: [],
    contentGapAnalysis: [],
    recommendations,
    limitations: [],
    decidedAt: new Date().toISOString(),
  };
}

function makeRequest(overrides: Partial<SeoStrategyRequest> = {}): SeoStrategyRequest {
  return {
    id: "req-1",
    businessObjective: "Grow organic traffic.",
    keywordResearch: makeKeywordResearch(),
    websiteAudit: makeWebsiteAudit(),
    technicalSeo: makeTechnicalSeo(),
    competitorIntelligence: makeCompetitorIntelligence(),
    ...overrides,
  };
}

describe("StrategyItemCollector", () => {
  const collector = new StrategyItemCollector();

  it("collects technicalSeo recommendations, passing through source, category, and impact", () => {
    const request = makeRequest({
      technicalSeo: makeTechnicalSeo([
        {
          category: "crawlability",
          priority: "high",
          recommendation: "Remove the noindex directive.",
          rationale: "The page should be indexable.",
          confirmedByCrossFunctionalNote: false,
        },
      ]),
    });

    const items = collector.collect(request);

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      source: "technical-seo",
      category: "crawlability",
      description: "Remove the noindex directive.",
      rationale: "The page should be indexable.",
      impact: "high",
      effort: "low",
    });
  });

  it("omits on-page and content-strategy items entirely when those optional inputs are not supplied", () => {
    const items = collector.collect(makeRequest());
    expect(items).toHaveLength(0);
  });

  it("collects onPageSeo recommendations when supplied", () => {
    const onPageSeo: OnPageSeoResult = {
      requestId: "op-1",
      url: "https://oursite.com/plumbing",
      targetKeyword: "plumber",
      recommendations: [
        {
          category: "title-meta",
          priority: "medium",
          recommendation: "Add the target keyword to the title tag.",
          rationale: "The title does not currently include the target keyword.",
        },
      ],
      crossFunctionalNotes: [],
      limitations: [],
      decidedAt: new Date().toISOString(),
    };

    const items = collector.collect(makeRequest({ onPageSeo }));

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ source: "on-page-seo", category: "title-meta", impact: "medium", effort: "medium" });
  });

  it("derives content-gap impact from real cluster size: >= 3 keywords is high, otherwise medium", () => {
    const contentStrategy: ContentStrategyResult = {
      requestId: "cs-1",
      topicClusters: [],
      pillarPageStrategy: [],
      internalLinkingRecommendations: [],
      editorialCalendar: [],
      contentGaps: [
        { clusterLabel: "big-cluster", keywords: ["a", "b", "c"], rationale: "No content covers this cluster." },
        { clusterLabel: "small-cluster", keywords: ["a", "b"], rationale: "No content covers this cluster." },
      ],
      contentBriefs: [],
      limitations: [],
      decidedAt: new Date().toISOString(),
    };

    const items = collector.collect(makeRequest({ contentStrategy }));

    expect(items).toHaveLength(2);
    const big = items.find((item) => item.description.includes("big-cluster"));
    const small = items.find((item) => item.description.includes("small-cluster"));
    expect(big).toMatchObject({ source: "content-strategy", category: "content-gap", impact: "high", effort: "high" });
    expect(small).toMatchObject({ source: "content-strategy", category: "content-gap", impact: "medium", effort: "high" });
  });

  it("collects competitorIntelligence recommendations", () => {
    const items = collector.collect(
      makeRequest({
        competitorIntelligence: makeCompetitorIntelligence([
          { category: "https", priority: "high", recommendation: "Migrate to HTTPS.", rationale: "Competitors already use HTTPS." },
        ]),
      }),
    );

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ source: "competitor-intelligence", category: "https", impact: "high", effort: "low" });
  });

  it("marks confirmedBySources with every OTHER source that flagged the same category, excluding itself", () => {
    const request = makeRequest({
      technicalSeo: makeTechnicalSeo([
        { category: "https", priority: "high", recommendation: "Migrate to HTTPS.", rationale: "x", confirmedByCrossFunctionalNote: false },
      ]),
      competitorIntelligence: makeCompetitorIntelligence([
        { category: "https", priority: "high", recommendation: "Competitors use HTTPS.", rationale: "y" },
      ]),
    });

    const items = collector.collect(request);

    expect(items).toHaveLength(2);
    const technicalItem = items.find((item) => item.source === "technical-seo");
    const competitorItem = items.find((item) => item.source === "competitor-intelligence");
    expect(technicalItem?.confirmedBySources).toEqual(["competitor-intelligence"]);
    expect(competitorItem?.confirmedBySources).toEqual(["technical-seo"]);
  });

  it("computes priorityScore from impact, effort, and cross-source confirmation count", () => {
    const request = makeRequest({
      technicalSeo: makeTechnicalSeo([
        { category: "https", priority: "high", recommendation: "Migrate to HTTPS.", rationale: "x", confirmedByCrossFunctionalNote: false },
      ]),
      competitorIntelligence: makeCompetitorIntelligence([
        { category: "https", priority: "high", recommendation: "Competitors use HTTPS.", rationale: "y" },
      ]),
    });

    const items = collector.collect(request);
    const technicalItem = items.find((item) => item.source === "technical-seo");
    // impact "high" = 3 points, effort "low" = 0 penalty, 1 confirming source = +0.5.
    expect(technicalItem?.priorityScore).toBe(3.5);
  });

  it("assigns a stable, unique id to every collected item", () => {
    const request = makeRequest({
      technicalSeo: makeTechnicalSeo([
        { category: "https", priority: "high", recommendation: "a", rationale: "x", confirmedByCrossFunctionalNote: false },
        { category: "crawlability", priority: "medium", recommendation: "b", rationale: "y", confirmedByCrossFunctionalNote: false },
      ]),
    });

    const items = collector.collect(request);
    const ids = items.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
