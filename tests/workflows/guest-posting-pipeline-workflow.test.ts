// End-to-end production test for the guest-posting / digital-PR pipeline:
// User Request -> Prospecting -> Publisher Qualification -> Contact
// Intelligence -> Outreach -> Campaign Tracking -> Reply & Negotiation ->
// Guest Posting & Digital PR (final deliverable). Verifies every one of the
// 7 handoffs actually executes and actually threads real data from one
// agent into the next -- not just that the types compile.
//
// Two scenarios:
//   1. Default (no providers configured): proves the pipeline runs
//      end-to-end and produces an honest, non-fabricated empty result --
//      the correct behavior with zero external services connected, not a
//      failure.
//   2. Fake data providers (in-memory test doubles, not real external
//      services): proves real data actually flows through all 7 real
//      handoffs -- a prospect discovered in step 1 is the same prospect
//      qualified in step 2, contacted in step 3, drafted-to in step 4,
//      tracked in step 5, negotiated in step 6, and consolidated in step 7.

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ApprovalChannel } from "../../src/core/governance/approval-channel.js";
import type { ApprovalDecision, ApprovalRequest } from "../../src/core/types/approval.types.js";
import {
  GuestPostingPipelineWorkflow,
  finalGuestPostingResult,
  type GuestPostingPipelineWorkflowInput,
} from "../../src/workflows/guest-posting-pipeline-workflow.js";
import type { ProspectDiscoveryProvider } from "../../src/agents/prospecting-agent/types/prospect-discovery-provider.types.js";
import type { PublisherQualityProvider } from "../../src/agents/publisher-qualification-agent/types/publisher-quality-provider.types.js";
import type { ContactDiscoveryProvider } from "../../src/agents/contact-intelligence-agent/types/contact-discovery-provider.types.js";
import type { PublisherReplyProvider } from "../../src/agents/reply-negotiation-agent/types/publisher-reply-provider.types.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "../..");

/** Approves whatever the first offered candidate is -- keeps the pipeline non-interactive regardless of which agent's low-confidence threshold fires, without hand-picking each agent's own candidate id convention. */
const AUTO_APPROVE_CHANNEL: ApprovalChannel = {
  async requestDecision(request: ApprovalRequest): Promise<ApprovalDecision> {
    return {
      requestId: request.id,
      outcome: "candidate_selected",
      selectedCandidateId: request.candidates[0]?.id ?? "proceed",
      notes: "auto-approved for end-to-end pipeline test",
      decidedAt: new Date().toISOString(),
    };
  },
};

const BASE_INPUT: GuestPostingPipelineWorkflowInput = {
  campaignName: "Q1 Guest Posting Campaign",
  campaignRequirements: "Find SEO-focused blogs open to guest posts about AI automation.",
  targetNiche: "SEO and AI automation",
  targetCountry: "United States",
  targetLanguage: "English",
  targetPricing: { targetPrice: 100, maxAcceptablePrice: 150, currency: "$" },
  senderName: "Jordan (ADASOS)",
};

describe("GuestPostingPipelineWorkflow (end-to-end, real agents)", () => {
  let auditDir: string;

  beforeEach(async () => {
    auditDir = await mkdtemp(join(tmpdir(), "guest-posting-pipeline-"));
    process.env["GUEST_POSTING_PIPELINE_WORKFLOW_AUDIT_LOG"] = join(auditDir, "audit-log.jsonl");
  });

  afterEach(async () => {
    delete process.env["GUEST_POSTING_PIPELINE_WORKFLOW_AUDIT_LOG"];
    await rm(auditDir, { recursive: true, force: true });
  });

  it("with no providers configured, every one of the 7 stages actually executes and the pipeline honestly reports no fabricated activity", async () => {
    const workflow = await GuestPostingPipelineWorkflow.create(REPO_ROOT, AUTO_APPROVE_CHANNEL);
    const runResult = await workflow.run(BASE_INPUT);

    expect(runResult.halted).toBe(false);
    expect(runResult.stepResults).toHaveLength(7);
    for (const step of runResult.stepResults) {
      expect(step.status, `step "${step.stepId}" should have completed`).toBe("completed");
    }

    const final = finalGuestPostingResult(runResult);
    expect(final).not.toBeNull();
    expect(final?.dataAvailable).toBe(false);
    expect(final?.publisherRecords).toEqual([]);
    expect(final?.confirmedPlacements).toEqual([]);
    expect(final?.campaignPlanSummary.totalProspects).toBe(0);
  });

  it("with real fake-data providers, real data actually flows through all 7 handoffs into one coherent final deliverable", async () => {
    // Domain A: discovered, qualified, contact verified, replied with a quote within the negotiable range.
    // Domain B: discovered, qualified, contact verified, never replies (still real -- no fabricated reply).
    // Domain C: discovered, but fails quality thresholds -- rejected, and must NOT reach outreach/negotiation.
    const prospectDiscoveryProvider: ProspectDiscoveryProvider = {
      name: "fake-search-engine",
      async discoverProspects() {
        return {
          candidates: [
            { url: "https://domain-a.example/guest-posts", domain: "domain-a.example", title: "Domain A SEO Blog", snippet: "We accept guest posts on AI and SEO.", opportunityType: "guest-post", relevanceScore: 0.9 },
            { url: "https://domain-b.example/write-for-us", domain: "domain-b.example", title: "Domain B Marketing Blog", snippet: "Write for us: AI automation topics welcome.", opportunityType: "guest-post", relevanceScore: 0.8 },
            { url: "https://domain-c.example/", domain: "domain-c.example", title: "Domain C Low Quality Site", snippet: "Generic content farm.", opportunityType: "guest-post", relevanceScore: 0.3 },
          ],
          source: "fake-search-engine",
          retrievedAt: new Date().toISOString(),
        };
      },
    };

    const publisherQualityProvider: PublisherQualityProvider = {
      name: "fake-seo-tool",
      async fetchPublisherQuality(request) {
        const byDomain: Record<string, { domainAuthority: number; spamScore: number; estimatedMonthlyTraffic: number }> = {
          "domain-a.example": { domainAuthority: 55, spamScore: 5, estimatedMonthlyTraffic: 40000 },
          "domain-b.example": { domainAuthority: 42, spamScore: 12, estimatedMonthlyTraffic: 18000 },
          "domain-c.example": { domainAuthority: 8, spamScore: 60, estimatedMonthlyTraffic: 500 },
        };
        const data = byDomain[request.domain];
        if (!data) return null;
        return { domain: request.domain, ...data, isNicheRelevant: true, source: "fake-seo-tool", retrievedAt: new Date().toISOString() };
      },
    };

    const contactDiscoveryProvider: ContactDiscoveryProvider = {
      name: "fake-site-research",
      async discoverContacts(request) {
        const byDomain: Record<string, { value: string; sourceUrl: string }> = {
          "domain-a.example": { value: "editor@domain-a.example", sourceUrl: "https://domain-a.example/contact" },
          "domain-b.example": { value: "hello@domain-b.example", sourceUrl: "https://domain-b.example/contact" },
        };
        const data = byDomain[request.domain];
        if (!data) return { domain: request.domain, candidates: [], source: "fake-site-research", retrievedAt: new Date().toISOString() };
        return {
          domain: request.domain,
          candidates: [{ method: "email", value: data.value, isVerified: true, sourceUrl: data.sourceUrl }],
          source: "fake-site-research",
          retrievedAt: new Date().toISOString(),
        };
      },
    };

    const publisherReplyProvider: PublisherReplyProvider = {
      name: "fake-inbox",
      async fetchReplies(request) {
        if (request.domain !== "domain-a.example") {
          return { domain: request.domain, replies: [], source: "fake-inbox", retrievedAt: new Date().toISOString() };
        }
        return {
          domain: request.domain,
          replies: [
            {
              replyId: "reply-1",
              domain: request.domain,
              receivedAt: new Date().toISOString(),
              messageText: "Thanks for reaching out! We'd charge $120 for a sponsored guest post with one dofollow link.",
            },
          ],
          source: "fake-inbox",
          retrievedAt: new Date().toISOString(),
        };
      },
    };

    const workflow = await GuestPostingPipelineWorkflow.create(REPO_ROOT, AUTO_APPROVE_CHANNEL, {
      prospectDiscoveryProvider,
      publisherQualityProvider,
      contactDiscoveryProvider,
      publisherReplyProvider,
    });
    const runResult = await workflow.run(BASE_INPUT);

    expect(runResult.halted).toBe(false);
    for (const step of runResult.stepResults) {
      expect(step.status, `step "${step.stepId}" should have completed`).toBe("completed");
    }

    // Stage 1: Prospecting discovered all 3 real candidates.
    const prospecting = runResult.outputs["prospecting"] as any;
    expect(prospecting.dataAvailable).toBe(true);
    expect(prospecting.prospects.map((p: any) => p.domain).sort()).toEqual(["domain-a.example", "domain-b.example", "domain-c.example"]);

    // Stage 2: Publisher Qualification approved A and B, rejected C on real quality evidence.
    const qualification = runResult.outputs["publisherQualification"] as any;
    expect(qualification.approvedProspects.map((p: any) => p.domain).sort()).toEqual(["domain-a.example", "domain-b.example"]);
    expect(qualification.rejectedProspects.map((p: any) => p.domain)).toEqual(["domain-c.example"]);
    expect(qualification.rejectedProspects[0].notes).toContain("domain authority");

    // Stage 3: Contact Intelligence found verified contacts only for the 2 approved domains.
    const contacts = runResult.outputs["contactIntelligence"] as any;
    expect(contacts.verifiedRecords.map((r: any) => r.domain).sort()).toEqual(["domain-a.example", "domain-b.example"]);
    expect(contacts.verifiedRecords.find((r: any) => r.domain === "domain-a.example").contactValue).toBe("editor@domain-a.example");

    // Stage 4: Outreach drafted for both verified-contact domains, using the real sender name -- and never touched the rejected domain.
    const outreach = runResult.outputs["outreach"] as any;
    expect(outreach.outreachDrafts).toHaveLength(2);
    expect(outreach.skippedPublishers).toHaveLength(0);
    expect(outreach.outreachDrafts.every((d: any) => d.body.includes("Jordan"))).toBe(true);
    expect(outreach.outreachDrafts.some((d: any) => d.domain === "domain-c.example")).toBe(false);

    // Stage 5: Campaign Tracking reflects the real drafted count from Outreach.
    const tracking = runResult.outputs["campaignTracking"] as any;
    expect(tracking.campaignStatus.draftedCount).toBe(2);
    expect(tracking.campaignStatus.phase).toBe("in-progress");

    // Stage 6: Reply & Negotiation extracted the real $120 quote for domain-a, and honestly reports no quote for domain-b.
    const negotiation = runResult.outputs["replyNegotiation"] as any;
    const termsA = negotiation.quotedTerms.find((t: any) => t.domain === "domain-a.example");
    const termsB = negotiation.quotedTerms.find((t: any) => t.domain === "domain-b.example");
    expect(termsA.status).toBe("quoted");
    expect(termsA.quotedPrice).toBe(120);
    expect(termsB.status).toBe("not-quoted");
    const recommendationA = negotiation.negotiationRecommendations.find((r: any) => r.domain === "domain-a.example");
    expect(recommendationA.assessment).toBe("above-target-negotiable"); // $120 > $100 target, <= $150 max

    // Stage 7: Guest Posting & Digital PR consolidates all 5 upstream results into one real, domain-keyed view.
    const final = finalGuestPostingResult(runResult);
    expect(final?.dataAvailable).toBe(true);
    expect(final?.campaignPlanSummary).toEqual({
      totalProspects: 3,
      approvedCount: 2,
      rejectedCount: 1,
      outreachDraftedCount: 2,
      activeNegotiationCount: expect.any(Number),
    });
    const recordC = final?.publisherRecords.find((r) => r.domain === "domain-c.example");
    expect(recordC?.qualification).toBe("rejected");
    expect(recordC?.outreachStatus).toBeNull(); // never reached outreach -- rejected upstream
    const recordA = final?.publisherRecords.find((r) => r.domain === "domain-a.example");
    expect(recordA?.qualification).toBe("approved");
    expect(recordA?.outreachStatus).toBe("drafted");
  });
});
