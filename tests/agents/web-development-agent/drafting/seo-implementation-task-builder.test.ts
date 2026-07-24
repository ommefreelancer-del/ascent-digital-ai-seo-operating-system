import { describe, expect, it } from "vitest";
import { SeoImplementationTaskBuilder } from "../../../../src/agents/web-development-agent/drafting/seo-implementation-task-builder.js";
import type { TechnicalSeoResult } from "../../../../src/agents/technical-seo-agent/types/technical-seo-request.types.js";

function makeTechnicalSeo(recommendations: TechnicalSeoResult["recommendations"]): TechnicalSeoResult {
  return { requestId: "ts-1", url: "https://oursite.com", recommendations, limitations: [], decidedAt: new Date().toISOString() };
}

describe("SeoImplementationTaskBuilder", () => {
  const builder = new SeoImplementationTaskBuilder();

  it("returns no tasks when there are no real technical SEO recommendations", () => {
    expect(builder.build(makeTechnicalSeo([]))).toEqual([]);
  });

  it("builds one task per real recommendation, passing through priority unchanged", () => {
    const technicalSeo = makeTechnicalSeo([
      { category: "https", priority: "high", recommendation: "Migrate to HTTPS.", rationale: "Uses http://.", confirmedByCrossFunctionalNote: false },
    ]);
    const [task] = builder.build(technicalSeo);

    expect(task).toMatchObject({ category: "seo-implementation", priority: "high" });
    expect(task?.title).toContain("Migrate to HTTPS.");
    expect(task?.description).toBe("Migrate to HTTPS.");
    expect(task?.rationale).toContain("Uses http://.");
  });

  it("includes real, documented acceptance criteria on every task", () => {
    const technicalSeo = makeTechnicalSeo([
      { category: "https", priority: "medium", recommendation: "x", rationale: "y", confirmedByCrossFunctionalNote: false },
    ]);
    const [task] = builder.build(technicalSeo);
    expect(task?.acceptanceCriteria.length).toBeGreaterThan(0);
    expect(task?.acceptanceCriteria.some((c) => c.toLowerCase().includes("staging"))).toBe(true);
  });
});
