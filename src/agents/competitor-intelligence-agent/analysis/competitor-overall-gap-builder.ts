// Compares our overall page health (total critical + warning findings) to
// each competitor's real, freshly-computed WebsiteAuditResult. A simple,
// honest count comparison -- no weighting or invented scoring.

import type { WebsiteAuditResult } from "../../website-audit-agent/types/website-audit-request.types.js";
import type { AuditedCompetitor } from "./audited-competitor.types.js";
import type { CompetitorAssessment, CompetitorOverallGap } from "../types/competitor-intelligence-request.types.js";

function totalIssues(audit: WebsiteAuditResult): number {
  return audit.summary.criticalCount + audit.summary.warningCount;
}

function assess(ourTotal: number, competitorTotal: number): CompetitorAssessment {
  if (ourTotal < competitorTotal) {
    return "we_are_ahead";
  }
  if (ourTotal > competitorTotal) {
    return "we_are_behind";
  }
  return "comparable";
}

export class CompetitorOverallGapBuilder {
  build(ourWebsiteAudit: WebsiteAuditResult, competitors: readonly AuditedCompetitor[]): CompetitorOverallGap[] {
    const ourTotal = totalIssues(ourWebsiteAudit);
    return competitors.map((competitor) => {
      const competitorTotal = totalIssues(competitor.audit);
      return {
        competitorId: competitor.id,
        competitorUrl: competitor.url,
        ourTotalIssues: ourTotal,
        competitorTotalIssues: competitorTotal,
        assessment: assess(ourTotal, competitorTotal),
      };
    });
  }
}
