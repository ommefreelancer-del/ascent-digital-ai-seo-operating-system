// Turns each real, caller-supplied design asset description into a
// development task, passed through verbatim -- this agent never invents
// what the design contains. Responsiveness and accessibility (spec
// Responsibilities "Build responsive layouts", "Improve accessibility")
// are applied here as standing acceptance criteria on every feature task,
// since there is no dedicated real data source to derive them from
// independently in this build.

import type { DraftDevelopmentTask } from "../types/web-development-request.types.js";

const FEATURE_CRITERIA: readonly string[] = [
  "Feature matches the supplied design asset/requirement.",
  "Layout is responsive across common breakpoints (mobile, tablet, desktop).",
  "Feature meets basic accessibility standards (semantic HTML, alt text, keyboard navigability).",
  "Change is tested before deployment.",
];

export class FeatureTaskBuilder {
  build(designAssets: readonly string[]): DraftDevelopmentTask[] {
    return designAssets.map((asset) => ({
      category: "feature",
      priority: "medium",
      title: `Build: ${asset}`,
      description: asset,
      rationale: "Caller-supplied design asset.",
      acceptanceCriteria: FEATURE_CRITERIA,
    }));
  }
}
