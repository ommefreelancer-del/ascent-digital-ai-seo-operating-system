import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WebsiteAuditAgent } from "../../../src/agents/website-audit-agent/website-audit-agent.js";
import { WebsiteAuditRequestValidator } from "../../../src/agents/website-audit-agent/validation/website-audit-request-validator.js";
import { CrawlabilityChecker } from "../../../src/agents/website-audit-agent/checks/crawlability-checker.js";
import { MetadataChecker } from "../../../src/agents/website-audit-agent/checks/metadata-checker.js";
import { HeadingStructureChecker } from "../../../src/agents/website-audit-agent/checks/heading-structure-checker.js";
import { CanonicalChecker } from "../../../src/agents/website-audit-agent/checks/canonical-checker.js";
import { RobotsTxtChecker } from "../../../src/agents/website-audit-agent/checks/robots-txt-checker.js";
import { InternalLinkChecker } from "../../../src/agents/website-audit-agent/checks/internal-link-checker.js";
import { ImageAltChecker } from "../../../src/agents/website-audit-agent/checks/image-alt-checker.js";
import { PageStructureChecker } from "../../../src/agents/website-audit-agent/checks/page-structure-checker.js";
import { TechnicalSeoChecker } from "../../../src/agents/website-audit-agent/checks/technical-seo-checker.js";
import { AuditLogger } from "../../../src/core/governance/audit-logger.js";
import type { ApprovalChannel } from "../../../src/core/governance/approval-channel.js";
import type { ApprovalDecision } from "../../../src/core/types/approval.types.js";
import type { WebsiteAuditRequest } from "../../../src/agents/website-audit-agent/types/website-audit-request.types.js";

const GOOD_PAGE = `<!DOCTYPE html>
<html lang="en">
<head>
  <title>A Complete Guide to Local Plumbing Services</title>
  <meta name="description" content="Everything you need to know about hiring a reliable local plumber for repairs and installations.">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="canonical" href="https://example.com/plumbing">
</head>
<body>
  <h1>Local Plumbing Services</h1>
  <h2>Our Offerings</h2>
  <a href="/contact">Contact</a>
  <img src="/a.jpg" alt="A plumber at work">
</body>
</html>`;

function makeRequest(overrides: Partial<WebsiteAuditRequest> = {}): WebsiteAuditRequest {
  return {
    id: "req-1",
    html: GOOD_PAGE,
    url: "https://example.com/plumbing",
    ...overrides,
  };
}

function makeApprovalChannel(decision: ApprovalDecision): ApprovalChannel {
  return { requestDecision: async () => decision };
}

const REJECTING_DECISION: ApprovalDecision = {
  requestId: "unused",
  outcome: "rejected",
  notes: "should not be called",
  decidedAt: new Date().toISOString(),
};

describe("WebsiteAuditAgent", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "website-audit-agent-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  function buildAgent(approvalDecision: ApprovalDecision) {
    const auditLogPath = join(dir, "audit-log.jsonl");
    const agent = new WebsiteAuditAgent(
      new WebsiteAuditRequestValidator(),
      [
        new CrawlabilityChecker(),
        new MetadataChecker(),
        new HeadingStructureChecker(),
        new CanonicalChecker(),
        new RobotsTxtChecker(),
        new InternalLinkChecker(),
        new ImageAltChecker(),
        new PageStructureChecker(),
        new TechnicalSeoChecker(),
      ],
      makeApprovalChannel(approvalDecision),
      new AuditLogger(auditLogPath),
    );
    return { agent, auditLogPath };
  }

  async function readEventTypes(auditLogPath: string): Promise<string[]> {
    const lines = (await readFile(auditLogPath, "utf8")).trim().split("\n");
    return lines.map((line) => JSON.parse(line).eventType);
  }

  it("audits a well-formed page and produces a summary with no fabricated metrics", async () => {
    const { agent, auditLogPath } = buildAgent(REJECTING_DECISION);

    const result = await agent.auditWebsite(makeRequest());

    expect(result.requestId).toBe("req-1");
    expect(result.url).toBe("https://example.com/plumbing");
    expect(result.summary.criticalCount).toBe(0);
    expect(
      result.limitations.some((l) => l.includes("no external SEO metrics, backlink data, or live crawl")),
    ).toBe(true);

    expect(await readEventTypes(auditLogPath)).toEqual(["website_audit_requested", "website_audit_completed"]);
  });

  it("surfaces critical findings for a poorly structured page", async () => {
    const { agent } = buildAgent(REJECTING_DECISION);

    const result = await agent.auditWebsite(
      makeRequest({ html: '<html><body><meta name="robots" content="noindex"></body></html>' }),
    );

    expect(result.summary.criticalCount).toBeGreaterThan(0);
    expect(result.findings.some((f) => f.category === "crawlability" && f.severity === "critical")).toBe(true);
    expect(result.findings.some((f) => f.category === "headings" && f.severity === "critical")).toBe(true);
  });

  it("throws and audit-logs validation failures without producing a result", async () => {
    const { agent, auditLogPath } = buildAgent(REJECTING_DECISION);

    await expect(agent.auditWebsite(makeRequest({ html: "   " }))).rejects.toThrow();

    expect(await readEventTypes(auditLogPath)).toEqual(["website_audit_validation_failed"]);
  });

  it("escalates ambiguous input and proceeds when a human approves", async () => {
    const approvingDecision: ApprovalDecision = {
      requestId: "unused",
      outcome: "candidate_selected",
      selectedCandidateId: "proceed",
      notes: "Confirmed, proceed.",
      decidedAt: new Date().toISOString(),
    };
    const { agent, auditLogPath } = buildAgent(approvingDecision);

    const result = await agent.auditWebsite({ id: "req-1", html: "just some plain text" });

    expect(result.requestId).toBe("req-1");
    expect(await readEventTypes(auditLogPath)).toEqual([
      "website_audit_requested",
      "website_audit_escalated",
      "website_audit_escalation_resolved",
      "website_audit_completed",
    ]);
  });

  it("rejects the request when a human declines an ambiguous-input escalation", async () => {
    const { agent, auditLogPath } = buildAgent(REJECTING_DECISION);

    await expect(
      agent.auditWebsite({ id: "req-1", html: "just some plain text" }),
    ).rejects.toThrow(/did not look like a real page/);

    expect(await readEventTypes(auditLogPath)).toEqual([
      "website_audit_requested",
      "website_audit_escalated",
      "website_audit_escalation_resolved",
      "website_audit_rejected",
    ]);
  });

  it("adds a limitation noting robots.txt was not supplied", async () => {
    const { agent } = buildAgent(REJECTING_DECISION);
    const result = await agent.auditWebsite(makeRequest());
    expect(result.limitations.some((l) => l.includes("No robots.txt content was supplied"))).toBe(true);
  });

  it("does not add the robots.txt limitation when robotsTxtContent is supplied", async () => {
    const { agent } = buildAgent(REJECTING_DECISION);
    const result = await agent.auditWebsite(
      makeRequest({ robotsTxtContent: "User-agent: *\nSitemap: https://example.com/sitemap.xml" }),
    );
    expect(result.limitations.some((l) => l.includes("No robots.txt content was supplied"))).toBe(false);
  });
});
