import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ApprovalChannel } from "../../src/core/governance/approval-channel.js";

vi.mock("node:dns", () => ({
  promises: { lookup: vi.fn(async () => [{ address: "93.184.216.34", family: 4 }]) },
}));

const PAGES: Record<string, { status: number; body: string }> = {
  "http://public.example.com/robots.txt": { status: 200, body: "User-agent: *\nDisallow:" },
  "http://public.example.com/sitemap.xml": { status: 404, body: "" },
  "http://public.example.com/": {
    status: 200,
    body: `<!DOCTYPE html><html lang="en"><head><title>Plumbing Services Home Page</title>
      <meta name="description" content="A locally-owned plumbing company offering repairs and installations for homes.">
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <link rel="canonical" href="http://public.example.com/"></head>
      <body><main><h1>Plumbing Services</h1><a href="/about/">About</a></main></body></html>`,
  },
  "http://public.example.com/about/": {
    status: 200,
    body: `<!DOCTYPE html><html lang="en"><head><title>About Our Plumbing Company</title>
      <meta name="description" content="Learn about our licensed and insured local plumbing team and history.">
      <meta name="viewport" content="width=device-width, initial-scale=1"></head>
      <body><main><h1>About</h1></main></body></html>`,
  },
};

function installFetchMock() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL) => {
      const page = PAGES[url.toString()];
      if (!page) return new Response("not found", { status: 404 });
      return new Response(page.body, { status: page.status });
    }),
  );
}

function autoApprovingChannel(): ApprovalChannel {
  return {
    requestDecision: async (request) => ({
      requestId: request.id,
      outcome: "candidate_selected",
      selectedCandidateId: request.candidates[0]?.id ?? "proceed",
      notes: "auto-approved in test",
      decidedAt: new Date().toISOString(),
    }),
  };
}

describe("SeoAuditWorkflow", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "seo-audit-workflow-"));
    installFetchMock();
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("runs all 23 named steps against a real (mocked-network) site and produces real, traceable outputs", async () => {
    const { SeoAuditWorkflow } = await import("../../src/workflows/seo-audit-workflow.js");
    const workflow = await SeoAuditWorkflow.create(dir, autoApprovingChannel());

    const result = await workflow.run({
      startUrl: "http://public.example.com/",
      businessObjective: "Grow organic leads for a local plumbing business.",
      seedKeywords: ["emergency plumber", "drain cleaning"],
      crawlOptions: { maxPages: 10 },
    });

    expect(result.stepResults).toHaveLength(23);
    // Every step id carries its requested number (1 through 23) even though
    // execution order differs internally for steps 10-13.
    for (let n = 1; n <= 23; n++) {
      expect(result.stepResults.some((s) => s.stepId.startsWith(`step-${String(n).padStart(2, "0")}-`))).toBe(true);
    }

    // Core chain completed: crawl -> site audit -> technical seo -> keyword
    // research -> content strategy -> AI article generation.
    const outputs = result.outputs as Record<string, unknown>;
    expect(outputs["crawl"]).toBeDefined();
    expect(outputs["siteAudit"]).toBeDefined();
    expect(outputs["technicalSeo"]).toBeDefined();
    expect(outputs["keywordResearch"]).toBeDefined();
    expect(outputs["contentStrategy"]).toBeDefined();
    expect(outputs["seoContent"]).toBeDefined();
    expect(outputs["onPageSeo"]).toBeDefined();
    expect(outputs["publishingChecklist"]).toBeDefined();

    // No provider configured -> real generated prose is honestly unavailable.
    const seoContent = outputs["seoContent"] as { dataAvailable: boolean };
    expect(seoContent.dataAvailable).toBe(false);

    // Competitor analysis and keyword gap analysis honestly skip (no competitors supplied).
    const competitorStep = result.stepResults.find((s) => s.stepId === "step-11-competitor-analysis");
    const gapStep = result.stepResults.find((s) => s.stepId === "step-10-keyword-gap-analysis");
    expect(competitorStep?.status).toBe("skipped");
    expect(gapStep?.status).toBe("skipped");

    // Performance audit is opt-in and was not requested -- honestly skipped, not fabricated.
    const perfStep = result.stepResults.find((s) => s.stepId === "step-06-performance-audit");
    expect(perfStep?.status).toBe("skipped");

    expect(result.halted).toBe(false);
  });

  it("does not halt the whole workflow when optional steps are skipped", async () => {
    const { SeoAuditWorkflow } = await import("../../src/workflows/seo-audit-workflow.js");
    const workflow = await SeoAuditWorkflow.create(dir, autoApprovingChannel());

    const result = await workflow.run({
      startUrl: "http://public.example.com/",
      businessObjective: "Grow organic leads.",
      seedKeywords: [],
    });

    expect(result.halted).toBe(false);
    const keywordStep = result.stepResults.find((s) => s.stepId === "step-12-keyword-research");
    expect(keywordStep?.status).toBe("skipped");
  });
});
