// Turns each real, caller-supplied bug report into a development task,
// passed through verbatim -- this agent never invents a root cause or
// diagnosis it wasn't given. Bugs are always high priority: a report
// describes something already broken, not a judgment call about severity.

import type { DraftDevelopmentTask } from "../types/web-development-request.types.js";

const BUG_FIX_CRITERIA: readonly string[] = [
  "The reported bug no longer reproduces.",
  "No regression is introduced in related functionality.",
  "Change is tested before deployment.",
];

export class BugFixTaskBuilder {
  build(bugReports: readonly string[]): DraftDevelopmentTask[] {
    return bugReports.map((report) => ({
      category: "bug-fix",
      priority: "high",
      title: `Fix: ${report}`,
      description: report,
      rationale: "Caller-supplied bug report.",
      acceptanceCriteria: BUG_FIX_CRITERIA,
    }));
  }
}
