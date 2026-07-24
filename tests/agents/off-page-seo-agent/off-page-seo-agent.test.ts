import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { OffPageSeoAgent } from "../../../src/agents/off-page-seo-agent/off-page-seo-agent.js";
import { OffPageSeoRequestValidator } from "../../../src/agents/off-page-seo-agent/validation/off-page-seo-request-validator.js";
import { NullBacklinkDataProvider } from "../../../src/agents/off-page-seo-agent/providers/null-backlink-data-provider.js";
import { ReferringDomainGrowthBuilder } from "../../../src/agents/off-page-seo-agent/synthesis/referring-domain-growth-builder.js";
import { ToxicBacklinkInsightBuilder } from "../../../src/agents/off-page-seo-agent/synthesis/toxic-backlink-insight-builder.js";
import { AuthorityGapBuilder } from "../../../src/agents/off-page-seo-agent/synthesis/authority-gap-builder.js";
import { OffPageOpportunityBuilder } from "../../../src/agents/off-page-seo-agent/synthesis/off-page-opportunity-builder.js";
import { OffPageRecommendationBuilder } from "../../../src/agents/off-page-seo-agent/synthesis/off-page-recommendation-builder.js";
import { AuditLogger } from "../../../src/core/governance/audit-logger.js";
import type { ApprovalChannel } from "../../../src/core/governance/approval-channel.js";
import type { ApprovalDecision } from "../../../src/core/types/approval.types.js";
import type { OffPageSeoRequest } from "../../../src/agents/off-page-seo-agent/types/off-page-seo-request.types.js";
import type {
  BacklinkDataProvider,
  BacklinkMetricsRequest,
  BacklinkProfile,
} from "../../../src/agents/off-page-seo-agent/types/backlink-data-provider.types.js";
import type { WebsiteAuditResult } from "../../../src/agents/website-audit-agent/types/website-audit-request.types.js";
import type { CompetitorIntelligenceResult } from "../../../src/agents/competitor-intelligence-agent/types/competitor-intelligence-request.types.js";

function makeApprovalChannel(decision: ApprovalDecision): ApprovalChannel {
  return { requestDecision: async () => decision };
}

const REJECTING_DECISION: ApprovalDecision = {
  requestId: "unused",
  outcome: "rejected",
  notes: "should not be called",
  decidedAt: new Date().toISOString(),
};

class MapBackedBacklinkDataProvider implements BacklinkDataProvider {
  readonly name = "fixed-test-provider";
  constructor(private readonly profiles: ReadonlyMap<string, BacklinkProfile | null>) {}
  async fetchBacklinkProfile(request: BacklinkMetricsRequest): Promise<BacklinkProfile | null> {
    return this.profiles.get(request.url) ?? null;
  }
}

function makeWebsiteAudit(): WebsiteAuditResult {
  return {
    requestId: "wa-1",
    url: "https://oursite.com/plumbing",
    findings: [],
    summary: { criticalCount: 0, warningCount: 0, infoCount: 0 },
    limitations: ["Website audit limitation."],
    decidedAt: new Date().toISOString(),
  };
}

function makeCompetitorIntelligence(
  competitorGapAnalysis: CompetitorIntelligenceResult["competitorGapAnalysis"] = [],
): CompetitorIntelligenceResult {
  return {
    requestId: "ci-1",
    competitorGapAnalysis,
    technicalComparison: [],
    contentGapAnalysis: [],
    recommendations: [],
    limitations: ["Competitor intelligence limitation."],
    decidedAt: new Date().toISOString(),
  };
}

function makeRequest(overrides: Partial<OffPageSeoRequest> = {}): OffPageSeoRequest {
  return {
    id: "req-1",
    url: "https://oursite.com/plumbing",
    businessObjective: "Grow emergency plumbing leads.",
    competitorIntelligence: makeCompetitorIntelligence(),
    websiteAudit: makeWebsiteAudit(),
    ...overrides,
  };
}

describe("OffPageSeoAgent", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "off-page-seo-agent-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  function buildAgent(dataProvider: BacklinkDataProvider, approvalDecision: ApprovalDecision = REJECTING_DECISION) {
    const auditLogPath = join(dir, "audit-log.jsonl");
    const agent = new OffPageSeoAgent(
      new OffPageSeoRequestValidator(),
      dataProvider,
      new ReferringDomainGrowthBuilder(),
      new ToxicBacklinkInsightBuilder(),
      new AuthorityGapBuilder(),
      new OffPageOpportunityBuilder(),
      new OffPageRecommendationBuilder(),
      makeApprovalChannel(approvalDecision),
      new AuditLogger(auditLogPath),
    );
    return { agent, auditLogPath };
  }

  async function readEventTypes(auditLogPath: string): Promise<string[]> {
    const lines = (await readFile(auditLogPath, "utf8")).trim().split("\n");
    return lines.map((line) => JSON.parse(line).eventType);
  }

  it("reports data unavailable and produces no data-dependent output with the default NullBacklinkDataProvider", async () => {
    const { agent, auditLogPath } = buildAgent(new NullBacklinkDataProvider());

    const result = await agent.developOffPageStrategy(makeRequest());

    expect(result.dataAvailable).toBe(false);
    expect(result.referringDomainGrowth).toBeNull();
    expect(result.toxicBacklinks).toHaveLength(0);
    expect(result.opportunities).toHaveLength(1);
    expect(result.opportunities[0]?.category).toBe("link-building");
    expect(result.limitations.some((l) => l.includes('using "none-configured"'))).toBe(true);
    expect(await readEventTypes(auditLogPath)).toEqual(["off_page_seo_requested", "off_page_seo_completed"]);
  });

  it("carries forward every upstream limitation", async () => {
    const { agent } = buildAgent(new NullBacklinkDataProvider());
    const result = await agent.developOffPageStrategy(makeRequest());

    expect(result.limitations).toEqual(
      expect.arrayContaining(["Website audit limitation.", "Competitor intelligence limitation."]),
    );
  });

  it("produces real growth insight, competitor authority gaps, opportunities, and recommendations from real data", async () => {
    const ourProfile: BacklinkProfile = {
      url: "https://oursite.com/plumbing",
      domainAuthority: 30,
      totalReferringDomains: 80,
      previousTotalReferringDomains: 100,
      referringDomains: [],
      source: "fixed-test-provider",
      retrievedAt: new Date().toISOString(),
    };
    const competitorProfile: BacklinkProfile = {
      url: "https://competitor-a.com",
      domainAuthority: 55,
      totalReferringDomains: 200,
      previousTotalReferringDomains: null,
      referringDomains: [],
      source: "fixed-test-provider",
      retrievedAt: new Date().toISOString(),
    };
    const dataProvider = new MapBackedBacklinkDataProvider(
      new Map([
        ["https://oursite.com/plumbing", ourProfile],
        ["https://competitor-a.com", competitorProfile],
      ]),
    );
    const { agent, auditLogPath } = buildAgent(dataProvider);

    const request = makeRequest({
      competitorIntelligence: makeCompetitorIntelligence([
        {
          competitorId: "competitor-a",
          competitorUrl: "https://competitor-a.com",
          ourTotalIssues: 2,
          competitorTotalIssues: 0,
          assessment: "we_are_behind",
        },
      ]),
    });

    const result = await agent.developOffPageStrategy(request);

    expect(result.dataAvailable).toBe(true);
    expect(result.referringDomainGrowth).toMatchObject({ trend: "declining", totalReferringDomains: 80 });
    expect(result.competitorAuthorityGaps).toEqual([
      {
        competitorId: "competitor-a",
        competitorUrl: "https://competitor-a.com",
        ourDomainAuthority: 30,
        competitorDomainAuthority: 55,
        assessment: "we_are_behind",
      },
    ]);
    expect(result.opportunities.some((o) => o.category === "authority-gap")).toBe(true);
    expect(result.opportunities.some((o) => o.category === "referring-domain-decline")).toBe(true);
    expect(result.recommendations.some((r) => r.category === "authority-gap")).toBe(true);
    expect(await readEventTypes(auditLogPath)).toEqual(["off_page_seo_requested", "off_page_seo_completed"]);
  });

  it("reports competitors with no backlink data as a limitation rather than a guess", async () => {
    const { agent } = buildAgent(new NullBacklinkDataProvider());
    const request = makeRequest({
      competitorIntelligence: makeCompetitorIntelligence([
        {
          competitorId: "competitor-a",
          competitorUrl: "https://competitor-a.com",
          ourTotalIssues: 1,
          competitorTotalIssues: 0,
          assessment: "we_are_behind",
        },
      ]),
    });

    const result = await agent.developOffPageStrategy(request);

    expect(result.competitorAuthorityGaps[0]?.assessment).toBe("unknown");
    expect(result.limitations.some((l) => l.includes("1 of 1 competitor(s) have no backlink data available"))).toBe(
      true,
    );
  });

  it("throws and audit-logs validation failures without producing a result", async () => {
    const { agent, auditLogPath } = buildAgent(new NullBacklinkDataProvider());

    await expect(agent.developOffPageStrategy(makeRequest({ url: "   " }))).rejects.toThrow();

    expect(await readEventTypes(auditLogPath)).toEqual(["off_page_seo_validation_failed"]);
  });

  it("escalates flagged toxic backlinks and proceeds when a human approves", async () => {
    const ourProfile: BacklinkProfile = {
      url: "https://oursite.com/plumbing",
      domainAuthority: 30,
      totalReferringDomains: 10,
      previousTotalReferringDomains: null,
      referringDomains: [
        {
          domain: "spammy.example",
          linkingUrl: "https://spammy.example/page",
          anchorText: "click here",
          linkType: "dofollow",
          domainAuthority: 5,
          isToxic: true,
          discoveredAt: new Date().toISOString(),
        },
      ],
      source: "fixed-test-provider",
      retrievedAt: new Date().toISOString(),
    };
    const dataProvider = new MapBackedBacklinkDataProvider(new Map([["https://oursite.com/plumbing", ourProfile]]));
    const approvingDecision: ApprovalDecision = {
      requestId: "unused",
      outcome: "candidate_selected",
      selectedCandidateId: "proceed",
      notes: "Proceed with review.",
      decidedAt: new Date().toISOString(),
    };
    const { agent, auditLogPath } = buildAgent(dataProvider, approvingDecision);

    const result = await agent.developOffPageStrategy(makeRequest());

    expect(result.toxicBacklinks).toHaveLength(1);
    expect(result.recommendations.some((r) => r.category === "disavow-review")).toBe(true);
    expect(await readEventTypes(auditLogPath)).toEqual([
      "off_page_seo_requested",
      "off_page_seo_escalated",
      "off_page_seo_escalation_resolved",
      "off_page_seo_completed",
    ]);
  });

  it("rejects when a human declines the toxic-backlink escalation", async () => {
    const ourProfile: BacklinkProfile = {
      url: "https://oursite.com/plumbing",
      domainAuthority: 30,
      totalReferringDomains: 10,
      previousTotalReferringDomains: null,
      referringDomains: [
        {
          domain: "spammy.example",
          linkingUrl: "https://spammy.example/page",
          anchorText: "click here",
          linkType: "dofollow",
          domainAuthority: 5,
          isToxic: true,
          discoveredAt: new Date().toISOString(),
        },
      ],
      source: "fixed-test-provider",
      retrievedAt: new Date().toISOString(),
    };
    const dataProvider = new MapBackedBacklinkDataProvider(new Map([["https://oursite.com/plumbing", ourProfile]]));
    const { agent, auditLogPath } = buildAgent(dataProvider, REJECTING_DECISION);

    await expect(agent.developOffPageStrategy(makeRequest())).rejects.toThrow(/flagged toxic backlinks/);

    expect(await readEventTypes(auditLogPath)).toEqual([
      "off_page_seo_requested",
      "off_page_seo_escalated",
      "off_page_seo_escalation_resolved",
      "off_page_seo_rejected",
    ]);
  });
});
