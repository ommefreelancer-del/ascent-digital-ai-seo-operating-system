// Classifies each strategy item into the standard Impact/Effort
// prioritization matrix quadrant. "High-impact" here means impact is
// "high" or "medium" (either is worth pursuing); only impact "low" counts
// as low-impact for this classification. "Low-effort" means effort is
// exactly "low"; "medium" and "high" both count as significant effort.

import type { PrioritizationMatrix, StrategyItem } from "../types/seo-strategy-request.types.js";

type Quadrant = "quick_win" | "major_project" | "fill_in" | "thankless";

function quadrantFor(item: StrategyItem): Quadrant {
  const worthPursuing = item.impact === "high" || item.impact === "medium";
  const lowEffort = item.effort === "low";

  if (worthPursuing && lowEffort) {
    return "quick_win";
  }
  if (worthPursuing && !lowEffort) {
    return "major_project";
  }
  if (!worthPursuing && lowEffort) {
    return "fill_in";
  }
  return "thankless";
}

export class PrioritizationMatrixBuilder {
  build(items: readonly StrategyItem[]): PrioritizationMatrix {
    const quickWins: StrategyItem[] = [];
    const majorProjects: StrategyItem[] = [];
    const fillIns: StrategyItem[] = [];
    const thankless: StrategyItem[] = [];

    for (const item of items) {
      switch (quadrantFor(item)) {
        case "quick_win":
          quickWins.push(item);
          break;
        case "major_project":
          majorProjects.push(item);
          break;
        case "fill_in":
          fillIns.push(item);
          break;
        case "thankless":
          thankless.push(item);
          break;
      }
    }

    return { quickWins, majorProjects, fillIns, thankless };
  }
}
