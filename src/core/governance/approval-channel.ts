// The seam between "something needs a human decision" and "how that human is
// actually reached". GLOBAL_RULES.md SS9 and SS13 require human approval for
// uncertain or high-impact decisions, but do not mandate a specific channel.
// Keeping this as an interface means the interactive CLI implementation used
// today can be swapped for Slack, email, or a review dashboard later without
// touching the escalation logic that calls it.

import type { ApprovalDecision, ApprovalRequest } from "../types/approval.types.js";

export interface ApprovalChannel {
  /**
   * Presents `request` to a human reviewer and resolves once they have made
   * a decision. Implementations may block (e.g. an interactive prompt) or
   * await an external event (e.g. a webhook); callers must not assume either.
   */
  requestDecision(request: ApprovalRequest): Promise<ApprovalDecision>;
}
