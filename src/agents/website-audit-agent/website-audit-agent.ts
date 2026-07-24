// Website Audit Agent, per Agents/website-audit-agent.md.
//
// Workflow:
//   1. Validate the request structurally; throw (and audit-log the failure)
//      on empty html or an invalid url.
//   2. Log "website_audit_requested".
//   3. Extract structural facts from the HTML once (parsing/html-fact-extractor.ts).
//   4. If the HTML doesn't look like a real rendered page (no <html>/<body>),
//      escalate to a human via the same ApprovalChannel/AuditLogger
//      primitives every other agent in this system uses, rather than
//      silently producing a possibly-meaningless audit.
//   5. Run all 9 structural checkers against the extracted facts.
//   6. Compile findings + a severity summary + explicit scope limitations.
//   7. Log "website_audit_completed" and return.
//
// Scope, per explicit instruction: structural audit ONLY. This agent never
// fetches the page, never fetches robots.txt, and never calls any external
// SEO metrics service (no Ahrefs/SEMrush/Search Console/etc). The caller
// supplies the real html (and optionally the real robotsTxtContent) directly
// -- this keeps the whole module deterministic, with zero network calls.
//
// Integration with the Boss Agent: like the other specialist agents, this
// module does not import anything from src/boss-agent (locked). See
// dispatch.ts for the integration seam.

import { randomUUID } from "node:crypto";
import type { ApprovalChannel } from "../../core/governance/approval-channel.js";
import { CliApprovalChannel } from "../../core/governance/cli-approval-channel.js";
import { AuditLogger } from "../../core/governance/audit-logger.js";
import type { ApprovalRequest } from "../../core/types/approval.types.js";
import type { WebsiteAuditAgentConfig } from "./config/website-audit-agent.config.js";
import { extractHtmlFacts } from "./parsing/html-fact-extractor.js";
import { WebsiteAuditRequestValidator } from "./validation/website-audit-request-validator.js";
import type { AuditChecker, AuditCheckContext } from "./checks/audit-checker.js";
import { CrawlabilityChecker } from "./checks/crawlability-checker.js";
import { MetadataChecker } from "./checks/metadata-checker.js";
import { HeadingStructureChecker } from "./checks/heading-structure-checker.js";
import { CanonicalChecker } from "./checks/canonical-checker.js";
import { RobotsTxtChecker } from "./checks/robots-txt-checker.js";
import { InternalLinkChecker } from "./checks/internal-link-checker.js";
import { ImageAltChecker } from "./checks/image-alt-checker.js";
import { PageStructureChecker } from "./checks/page-structure-checker.js";
import { TechnicalSeoChecker } from "./checks/technical-seo-checker.js";
import type { WebsiteAuditRequest, WebsiteAuditResult } from "./types/website-audit-request.types.js";

const PROCEED_CANDIDATE_ID = "proceed";

function defaultCheckers(): AuditChecker[] {
  return [
    new CrawlabilityChecker(),
    new MetadataChecker(),
    new HeadingStructureChecker(),
    new CanonicalChecker(),
    new RobotsTxtChecker(),
    new InternalLinkChecker(),
    new ImageAltChecker(),
    new PageStructureChecker(),
    new TechnicalSeoChecker(),
  ];
}

export class WebsiteAuditAgent {
  constructor(
    private readonly validator: WebsiteAuditRequestValidator,
    private readonly checkers: readonly AuditChecker[],
    private readonly approvalChannel: ApprovalChannel,
    private readonly auditLogger: AuditLogger,
  ) {}

  static async create(
    config: WebsiteAuditAgentConfig,
    approvalChannel: ApprovalChannel = new CliApprovalChannel(),
  ): Promise<WebsiteAuditAgent> {
    return new WebsiteAuditAgent(
      new WebsiteAuditRequestValidator(),
      defaultCheckers(),
      approvalChannel,
      new AuditLogger(config.auditLogPath),
    );
  }

  async auditWebsite(request: WebsiteAuditRequest): Promise<WebsiteAuditResult> {
    try {
      this.validator.validate(request);
    } catch (error) {
      await this.auditLogger.logEvent({
        actor: "website-audit-agent",
        eventType: "website_audit_validation_failed",
        details: { requestId: request.id, reason: error instanceof Error ? error.message : String(error) },
      });
      throw error;
    }

    await this.auditLogger.logEvent({
      actor: "website-audit-agent",
      eventType: "website_audit_requested",
      details: { requestId: request.id, url: request.url ?? null },
    });

    const facts = extractHtmlFacts(request.html);

    if (this.validator.looksAmbiguous(facts)) {
      const approved = await this.escalateAmbiguousInput(request);
      if (!approved) {
        await this.auditLogger.logEvent({
          actor: "website-audit-agent",
          eventType: "website_audit_rejected",
          details: {
            requestId: request.id,
            reason: "Human reviewer declined to proceed with content that did not look like a real page.",
          },
        });
        throw new Error(
          "Website audit request was rejected by human review because the supplied HTML did not look like a real page.",
        );
      }
    }

    const context: AuditCheckContext = {
      url: request.url ?? null,
      robotsTxtContent: request.robotsTxtContent ?? null,
    };
    const findings = this.checkers.flatMap((checker) => checker.check(facts, context));

    const summary = {
      criticalCount: findings.filter((f) => f.severity === "critical").length,
      warningCount: findings.filter((f) => f.severity === "warning").length,
      infoCount: findings.filter((f) => f.severity === "info").length,
    };

    const limitations: string[] = [
      "This is a structural audit of the supplied HTML only; no external SEO metrics, backlink data, or live crawl was performed.",
      "HTML is parsed with targeted pattern matching, not a full DOM/browser engine; deeply malformed or JavaScript-rendered content may not be fully captured.",
    ];
    if (!request.robotsTxtContent) {
      limitations.push(
        "No robots.txt content was supplied; Disallow-rule and Sitemap-reference checks were limited to reporting that absence.",
      );
    }

    const result: WebsiteAuditResult = {
      requestId: request.id,
      url: request.url ?? null,
      findings,
      summary,
      limitations,
      decidedAt: new Date().toISOString(),
    };

    await this.auditLogger.logEvent({
      actor: "website-audit-agent",
      eventType: "website_audit_completed",
      details: { requestId: request.id, ...summary, findingCount: findings.length },
    });

    return result;
  }

  private async escalateAmbiguousInput(request: WebsiteAuditRequest): Promise<boolean> {
    const approvalRequest: ApprovalRequest = {
      id: randomUUID(),
      reason: "ambiguous_match",
      summary:
        `Website audit request "${request.id}" supplied HTML with no <html> or <body> tags, so it may ` +
        "not be a real rendered page. GLOBAL_RULES.md requires human confirmation before auditing " +
        "potentially unreliable input.",
      candidates: [
        {
          id: PROCEED_CANDIDATE_ID,
          label: "Proceed with auditing this content anyway",
          score: 0,
          rationale: "Approving continues the structural audit despite the missing <html>/<body> structure.",
        },
      ],
      createdAt: new Date().toISOString(),
    };

    await this.auditLogger.logEvent({
      actor: "website-audit-agent",
      eventType: "website_audit_escalated",
      details: { requestId: request.id, approvalRequestId: approvalRequest.id },
    });

    const decision = await this.approvalChannel.requestDecision(approvalRequest);

    await this.auditLogger.logEvent({
      actor: "website-audit-agent",
      eventType: "website_audit_escalation_resolved",
      details: {
        requestId: request.id,
        approvalRequestId: approvalRequest.id,
        outcome: decision.outcome,
        notes: decision.notes,
      },
    });

    return decision.outcome === "candidate_selected" && decision.selectedCandidateId === PROCEED_CANDIDATE_ID;
  }
}
