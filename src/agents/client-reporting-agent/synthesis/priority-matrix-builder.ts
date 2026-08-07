// Buckets every real finding from a SiteAuditResult (per-page + site-wide)
// into Critical/High/Medium/Low, and pairs each with a qualitative Estimated
// SEO Impact / Estimated Implementation Effort from a small, deterministic,
// category-based rubric. This is explicitly a rubric, not a verified
// measurement or time estimate -- it is documented as such on PriorityMatrix
// so it is never mistaken for real effort/impact data this codebase does
// not have (GLOBAL_RULES.md SS1/SS2).

import type { AuditFinding } from "../../website-audit-agent/types/website-audit-request.types.js";
import type { SiteAuditResult } from "../../website-audit-agent/site-audit-orchestrator.js";
import type {
  EstimatedEffort,
  EstimatedImpact,
  PriorityBucket,
  PriorityMatrix,
  PrioritizedFinding,
} from "../types/client-reporting-request.types.js";

const HIGH_IMPACT_CATEGORIES = new Set([
  "crawlability",
  "technical-seo",
  "broken-links",
  "redirect-chains",
  "canonical",
  "structured-data-validation",
]);

const LOW_EFFORT_CATEGORIES = new Set(["metadata", "canonical", "open-graph", "twitter-card", "headings", "mobile-friendliness"]);
const HIGH_EFFORT_CATEGORIES = new Set(["crawlability", "technical-seo", "broken-links", "redirect-chains", "site-wide-internal-linking"]);

function bucketFor(finding: AuditFinding): PriorityBucket {
  if (finding.severity === "critical") return "critical";
  if (finding.severity === "info") return "low";
  return HIGH_IMPACT_CATEGORIES.has(finding.category) ? "high" : "medium";
}

function impactFor(bucket: PriorityBucket): EstimatedImpact {
  if (bucket === "critical" || bucket === "high") return "high";
  if (bucket === "medium") return "medium";
  return "low";
}

function effortFor(finding: AuditFinding): EstimatedEffort {
  if (LOW_EFFORT_CATEGORIES.has(finding.category)) return "low";
  if (HIGH_EFFORT_CATEGORIES.has(finding.category)) return "high";
  return "medium";
}

export class PriorityMatrixBuilder {
  build(siteAudit: SiteAuditResult): PriorityMatrix {
    const prioritized: PrioritizedFinding[] = [];

    for (const page of siteAudit.pageAudits) {
      if (!page.audit) continue;
      for (const finding of page.audit.findings) {
        const bucket = bucketFor(finding);
        prioritized.push({
          ...finding,
          bucket,
          estimatedImpact: impactFor(bucket),
          estimatedEffort: effortFor(finding),
          pageUrl: page.url,
        });
      }
    }
    for (const finding of siteAudit.siteFindings) {
      const bucket = bucketFor(finding);
      prioritized.push({
        ...finding,
        bucket,
        estimatedImpact: impactFor(bucket),
        estimatedEffort: effortFor(finding),
        pageUrl: null,
      });
    }

    return {
      critical: prioritized.filter((f) => f.bucket === "critical"),
      high: prioritized.filter((f) => f.bucket === "high"),
      medium: prioritized.filter((f) => f.bucket === "medium"),
      low: prioritized.filter((f) => f.bucket === "low"),
    };
  }
}
