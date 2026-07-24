// Flattens the roadmap's active phases (in phase order, then priority
// order within each phase) into a single numbered action checklist --
// "thankless"/deprioritized items are intentionally excluded, matching the
// roadmap's own scope.

import type { ImplementationStep, SeoRoadmap } from "../types/seo-strategy-request.types.js";

export class ImplementationPlanBuilder {
  build(roadmap: SeoRoadmap): ImplementationStep[] {
    const orderedItems = roadmap.phases.flatMap((phase) => phase.items);
    return orderedItems.map((item, index) => ({
      sequence: index + 1,
      source: item.source,
      category: item.category,
      action: item.description,
      rationale: item.rationale,
    }));
  }
}
