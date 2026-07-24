// Schedules the prioritization matrix into the spec's "30, 60, and 90-day
// SEO roadmaps": quick wins first (0-30 days, since they're both valuable
// and cheap), major projects next (31-60 days, they take longer), and
// fill-ins last (61-90 days, low priority but low cost). "Thankless" items
// (low impact, high effort) are deliberately excluded from the active
// roadmap -- but surfaced separately as `deprioritized`, never silently
// dropped.

import type { PrioritizationMatrix, SeoRoadmap, StrategyItem } from "../types/seo-strategy-request.types.js";

function sortByPriorityScore(items: readonly StrategyItem[]): StrategyItem[] {
  return [...items].sort((a, b) => b.priorityScore - a.priorityScore);
}

export class RoadmapBuilder {
  build(matrix: PrioritizationMatrix): SeoRoadmap {
    return {
      phases: [
        { label: "0-30 days", items: sortByPriorityScore(matrix.quickWins) },
        { label: "31-60 days", items: sortByPriorityScore(matrix.majorProjects) },
        { label: "61-90 days", items: sortByPriorityScore(matrix.fillIns) },
      ],
      deprioritized: sortByPriorityScore(matrix.thankless),
    };
  }
}
