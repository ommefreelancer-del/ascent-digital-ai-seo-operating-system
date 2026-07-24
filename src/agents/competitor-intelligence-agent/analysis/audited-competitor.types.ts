// A competitor snapshot after being run through the real WebsiteAuditAgent.
// Shared shape consumed by the overall-gap and technical-comparison
// builders, both of which compare our own results against these real,
// freshly-computed audits -- never an invented competitor result.

import type { WebsiteAuditResult } from "../../website-audit-agent/types/website-audit-request.types.js";

export interface AuditedCompetitor {
  readonly id: string;
  readonly url: string | null;
  readonly audit: WebsiteAuditResult;
}
