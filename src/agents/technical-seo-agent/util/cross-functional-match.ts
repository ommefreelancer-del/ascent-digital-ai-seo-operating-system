// Checks whether a real WebsiteAuditResult finding is independently
// confirmed by one of the On-Page SEO Agent's cross-functional notes (which
// embed the finding's own message text). Used to justify a priority bump --
// two independent signals pointing at the same issue is stronger evidence
// than one, per GLOBAL_RULES.md SS3 (Evidence-Based Recommendations).

import type { AuditFinding } from "../../website-audit-agent/types/website-audit-request.types.js";

export function isConfirmedByCrossFunctionalNote(
  finding: AuditFinding,
  notes: readonly string[],
): boolean {
  return notes.some((note) => note.includes(finding.message));
}
