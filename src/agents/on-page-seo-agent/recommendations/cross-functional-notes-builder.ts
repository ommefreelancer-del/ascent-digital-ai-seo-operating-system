// Surfaces critical/warning Website Audit findings that fall outside this
// agent's own responsibilities (crawlability, robots.txt, raw technical
// HTTPS/doctype/lang/viewport signals) as visible notes, rather than either
// silently ignoring them or overstepping into the Technical SEO Agent's
// territory by attempting to "fix" them here. Per GLOBAL_RULES.md SS1,
// known limitations and out-of-scope issues are disclosed, not hidden.

import type { AuditFinding } from "../../website-audit-agent/types/website-audit-request.types.js";
import type { OnPageRecommendationContext } from "./on-page-recommender.js";

const ON_PAGE_CATEGORIES = new Set([
  "metadata",
  "headings",
  "canonical",
  "internal-links",
  "image-alt",
]);

function isOutOfScope(finding: AuditFinding): boolean {
  if (finding.severity === "info") {
    return false;
  }
  if (ON_PAGE_CATEGORIES.has(finding.category)) {
    return false;
  }
  if (finding.category === "page-structure" && finding.message.toLowerCase().includes("structured data")) {
    return false;
  }
  return true;
}

export class CrossFunctionalNotesBuilder {
  build(context: OnPageRecommendationContext): string[] {
    return context.websiteAudit.findings
      .filter(isOutOfScope)
      .map(
        (finding) =>
          `[${finding.category}, ${finding.severity}] ${finding.message} (outside On-Page SEO Agent's ` +
          "scope -- coordinate with the Technical SEO Agent.)",
      );
  }
}
