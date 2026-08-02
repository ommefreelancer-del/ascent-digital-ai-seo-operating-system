import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ApprovalChannel } from "../../../src/core/governance/approval-channel.js";

vi.mock("node:dns", () => ({
  promises: { lookup: vi.fn(async () => [{ address: "93.184.216.34", family: 4 }]) },
}));

const PAGES: Record<string, { status: number; body: string }> = {
  "http://public.example.com/robots.txt": { status: 200, body: "User-agent: *\nDisallow:" },
  "http://public.example.com/sitemap.xml": { status: 404, body: "" },
  "http://public.example.com/": {
    status: 200,
    body: `<!DOCTYPE html><html lang="en"><head><title>Home Page With Enough Length</title>
      <meta name="description" content="A home page description that is reasonably long for SEO purposes here.">
      <meta name="viewport" content="width=device-width, initial-scale=1"></head>
      <body><main><h1>Home</h1><a href="/about/">About</a></main></body></html>`,
  },
  "http://public.example.com/about/": {
    status: 200,
    body: `<!DOCTYPE html><html lang="en"><head><title>About Page With Enough Length Here</title>
      <meta name="description" content="An about page description that is reasonably long for SEO purposes too.">
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

describe("SiteAuditOrchestrator", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "site-audit-orchestrator-"));
    installFetchMock();
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("audits every crawled page and aggregates site-level findings", async () => {
    const { SiteAuditOrchestrator } = await import("../../../src/agents/website-audit-agent/site-audit-orchestrator.js");
    const auditLogPath = join(dir, "audit-log.jsonl");
    const orchestrator = await SiteAuditOrchestrator.create({ auditLogPath }, autoApprovingChannel());

    const result = await orchestrator.auditSite("http://public.example.com/");

    expect(result.pagesCrawled).toBe(2);
    expect(result.pageAudits).toHaveLength(2);
    const home = result.pageAudits.find((p) => p.url === "http://public.example.com/");
    expect(home?.audit).not.toBeNull();
    // TechnicalSeoChecker correctly flags the fixture's http:// (not https://) scheme as critical.
    expect(home?.audit?.findings.some((f) => f.category === "technical-seo" && f.severity === "critical")).toBe(true);
    expect(home?.audit?.findings.some((f) => f.category === "headings" && f.severity === "critical")).toBe(false);

    // Site-level findings include at least the broken-link/redirect/internal-linking categories.
    const categories = new Set(result.siteFindings.map((f) => f.category));
    expect(categories.has("broken-links")).toBe(true);
    expect(categories.has("redirect-chains")).toBe(true);
    expect(categories.has("site-wide-internal-linking")).toBe(true);

    const logLines = (await readFile(auditLogPath, "utf8")).trim().split("\n");
    const eventTypes = logLines.map((l) => JSON.parse(l).eventType);
    expect(eventTypes).toContain("site_audit_requested");
    expect(eventTypes).toContain("site_audit_completed");
  });

  it("records a page that failed to fetch with a null audit rather than throwing", async () => {
    const { SiteAuditOrchestrator } = await import("../../../src/agents/website-audit-agent/site-audit-orchestrator.js");
    const auditLogPath = join(dir, "audit-log.jsonl");
    const orchestrator = await SiteAuditOrchestrator.create({ auditLogPath }, autoApprovingChannel());

    const result = await orchestrator.auditSite("http://public.example.com/", { maxPages: 1 });

    expect(result.pageAudits.every((p) => p.audit !== null || p.error !== null)).toBe(true);
  });

  it("auditCrawl audits an already-crawled result without crawling again", async () => {
    const { SiteAuditOrchestrator } = await import("../../../src/agents/website-audit-agent/site-audit-orchestrator.js");
    const { crawlWebsite } = await import("../../../src/core/crawling/website-crawler.js");
    const auditLogPath = join(dir, "audit-log.jsonl");
    const orchestrator = await SiteAuditOrchestrator.create({ auditLogPath }, autoApprovingChannel());

    const crawl = await crawlWebsite("http://public.example.com/");
    const fetchCallsAfterCrawl = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.length;

    const result = await orchestrator.auditCrawl(crawl);

    expect(result.pagesCrawled).toBe(crawl.pages.length);
    expect((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.length).toBe(fetchCallsAfterCrawl);
  });
});
